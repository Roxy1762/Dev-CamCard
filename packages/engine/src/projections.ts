import type {
  PublicMatchView,
  PrivatePlayerView,
  PendingChoiceView,
  PublicPlayerSummary,
  PublicCardRef,
  MarketLane,
  PublicVenueView,
  TargetCandidateView,
} from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "./types";
import type { PendingChoice, TargetCandidate } from "./effects";

/**
 * toPublicMatchView — 将内部状态投影为双方可见的公开视图。
 *
 * 关键约束（non-negotiables.md）：
 *  - 手牌内容不可见（只暴露 handSize）
 *  - 牌堆内容不可见（只暴露 deckSize）
 *  - 弃牌堆顶可见（此版本只暴露数量）
 *  - pendingChoice 仅暴露等待方（forSide），不暴露选项内容
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
    pendingChoiceSide: state.pendingChoice?.forSide ?? null,
  };
}

/**
 * toPrivatePlayerView — 投影单个玩家的私有视图（含手牌 + 弃牌堆 + 待选择）。
 * 只发送给对应席位的玩家，不可广播。
 */
export function toPrivatePlayerView(
  state: InternalMatchState,
  side: 0 | 1
): PrivatePlayerView {
  const player = state.players[side];

  // 仅当 pendingChoice 是给当前玩家的，才在视图中暴露
  let choiceView: PendingChoiceView | null = null;
  if (state.pendingChoice && state.pendingChoice.forSide === side) {
    choiceView = toPendingChoiceView(state.pendingChoice);
  }

  return {
    side,
    hand: player.hand.map(toRef),
    discard: player.discard.map(toRef),
    pendingChoice: choiceView,
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
    durability: v.durability,
    maxDurability: v.maxDurability,
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
    pendingDiscardCount: player.pendingDiscardCount,
  };
}

function toPendingChoiceView(choice: PendingChoice): PendingChoiceView {
  switch (choice.type) {
    case "chooseCardsFromHand":
      return {
        type: "chooseCardsFromHand",
        minCount: choice.minCount,
        maxCount: choice.maxCount,
      };
    case "chooseCardsFromDiscard":
      return {
        type: "chooseCardsFromDiscard",
        minCount: choice.minCount,
        maxCount: choice.maxCount,
      };
    case "chooseCardsFromHandOrDiscard":
      return {
        type: "chooseCardsFromHandOrDiscard",
        minCount: choice.minCount,
        maxCount: choice.maxCount,
      };
    case "scryDecision":
      return {
        type: "scryDecision",
        revealedCards: choice.revealedCards.map((c) => ({
          id: c.cardId,
          instanceId: c.instanceId,
        })),
        maxDiscard: choice.maxDiscard,
      };

    case "gainFaceUpCardDecision":
      return {
        type: "gainFaceUpCardDecision",
        candidates: choice.candidates.map((c) => ({
          id: c.cardId,
          instanceId: c.instanceId,
        })),
        destination: choice.destination,
      };

    case "chooseTarget":
      return {
        type: "chooseTarget",
        targetType: choice.targetType,
        candidates: choice.candidates.map((c): TargetCandidateView => {
          if (c.kind === "player") return { kind: "player", side: c.side };
          return { kind: "venue", instanceId: c.instanceId, cardId: c.cardId, ownerSide: c.ownerSide };
        }),
      };
  }
}
