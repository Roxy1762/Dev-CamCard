import type { PlayerSide } from "@dev-camcard/protocol";
import type { InternalMatchState, InternalPlayerState, VenueState } from "./types";
import type { CardDef } from "./effects";
import { applyStateEffects, checkCondition } from "./effects";
import { draw } from "./deck";

/** 最小配置接口，供 beginTurn 做日程结算与场馆重置 */
export interface TurnConfig {
  hp: number;
  getCardDef: (id: string) => CardDef | undefined;
  /** UUID 生成函数，用于压力牌等需要创建实例的效果 */
  genId?: () => string;
}

/**
 * beginTurn — 新回合开始时的清理操作（纯函数）。
 *
 * 按 game-rules.md "回合开始" 顺序：
 *  1. 清空当前玩家残留防备，重置资源/攻击池，重置 hasReservedThisTurn
 *  2. 重置场馆启动次数 + 恢复场馆耐久（耐久伤害不保留）
 *  3. 结算日程槽安排牌（若提供 config）
 *
 * @param state   当前内部对局状态
 * @param config  可选：规则配置（用于日程结算）
 * @param random  随机数函数（用于日程结算中可能的摸牌效果）
 */
export function beginTurn(
  state: InternalMatchState,
  config?: TurnConfig,
  random: () => number = Math.random
): InternalMatchState {
  const idx = state.activePlayer;
  const player = state.players[idx];

  // ── 1. 清空防备、重置资源/攻击/预约标志 ───────────────────────────────────────
  let updated: InternalPlayerState = {
    ...player,
    block: 0,
    resourcePool: 0,
    attackPool: 0,
    hasReservedThisTurn: false,  // 新回合重置预约标志
  };

  // ── 2. 重置场馆启动次数 + 恢复耐久 ──────────────────────────────────────────
  const resetVenues: VenueState[] = updated.venues.map((v) => ({
    ...v,
    activationsLeft: v.activationsPerTurn,
    durability: v.maxDurability,
  }));
  updated = { ...updated, venues: resetVenues };

  // ── 3. 结算日程槽 ────────────────────────────────────────────────────────────
  if (config) {
    const genId = config.genId ?? (() => crypto.randomUUID());
    const activePlayer = idx as PlayerSide;

    // 把当前 updated 写入临时 state，以便 applyStateEffects 访问双方状态
    let s = mergePlayer(state, idx, updated);

    for (let i = 0; i < updated.scheduleSlots.length; i++) {
      const slot = s.players[idx].scheduleSlots[i];
      if (!slot) continue;

      const cardDef = config.getCardDef(slot.cardId);
      if (cardDef) {
        for (const ability of cardDef.abilities) {
          if (ability.trigger !== "onScheduleResolve") continue;

          const currentPlayer = s.players[idx];
          if (ability.condition && !checkCondition(currentPlayer, ability.condition)) {
            continue;
          }

          s = applyStateEffects(s, activePlayer, ability.effects, random, config.hp, genId);
        }
      }

      // 结算后移入弃牌堆，腾出槽位
      const currentPlayer = s.players[idx];
      const newScheduleSlots = currentPlayer.scheduleSlots.map((sl, si) =>
        si === i ? null : sl
      ) as (typeof currentPlayer.scheduleSlots);
      const updatedSlotPlayer: InternalPlayerState = {
        ...currentPlayer,
        discard: [...currentPlayer.discard, slot],
        scheduleSlots: newScheduleSlots,
      };
      s = mergePlayer(s, idx, updatedSlotPlayer);
    }

    updated = s.players[idx];
  }

  const players = [
    state.players[0],
    state.players[1],
  ] as [InternalPlayerState, InternalPlayerState];
  players[idx] = updated;

  return { ...state, players };
}

/**
 * endTurn — 结束当前玩家回合（纯函数）。
 *
 * 按 game-rules.md "回合结束" 顺序：
 *  1. 弃本回合打出的行动牌（played → discard）
 *  2. 弃手牌（含压力牌，hand → discard）
 *  3. 场馆留场（无操作）
 *  4. 抽到 handSize 张
 *
 * 然后切换行动方，调用 beginTurn。
 *
 * @param state    当前对局状态
 * @param handSize 目标手牌数（来自 ruleset.handSize = 5）
 * @param random   随机数函数（注入，便于测试确定性）
 * @param config   可选：传给 beginTurn 做日程结算
 */
export function endTurn(
  state: InternalMatchState,
  handSize: number,
  random: () => number = Math.random,
  config?: TurnConfig
): InternalMatchState {
  const idx = state.activePlayer;
  const player = state.players[idx];

  // 步骤 1-2：弃出牌 + 手牌（含压力）
  const toDiscard = [...player.played, ...player.hand];

  let updated: InternalPlayerState = {
    ...player,
    hand: [],
    played: [],
    discard: [...player.discard, ...toDiscard],
  };

  // 步骤 4：抽到 handSize 张
  updated = draw(updated, handSize, random);

  const players = [
    state.players[0],
    state.players[1],
  ] as [InternalPlayerState, InternalPlayerState];
  players[idx] = updated;

  // 切换行动方
  const nextActive: PlayerSide = idx === 0 ? 1 : 0;

  // 当 player1 (side=1) 结束回合并回到 player0 时，回合数 +1
  const nextTurnNumber =
    nextActive === 0 ? state.turnNumber + 1 : state.turnNumber;

  const afterSwitch: InternalMatchState = {
    ...state,
    players,
    activePlayer: nextActive,
    turnNumber: nextTurnNumber,
  };

  // 开始下一玩家的回合（含日程结算 + 场馆重置）
  return beginTurn(afterSwitch, config, random);
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

/** 将一个玩家状态合并进 state，返回新 state */
function mergePlayer(
  state: InternalMatchState,
  idx: number,
  updatedPlayer: InternalPlayerState
): InternalMatchState {
  const players = [state.players[0], state.players[1]] as [InternalPlayerState, InternalPlayerState];
  players[idx] = updatedPlayer;
  return { ...state, players };
}
