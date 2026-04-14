import { describe, it, expect } from "vitest";
import { reduce } from "../reduce";
import { createMatchState } from "../init";
import type { EngineConfig } from "../reduce";
import type { RulesetConfig } from "../init";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

const RULESET: RulesetConfig = {
  id: "core-v1",
  hp: 32,
  handSize: 5,
  firstPlayerOpeningHand: 4,
  secondPlayerOpeningHand: 5,
  scheduleSlots: 2,
  reserveSlots: 1,
  marketLanesCount: 3,
  marketSlotsPerLane: 2,
  starterDeck: [
    { cardId: "starter_allowance", count: 7 },
    { cardId: "starter_quarrel", count: 3 },
    { cardId: "starter_draft_paper", count: 1 },
    { cardId: "starter_punctuality", count: 1 },
  ],
  fixedSupplies: ["supply_errand_runner", "supply_milk_bread"],
};

const CARD_COSTS: Record<string, number> = {
  starter_allowance: 0,
  starter_quarrel: 0,
  supply_errand_runner: 3,
  supply_milk_bread: 2,
  market_card_1: 4,
};

const CONFIG: EngineConfig = {
  ruleset: RULESET,
  getCardCost: (id) => CARD_COSTS[id] ?? 0,
};

const deterministicRandom = () => 0;

let idCounter = 0;
const genId = () => `id-${idCounter++}`;

function freshState(): InternalMatchState {
  idCounter = 0;
  return createMatchState("room-test", RULESET, ["Alice", "Bob"], genId);
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
    ...overrides,
  };
}

// ── READY ─────────────────────────────────────────────────────────────────────

describe("reduce: READY", () => {
  it("第一个 READY 不开局", () => {
    const state = freshState();
    const result = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    expect(result.started).toBe(false);
    expect(result.readyPlayers[0]).toBe(true);
    expect(result.readyPlayers[1]).toBe(false);
  });

  it("双方 READY 后开局并发开局手牌", () => {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);

    expect(s2.started).toBe(true);
    // 先手开局 4 张，后手 5 张
    expect(s2.players[0].hand).toHaveLength(RULESET.firstPlayerOpeningHand);
    expect(s2.players[1].hand).toHaveLength(RULESET.secondPlayerOpeningHand);
  });

  it("READY 幂等：重复发送不改变状态", () => {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    expect(s1).toEqual(s2);
  });

  it("开局后牌堆卡数 = 12 - 开局手牌数", () => {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);

    const totalCards = 12; // core-v1 起始套牌总量
    expect(s2.players[0].deck).toHaveLength(totalCards - RULESET.firstPlayerOpeningHand);
    expect(s2.players[1].deck).toHaveLength(totalCards - RULESET.secondPlayerOpeningHand);
  });
});

// ── END_TURN ──────────────────────────────────────────────────────────────────

describe("reduce: END_TURN", () => {
  function startedState(): InternalMatchState {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    return reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);
  }

  it("切换行动方", () => {
    const state = startedState();
    const result = reduce(state, 0, { type: "END_TURN" }, CONFIG, deterministicRandom, genId);
    expect(result.activePlayer).toBe(1);
  });

  it("非行动方调用时抛出错误", () => {
    const state = startedState();
    expect(() =>
      reduce(state, 1, { type: "END_TURN" }, CONFIG, deterministicRandom, genId)
    ).toThrow();
  });

  it("尚未开局时调用抛出错误", () => {
    const state = freshState();
    expect(() =>
      reduce(state, 0, { type: "END_TURN" }, CONFIG, deterministicRandom, genId)
    ).toThrow();
  });

  it("side 1 结束后回合数 +1", () => {
    const state = startedState();
    expect(state.turnNumber).toBe(1);
    // side 0 结束
    const s2 = reduce(state, 0, { type: "END_TURN" }, CONFIG, deterministicRandom, genId);
    expect(s2.turnNumber).toBe(1);
    // side 1 结束 → 回合数变为 2
    const s3 = reduce(s2, 1, { type: "END_TURN" }, CONFIG, deterministicRandom, genId);
    expect(s3.turnNumber).toBe(2);
  });
});

// ── BUY_MARKET_CARD ───────────────────────────────────────────────────────────

describe("reduce: BUY_MARKET_CARD", () => {
  function stateWithMarketCard(): InternalMatchState {
    const marketCard: CardInstance = { instanceId: "market-inst-1", cardId: "market_card_1" };
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);

    // 手动将市场卡放入商店（并给玩家 0 足够资源）
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...s2.players[0], resourcePool: 10 },
      s2.players[1],
    ];
    const market = [
      { lane: "course" as const, slots: [marketCard, null] },
      { lane: "activity" as const, slots: [null, null] },
      { lane: "daily" as const, slots: [null, null] },
    ];
    return { ...s2, players, market };
  }

  it("从商店槽移除卡牌，加入弃牌堆，扣除资源", () => {
    const state = stateWithMarketCard();
    const result = reduce(
      state,
      0,
      { type: "BUY_MARKET_CARD", instanceId: "market-inst-1" },
      CONFIG,
      deterministicRandom,
      genId
    );

    expect(result.market[0].slots[0]).toBeNull();
    expect(result.players[0].discard.some((c) => c.instanceId === "market-inst-1")).toBe(true);
    expect(result.players[0].resourcePool).toBe(6); // 10 - 4
  });

  it("商店中不存在时抛出错误", () => {
    const state = stateWithMarketCard();
    expect(() =>
      reduce(state, 0, { type: "BUY_MARKET_CARD", instanceId: "nonexistent" }, CONFIG)
    ).toThrow();
  });

  it("非行动方调用时抛出错误", () => {
    const state = stateWithMarketCard();
    expect(() =>
      reduce(state, 1, { type: "BUY_MARKET_CARD", instanceId: "market-inst-1" }, CONFIG)
    ).toThrow();
  });
});

// ── BUY_FIXED_SUPPLY ──────────────────────────────────────────────────────────

describe("reduce: BUY_FIXED_SUPPLY", () => {
  function startedState(): InternalMatchState {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...s2.players[0], resourcePool: 10 },
      s2.players[1],
    ];
    return { ...s2, players };
  }

  it("生成新实例并加入弃牌堆，扣除资源", () => {
    const state = startedState();
    const result = reduce(
      state,
      0,
      { type: "BUY_FIXED_SUPPLY", cardId: "supply_errand_runner" },
      CONFIG,
      deterministicRandom,
      genId
    );

    expect(result.players[0].discard).toHaveLength(1);
    expect(result.players[0].discard[0].cardId).toBe("supply_errand_runner");
    expect(result.players[0].resourcePool).toBe(7); // 10 - 3
  });

  it("cardId 不在 fixedSupplies 时抛出错误", () => {
    const state = startedState();
    expect(() =>
      reduce(state, 0, { type: "BUY_FIXED_SUPPLY", cardId: "invalid_card" }, CONFIG)
    ).toThrow();
  });

  it("非行动方调用时抛出错误", () => {
    const state = startedState();
    expect(() =>
      reduce(state, 1, { type: "BUY_FIXED_SUPPLY", cardId: "supply_errand_runner" }, CONFIG)
    ).toThrow();
  });
});

// ── CONCEDE ───────────────────────────────────────────────────────────────────

describe("reduce: CONCEDE", () => {
  it("side 0 投降 → winner = 1", () => {
    const state = freshState();
    const result = reduce(state, 0, { type: "CONCEDE" }, CONFIG);
    expect(result.ended).toBe(true);
    expect(result.winner).toBe(1);
  });

  it("side 1 投降 → winner = 0", () => {
    const state = freshState();
    const result = reduce(state, 1, { type: "CONCEDE" }, CONFIG);
    expect(result.ended).toBe(true);
    expect(result.winner).toBe(0);
  });
});
