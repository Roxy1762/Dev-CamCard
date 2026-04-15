import type {
  PublicMatchView,
  PrivatePlayerView,
  PublicPlayerSummary,
  PublicCardRef,
  MarketLane,
  PublicVenueView,
} from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "./types";

/**
 * toPublicMatchView — 将内部状态投影为双方可见的公开视图。
 *
 * 关键约束（non-negotiables.md）：
 *  - 手牌内容不可见（只暴露 handSize）
 *  - 牌堆内容不可见（只暴露 deckSize）
 *  - 弃牌堆顶可见（此版本只暴露数量）
 */
export function toPublicMatchView(state: InternalMatchState): PublicMatchView {
  const players: [PublicPlayerSummary, PublicPlayerSummary] = [
    toPublicPlayerSummary(state.players[0]),
    toPublicPlayerSummary(state.players[1]),
  ];

  const market: MarketLane[] = state.market.map((lane) => ({
    lane: lane.lane,
    slots: lane.slots.map((slot) => (slot ? toRef(slot) : null)),
  }));

  return {
    roomId: state.roomId,
    turnNumber: state.turnNumber,
    activePlayer: state.activePlayer,
    players,
    market,
    fixedSupplies: state.fixedSupplies,
    started: state.started,
    ended: state.ended,
    winner: state.winner,
  };
}

/**
 * toPrivatePlayerView — 投影单个玩家的私有视图（含手牌）。
 * 只发送给对应席位的玩家，不可广播。
 */
export function toPrivatePlayerView(
  state: InternalMatchState,
  side: 0 | 1
): PrivatePlayerView {
  return {
    side,
    hand: state.players[side].hand.map(toRef),
  };
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function toRef(card: CardInstance): PublicCardRef {
  return { id: card.cardId, instanceId: card.instanceId };
}

function toPublicPlayerSummary(player: InternalPlayerState): PublicPlayerSummary {
  const venues: PublicVenueView[] = player.venues.map((v) => ({
    instanceId: v.instanceId,
    cardId: v.cardId,
    owner: v.owner,
    isGuard: v.isGuard,
    activationsLeft: v.activationsLeft,
  }));

  return {
    side: player.side,
    name: player.name,
    hp: player.hp,
    block: player.block,
    deckSize: player.deck.length,
    handSize: player.hand.length,
    discardSize: player.discard.length,
    resourcePool: player.resourcePool,
    attackPool: player.attackPool,
    venues,
    scheduleSlots: player.scheduleSlots.map((s) => (s ? toRef(s) : null)),
    reservedCard: player.reservedCard ? toRef(player.reservedCard) : null,
    hasReservedThisTurn: player.hasReservedThisTurn,
  };
}
