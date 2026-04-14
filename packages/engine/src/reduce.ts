import type { ClientCommand, PlayerSide } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { InternalMatchState, InternalPlayerState } from "./types";
import type { RulesetConfig } from "./init";
import { draw, shuffle } from "./deck";
import { endTurn } from "./turn";
import { buyFromMarket, buyFixedSupply } from "./market";

/**
 * EngineConfig — reduce 调用时注入的引擎配置。
 */
export interface EngineConfig {
  ruleset: RulesetConfig;
  /** 按 cardId 查询购买费用，用于 BUY 命令 */
  getCardCost: (cardId: string) => number;
}

/**
 * reduce — 规则引擎主入口（纯函数）。
 *
 * 接收当前内部状态 + 发令席位 + 客户端命令，返回新状态。
 * 非法操作抛出 Error（由调用方捕获后回复错误消息）。
 *
 * MVP 实现范围：READY / END_TURN / BUY_MARKET_CARD / BUY_FIXED_SUPPLY / CONCEDE。
 * 其余命令（PLAY_CARD 等）暂时返回原状态，不抛出异常。
 *
 * @param state    当前内部对局状态
 * @param side     发出命令的玩家席位
 * @param command  客户端命令（discriminated union）
 * @param config   引擎配置
 * @param random   可注入随机函数（测试用）
 * @param genId    可注入 UUID 生成函数（测试用）
 */
export function reduce(
  state: InternalMatchState,
  side: PlayerSide,
  command: ClientCommand,
  config: EngineConfig,
  random: () => number = Math.random,
  genId: () => string = () => crypto.randomUUID()
): InternalMatchState {
  switch (command.type) {
    case CMD.READY:
      return handleReady(state, side, config.ruleset, random);

    case CMD.END_TURN:
      assertActive(state, side);
      assertStarted(state);
      return endTurn(state, config.ruleset.handSize, random);

    case CMD.BUY_MARKET_CARD: {
      assertActive(state, side);
      assertStarted(state);
      const slot = state.market
        .flatMap((lane) => lane.slots)
        .find((s) => s?.instanceId === command.instanceId);
      if (!slot) {
        throw new Error(`商店中未找到卡牌实例: ${command.instanceId}`);
      }
      const cost = config.getCardCost(slot.cardId);
      return buyFromMarket(state, side, command.instanceId, cost);
    }

    case CMD.BUY_FIXED_SUPPLY: {
      assertActive(state, side);
      assertStarted(state);
      const cost = config.getCardCost(command.cardId);
      return buyFixedSupply(state, side, command.cardId, cost, genId);
    }

    case CMD.CONCEDE:
      return {
        ...state,
        ended: true,
        winner: (side === 0 ? 1 : 0) as PlayerSide,
      };

    default:
      // 未实现的命令（PLAY_CARD、ACTIVATE_VENUE 等）暂时为 no-op
      return state;
  }
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function assertActive(state: InternalMatchState, side: PlayerSide): void {
  if (state.activePlayer !== side) {
    throw new Error(`非行动方（side=${side}）不能执行此操作，当前行动方为 side=${state.activePlayer}`);
  }
}

function assertStarted(state: InternalMatchState): void {
  if (!state.started) {
    throw new Error("对局尚未开始，请先发送 READY 命令");
  }
}

function handleReady(
  state: InternalMatchState,
  side: PlayerSide,
  ruleset: RulesetConfig,
  random: () => number
): InternalMatchState {
  // 幂等：重复 READY 不改变状态
  if (state.readyPlayers[side]) {
    return state;
  }

  const newReady: [boolean, boolean] = [state.readyPlayers[0], state.readyPlayers[1]];
  newReady[side] = true;

  const nextState: InternalMatchState = { ...state, readyPlayers: newReady };

  // 双方均 READY → 开局
  if (newReady[0] && newReady[1]) {
    return startMatch(nextState, ruleset, random);
  }

  return nextState;
}

function startMatch(
  state: InternalMatchState,
  ruleset: RulesetConfig,
  random: () => number
): InternalMatchState {
  const players = state.players.map((player, idx) => {
    const shuffledDeck = shuffle(player.deck, random);
    const openingSize = idx === 0
      ? ruleset.firstPlayerOpeningHand
      : ruleset.secondPlayerOpeningHand;

    const reset: InternalPlayerState = {
      ...player,
      deck: shuffledDeck,
      hand: [],
      discard: [],
    };
    return draw(reset, openingSize, random);
  }) as [InternalPlayerState, InternalPlayerState];

  return {
    ...state,
    players,
    started: true,
    turnNumber: 1,
    activePlayer: 0,
  };
}
