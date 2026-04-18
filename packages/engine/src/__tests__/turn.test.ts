import { describe, it, expect } from "vitest";
import { beginTurn, endTurn } from "../turn";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

let idCounter = 0;
function card(cardId = "c"): CardInstance {
  return { instanceId: `inst-${idCounter++}`, cardId };
}

function makePlayer(side: 0 | 1, overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side,
    name: `玩家${side}`,
    hp: 32,
    block: 0,
    resourcePool: 0,
    attackPool: 0,
    deck: [],
    hand: [],
    discard: [],
    played: [],
    venues: [],
    scheduleSlots: [null, null],
    reservedCard: null,
    reservedCardTurn: null,
    hasReservedThisTurn: false,
    activeFlags: [],
    pendingDiscardCount: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<InternalMatchState> = {}): InternalMatchState {
  const { pendingChoice, ...restOverrides } = overrides;
  return {
    roomId: "room-1",
    rulesetId: "core-v1",
    turnNumber: 1,
    activePlayer: 0,
    players: [makePlayer(0), makePlayer(1)],
    market: [],
    fixedSupplies: [],
    readyPlayers: [true, true],
    started: true,
    ended: false,
    winner: null,
    ...restOverrides,
    pendingChoice: pendingChoice ?? null,
  };
}

const deterministicRandom = () => 0;

// ── beginTurn ─────────────────────────────────────────────────────────────────

describe("beginTurn", () => {
  it("清空行动方的防备值", () => {
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0, { block: 5 }), makePlayer(1)],
    });
    const result = beginTurn(state);
    expect(result.players[0].block).toBe(0);
  });

  it("重置行动方资源池与攻击池", () => {
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0, { resourcePool: 3, attackPool: 2 }), makePlayer(1)],
    });
    const result = beginTurn(state);
    expect(result.players[0].resourcePool).toBe(0);
    expect(result.players[0].attackPool).toBe(0);
  });

  it("不影响对方玩家", () => {
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0, { block: 3 }), makePlayer(1, { block: 7, hp: 20 })],
    });
    const result = beginTurn(state);
    expect(result.players[1].block).toBe(7);
    expect(result.players[1].hp).toBe(20);
  });

  it("纯函数：不修改传入状态", () => {
    const state = makeState({ players: [makePlayer(0, { block: 4 }), makePlayer(1)] });
    beginTurn(state);
    expect(state.players[0].block).toBe(4);
  });
});

// ── endTurn ───────────────────────────────────────────────────────────────────

describe("endTurn", () => {
  it("将行动牌与手牌移入弃牌堆（无牌可抽时仅重洗）", () => {
    const hand = [card(), card()];
    const played = [card()];
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0, { hand, played, discard: [] }), makePlayer(1)],
    });
    const result = endTurn(state, 5, deterministicRandom);
    // played 必须清空
    expect(result.players[0].played).toHaveLength(0);
    // 所有牌（hand+deck+discard）总量不变
    const p = result.players[0];
    expect(p.deck.length + p.hand.length + p.discard.length).toBe(hand.length + played.length);
  });

  it("切换行动方（side 0 → side 1）", () => {
    const state = makeState({ activePlayer: 0 });
    const result = endTurn(state, 5, deterministicRandom);
    expect(result.activePlayer).toBe(1);
  });

  it("切换行动方（side 1 → side 0）", () => {
    const state = makeState({ activePlayer: 1 });
    const result = endTurn(state, 5, deterministicRandom);
    expect(result.activePlayer).toBe(0);
  });

  it("side 1 结束后回合数 +1", () => {
    const state = makeState({ activePlayer: 1, turnNumber: 2 });
    const result = endTurn(state, 5, deterministicRandom);
    expect(result.turnNumber).toBe(3);
  });

  it("side 0 结束后回合数不变", () => {
    const state = makeState({ activePlayer: 0, turnNumber: 1 });
    const result = endTurn(state, 5, deterministicRandom);
    expect(result.turnNumber).toBe(1);
  });

  it("新回合开始时清空下一行动方的防备", () => {
    // Player 1 有 block，player 0 结束后切换到 player 1 并调用 beginTurn
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0), makePlayer(1, { block: 8 })],
    });
    const result = endTurn(state, 5, deterministicRandom);
    expect(result.players[1].block).toBe(0);
  });

  it("抽牌到 handSize 张", () => {
    const deck = Array.from({ length: 10 }, (_, i) => card(`deck-card-${i}`));
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0, { deck, hand: [], played: [], discard: [] }), makePlayer(1)],
    });
    const result = endTurn(state, 5, deterministicRandom);
    expect(result.players[0].hand).toHaveLength(5);
  });

  it("纯函数：不修改传入状态", () => {
    const hand = [card()];
    const state = makeState({
      activePlayer: 0,
      players: [makePlayer(0, { hand }), makePlayer(1)],
    });
    endTurn(state, 5, deterministicRandom);
    expect(state.players[0].hand).toHaveLength(1);
  });
});
