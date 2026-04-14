import type { PlayerSide } from "@dev-camcard/protocol";
import type { InternalMatchState, InternalPlayerState } from "./types";
import { draw } from "./deck";

/**
 * beginTurn — 新回合开始时的清理操作（纯函数）。
 *
 * 按 game-rules.md "回合开始" 顺序（MVP 实现范围）：
 *  1. 清空当前玩家残留防备
 *  2. 处理延迟效果（TODO 下一轮）
 *  3. 重置场馆启动次数（TODO 下一轮）
 *  4. 结算日程槽安排牌（TODO 下一轮）
 */
export function beginTurn(state: InternalMatchState): InternalMatchState {
  const idx = state.activePlayer;
  const player = state.players[idx];

  const updated: InternalPlayerState = {
    ...player,
    block: 0,          // 1. 清空防备
    resourcePool: 0,   // 新回合资源重置
    attackPool: 0,     // 新回合攻击重置
  };

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
 *  2. 弃手牌（hand → discard）
 *  3. 弃压力（压力牌已在手牌中，随手牌一起弃置）
 *  4. 场馆留场（无操作）
 *  5. 抽到 handSize 张
 *
 * 然后切换行动方，调用 beginTurn。
 *
 * @param state    当前对局状态
 * @param handSize 目标手牌数（来自 ruleset.handSize = 5）
 * @param random   随机数函数（注入，便于测试确定性）
 */
export function endTurn(
  state: InternalMatchState,
  handSize: number,
  random: () => number = Math.random
): InternalMatchState {
  const idx = state.activePlayer;
  const player = state.players[idx];

  // 步骤 1-3：弃出牌 + 手牌（含压力）
  const toDiscard = [...player.played, ...player.hand];

  let updated: InternalPlayerState = {
    ...player,
    hand: [],
    played: [],
    discard: [...player.discard, ...toDiscard],
  };

  // 步骤 5：抽到 handSize 张
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

  // 开始下一玩家的回合
  return beginTurn(afterSwitch);
}
