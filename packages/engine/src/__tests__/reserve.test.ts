import { describe, it, expect } from "vitest";
import { reserveFromMarket, buyReservedCard } from "../market";
import { reduce } from "../reduce";
import type { EngineConfig } from "../reduce";
import type { RulesetConfig } from "../init";
import type { CardDef } from "../effects";
import type { CardInstance, InternalMatchState, InternalPlayerState, MarketLaneState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

let idCounter = 0;
function card(cardId = "c", instanceId?: string): CardInstance {
  return { instanceId: instanceId ?? `inst-${idCounter++}`, cardId };
}

function makePlayer(side: 0 | 1, overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side,
    name: `玩家${side}`,
    hp: 32,
    block: 0,
    resourcePool: 5,
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
    ...overrides,
  };
}

function makeMarket(
  card1: CardInstance | null = null,
  card2: CardInstance | null = null,
  deckCards: CardInstance[] = []
): MarketLaneState[] {
  return [
    { lane: "course", slots: [card1, card2], deck: deckCards },
    { lane: "activity", slots: [null, null], deck: [] },
    { lane: "daily", slots: [null, null], deck: [] },
  ];
}

function makeState(overrides: Partial<InternalMatchState> = {}): InternalMatchState {
  return {
    roomId: "room-1",
    rulesetId: "core-v1",
    turnNumber: 1,
    activePlayer: 0,
    players: [makePlayer(0), makePlayer(1)],
    market: makeMarket(),
    fixedSupplies: [],
    readyPlayers: [true, true],
    started: true,
    ended: false,
    winner: null,
    ...overrides,
  };
}

// ── CONFIG for reduce tests ────────────────────────────────────────────────────

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
  starterDeck: [],
  fixedSupplies: [],
};

const CARD_DEFS: Record<string, CardDef> = {
  market_a: { id: "market_a", type: "action", abilities: [] },
  market_b: { id: "market_b", type: "action", abilities: [] },
};

const CONFIG: EngineConfig = {
  ruleset: RULESET,
  getCardCost: (id) => (id === "market_a" ? 4 : id === "market_b" ? 3 : 0),
  getCardDef: (id) => CARD_DEFS[id],
};

const seqId = (() => {
  let n = 0;
  return () => `gen-${n++}`;
})();

// ── reserveFromMarket ─────────────────────────────────────────────────────────

describe("reserveFromMarket", () => {
  it("成功预约：从商店槽移除牌，放入预约位，扣 1 资源", () => {
    const shopCard = card("market_a", "shop-1");
    const state = makeState({ market: makeMarket(shopCard) });

    const result = reserveFromMarket(state, 0, "shop-1", 1);

    expect(result.players[0].reservedCard).toEqual(shopCard);
    expect(result.players[0].resourcePool).toBe(4); // 5 - 1
    expect(result.market[0].slots[0]).toBeNull();    // 槽位清空（无牌堆补位）
    expect(result.players[0].hasReservedThisTurn).toBe(true);
    expect(result.players[0].reservedCardTurn).toBe(1);
  });

  it("预约后对应栏立即从牌堆补位", () => {
    const shopCard = card("market_a", "shop-1");
    const refillCard = card("market_b", "refill-1");
    const state = makeState({ market: makeMarket(shopCard, null, [refillCard]) });

    const result = reserveFromMarket(state, 0, "shop-1", 1);

    expect(result.market[0].slots[0]).toEqual(refillCard); // 补位成功
    expect(result.market[0].deck).toHaveLength(0);
  });

  it("资源不足时预约失败", () => {
    const shopCard = card("market_a", "shop-2");
    const state = makeState({
      market: makeMarket(shopCard),
      players: [makePlayer(0, { resourcePool: 0 }), makePlayer(1)],
    });

    expect(() => reserveFromMarket(state, 0, "shop-2", 1)).toThrow(/资源不足/);
  });

  it("预约位已有牌时失败", () => {
    const shopCard = card("market_a", "shop-3");
    const existingReserved = card("market_b", "reserved-existing");
    const state = makeState({
      market: makeMarket(shopCard),
      players: [
        makePlayer(0, { reservedCard: existingReserved }),
        makePlayer(1),
      ],
    });

    expect(() => reserveFromMarket(state, 0, "shop-3", 1)).toThrow(/预约位已有牌/);
  });

  it("每回合只能预约 1 次", () => {
    const shopCard1 = card("market_a", "shop-4");
    const shopCard2 = card("market_b", "shop-5");
    const state = makeState({
      market: [
        { lane: "course", slots: [shopCard1, shopCard2], deck: [] },
        { lane: "activity", slots: [null, null], deck: [] },
        { lane: "daily", slots: [null, null], deck: [] },
      ],
    });

    // 第一次预约成功
    const afterFirst = reserveFromMarket(state, 0, "shop-4", 1);
    expect(afterFirst.players[0].hasReservedThisTurn).toBe(true);

    // 第二次预约失败（本回合已预约过）
    expect(() =>
      reserveFromMarket(afterFirst, 0, "shop-5", 1)
    ).toThrow(/本回合已执行过预约/);
  });

  it("商店中不存在的卡牌无法预约", () => {
    const state = makeState({ market: makeMarket() });
    expect(() => reserveFromMarket(state, 0, "nonexistent", 1)).toThrow();
  });

  it("纯函数：不修改传入状态", () => {
    const shopCard = card("market_a", "shop-6");
    const state = makeState({ market: makeMarket(shopCard) });
    reserveFromMarket(state, 0, "shop-6", 1);
    expect(state.market[0].slots[0]).toEqual(shopCard);
    expect(state.players[0].reservedCard).toBeNull();
  });
});

// ── buyReservedCard ───────────────────────────────────────────────────────────

describe("buyReservedCard", () => {
  it("下一回合可以购买预约牌，费用 -1", () => {
    const reserved = card("market_a", "reserved-1");
    const state = makeState({
      turnNumber: 2,
      players: [
        makePlayer(0, {
          resourcePool: 10,
          reservedCard: reserved,
          reservedCardTurn: 1,  // 上回合预约
        }),
        makePlayer(1),
      ],
    });

    // market_a 原价 4，预约折扣后 3
    const result = buyReservedCard(state, 0, 3);

    expect(result.players[0].reservedCard).toBeNull();
    expect(result.players[0].discard).toContainEqual(reserved);
    expect(result.players[0].resourcePool).toBe(7); // 10 - 3
  });

  it("同回合不能购买预约牌", () => {
    const reserved = card("market_a", "reserved-2");
    const state = makeState({
      turnNumber: 1,
      players: [
        makePlayer(0, {
          resourcePool: 10,
          reservedCard: reserved,
          reservedCardTurn: 1,  // 同回合
        }),
        makePlayer(1),
      ],
    });

    expect(() => buyReservedCard(state, 0, 3)).toThrow(/同一回合/);
  });

  it("预约位为空时购买失败", () => {
    const state = makeState({
      players: [makePlayer(0, { resourcePool: 10 }), makePlayer(1)],
    });

    expect(() => buyReservedCard(state, 0, 0)).toThrow(/预约位为空/);
  });

  it("资源不足时购买失败", () => {
    const reserved = card("market_a", "reserved-3");
    const state = makeState({
      turnNumber: 2,
      players: [
        makePlayer(0, {
          resourcePool: 2,
          reservedCard: reserved,
          reservedCardTurn: 1,
        }),
        makePlayer(1),
      ],
    });

    expect(() => buyReservedCard(state, 0, 3)).toThrow(/资源不足/);
  });

  it("购买后预约位清空，牌进弃牌堆", () => {
    const reserved = card("market_b", "reserved-4");
    const state = makeState({
      turnNumber: 3,
      players: [
        makePlayer(0, {
          resourcePool: 5,
          reservedCard: reserved,
          reservedCardTurn: 2,
        }),
        makePlayer(1),
      ],
    });

    const result = buyReservedCard(state, 0, 2); // market_b 原价 3, 折后 2

    expect(result.players[0].reservedCard).toBeNull();
    expect(result.players[0].reservedCardTurn).toBeNull();
    expect(result.players[0].discard).toContainEqual(reserved);
  });

  it("纯函数：不修改传入状态", () => {
    const reserved = card("market_a", "reserved-5");
    const state = makeState({
      turnNumber: 2,
      players: [
        makePlayer(0, { resourcePool: 5, reservedCard: reserved, reservedCardTurn: 1 }),
        makePlayer(1),
      ],
    });

    buyReservedCard(state, 0, 3);
    expect(state.players[0].reservedCard).toEqual(reserved);
  });
});

// ── 通过 reduce 集成测试 ───────────────────────────────────────────────────────

describe("reduce: RESERVE_MARKET_CARD + BUY_RESERVED_CARD (集成)", () => {
  it("RESERVE_MARKET_CARD 成功预约后 BUY_RESERVED_CARD 下回合成功购买", () => {
    const shopCard = card("market_a", "shop-int-1");
    let state = makeState({
      turnNumber: 1,
      market: makeMarket(shopCard),
      players: [makePlayer(0, { resourcePool: 8 }), makePlayer(1)],
    });

    // 回合 1：预约
    state = reduce(state, 0, { type: "RESERVE_MARKET_CARD", instanceId: "shop-int-1" }, CONFIG, () => 0, seqId);
    expect(state.players[0].reservedCard).toEqual(shopCard);
    expect(state.players[0].resourcePool).toBe(7);

    // 模拟推进到回合 2（直接修改 turnNumber）
    state = { ...state, turnNumber: 2 };

    // 回合 2：买预约牌（折后费用 3 = 4 - 1）
    state = reduce(state, 0, { type: "BUY_RESERVED_CARD" }, CONFIG, () => 0, seqId);
    expect(state.players[0].reservedCard).toBeNull();
    expect(state.players[0].discard).toContainEqual(shopCard);
    expect(state.players[0].resourcePool).toBe(4); // 7 - 3
  });

  it("RESERVE_MARKET_CARD 同回合直接 BUY_RESERVED_CARD 失败", () => {
    const shopCard = card("market_a", "shop-int-2");
    const state = makeState({
      turnNumber: 1,
      market: makeMarket(shopCard),
      players: [makePlayer(0, { resourcePool: 8 }), makePlayer(1)],
    });

    const afterReserve = reduce(state, 0, { type: "RESERVE_MARKET_CARD", instanceId: "shop-int-2" }, CONFIG, () => 0, seqId);
    expect(() =>
      reduce(afterReserve, 0, { type: "BUY_RESERVED_CARD" }, CONFIG, () => 0, seqId)
    ).toThrow(/同一回合/);
  });

  it("每回合只能 RESERVE_MARKET_CARD 一次，第二次抛错", () => {
    const shopCard1 = card("market_a", "shop-int-3");
    const shopCard2 = card("market_b", "shop-int-4");
    const state = makeState({
      turnNumber: 1,
      market: [
        { lane: "course", slots: [shopCard1, shopCard2], deck: [] },
        { lane: "activity", slots: [null, null], deck: [] },
        { lane: "daily", slots: [null, null], deck: [] },
      ],
      players: [makePlayer(0, { resourcePool: 8 }), makePlayer(1)],
    });

    const afterFirst = reduce(state, 0, { type: "RESERVE_MARKET_CARD", instanceId: "shop-int-3" }, CONFIG, () => 0, seqId);
    expect(() =>
      reduce(afterFirst, 0, { type: "RESERVE_MARKET_CARD", instanceId: "shop-int-4" }, CONFIG, () => 0, seqId)
    ).toThrow();
  });

  it("hasReservedThisTurn 在下回合（beginTurn）后重置为 false", () => {
    const shopCard = card("market_a", "shop-int-5");
    let state = makeState({
      turnNumber: 1,
      market: makeMarket(shopCard),
      players: [
        makePlayer(0, { resourcePool: 8 }),
        makePlayer(1),
      ],
    });

    // 回合 1：预约
    state = reduce(state, 0, { type: "RESERVE_MARKET_CARD", instanceId: "shop-int-5" }, CONFIG, () => 0, seqId);
    expect(state.players[0].hasReservedThisTurn).toBe(true);

    // 结束回合（切换到玩家 1）
    state = reduce(state, 0, { type: "END_TURN" }, CONFIG, () => 0, seqId);
    // 切换到玩家 1，再结束
    state = reduce(state, 1, { type: "END_TURN" }, CONFIG, () => 0, seqId);

    // 回合 2 开始，玩家 0 的 hasReservedThisTurn 应已重置
    expect(state.players[0].hasReservedThisTurn).toBe(false);
  });
});
