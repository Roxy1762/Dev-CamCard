import { describe, it, expect, beforeEach } from "vitest";
import { buyFromMarket, buyFixedSupply } from "../market";
import { createMarketState } from "../init";
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
    ...overrides,
  };
}

function makeMarket(
  card1: CardInstance | null = null,
  card2: CardInstance | null = null,
  deck: CardInstance[] = []
): MarketLaneState[] {
  return [
    { lane: "course", slots: [card1, card2], deck },
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
    fixedSupplies: ["supply_errand_runner", "supply_milk_bread"],
    readyPlayers: [true, true],
    started: true,
    ended: false,
    winner: null,
    ...overrides,
  };
}

const genId = (): string => `gen-${idCounter++}`;

// ── buyFromMarket ─────────────────────────────────────────────────────────────

describe("buyFromMarket", () => {
  it("从商店槽移除卡牌并加入买家弃牌堆", () => {
    const shopCard = card("shop_card", "shop-inst-1");
    const state = makeState({ market: makeMarket(shopCard) });

    const result = buyFromMarket(state, 0, "shop-inst-1", 3);

    // 槽位应变为 null（无牌堆补位）
    expect(result.market[0].slots[0]).toBeNull();
    // 弃牌堆应有该卡
    expect(result.players[0].discard).toContainEqual(shopCard);
  });

  it("扣除正确的资源", () => {
    const shopCard = card("shop_card", "shop-inst-2");
    const state = makeState({
      market: makeMarket(shopCard),
      players: [makePlayer(0, { resourcePool: 7 }), makePlayer(1)],
    });

    const result = buyFromMarket(state, 0, "shop-inst-2", 4);
    expect(result.players[0].resourcePool).toBe(3);
  });

  it("资源不足时抛出错误", () => {
    const shopCard = card("shop_card", "shop-inst-3");
    const state = makeState({
      market: makeMarket(shopCard),
      players: [makePlayer(0, { resourcePool: 2 }), makePlayer(1)],
    });

    expect(() => buyFromMarket(state, 0, "shop-inst-3", 5)).toThrow();
  });

  it("卡牌不在商店时抛出错误", () => {
    const state = makeState({ market: makeMarket() });
    expect(() => buyFromMarket(state, 0, "nonexistent-inst", 3)).toThrow();
  });

  it("不影响对方玩家资源", () => {
    const shopCard = card("shop_card", "shop-inst-4");
    const state = makeState({
      market: makeMarket(shopCard),
      players: [makePlayer(0, { resourcePool: 5 }), makePlayer(1, { resourcePool: 9 })],
    });

    const result = buyFromMarket(state, 0, "shop-inst-4", 3);
    expect(result.players[1].resourcePool).toBe(9);
  });

  it("纯函数：不修改传入状态", () => {
    const shopCard = card("shop_card", "shop-inst-5");
    const state = makeState({ market: makeMarket(shopCard) });
    buyFromMarket(state, 0, "shop-inst-5", 2);
    expect(state.market[0].slots[0]).toEqual(shopCard);
  });

  // ── 补位逻辑 ─────────────────────────────────────────────────────────────────

  it("购买后从同栏牌堆补位", () => {
    const shopCard = card("bought", "bought-1");
    const deckCard = card("refill", "refill-1");
    const state = makeState({ market: makeMarket(shopCard, null, [deckCard]) });

    const result = buyFromMarket(state, 0, "bought-1", 0);

    // 被购买的槽位应补入牌堆顶那张
    expect(result.market[0].slots[0]).toEqual(deckCard);
    // 牌堆应被消耗（变空）
    expect(result.market[0].deck).toHaveLength(0);
    // 弃牌堆含买走的牌
    expect(result.players[0].discard).toContainEqual(shopCard);
  });

  it("牌堆空时购买后槽位保持 null", () => {
    const shopCard = card("bought", "bought-2");
    const state = makeState({ market: makeMarket(shopCard, null, []) });

    const result = buyFromMarket(state, 0, "bought-2", 0);

    expect(result.market[0].slots[0]).toBeNull();
    expect(result.market[0].deck).toHaveLength(0);
  });

  it("牌堆有多张时只补一张，其余保留", () => {
    const shopCard = card("bought", "bought-3");
    const deck = [card("r1", "r1"), card("r2", "r2"), card("r3", "r3")];
    const state = makeState({ market: makeMarket(shopCard, null, deck) });

    const result = buyFromMarket(state, 0, "bought-3", 0);

    expect(result.market[0].slots[0]).toEqual(deck[0]);
    expect(result.market[0].deck).toHaveLength(2);
    expect(result.market[0].deck[0]).toEqual(deck[1]);
  });

  it("购买不影响其他栏的槽位和牌堆", () => {
    const shopCard = card("course_card", "course-1");
    const actCard = card("activity_card", "act-1");
    const market: MarketLaneState[] = [
      { lane: "course", slots: [shopCard, null], deck: [] },
      { lane: "activity", slots: [actCard, null], deck: [card("extra", "extra-1")] },
      { lane: "daily", slots: [null, null], deck: [] },
    ];
    const state = makeState({ market });

    const result = buyFromMarket(state, 0, "course-1", 0);

    // course 栏已被清空
    expect(result.market[0].slots[0]).toBeNull();
    // activity 栏完全不变
    expect(result.market[1].slots[0]).toEqual(actCard);
    expect(result.market[1].deck).toHaveLength(1);
  });
});

// ── buyFixedSupply ────────────────────────────────────────────────────────────

describe("buyFixedSupply", () => {
  it("生成新实例并加入买家弃牌堆", () => {
    const state = makeState();
    const result = buyFixedSupply(state, 0, "supply_errand_runner", 3, genId);

    expect(result.players[0].discard).toHaveLength(1);
    expect(result.players[0].discard[0].cardId).toBe("supply_errand_runner");
  });

  it("扣除正确的资源", () => {
    const state = makeState({
      players: [makePlayer(0, { resourcePool: 6 }), makePlayer(1)],
    });
    const result = buyFixedSupply(state, 0, "supply_milk_bread", 2, genId);
    expect(result.players[0].resourcePool).toBe(4);
  });

  it("cardId 不在 fixedSupplies 时抛出错误", () => {
    const state = makeState();
    expect(() => buyFixedSupply(state, 0, "nonexistent_card", 3, genId)).toThrow();
  });

  it("资源不足时抛出错误", () => {
    const state = makeState({
      players: [makePlayer(0, { resourcePool: 1 }), makePlayer(1)],
    });
    expect(() => buyFixedSupply(state, 0, "supply_errand_runner", 3, genId)).toThrow();
  });

  it("每次购买生成唯一 instanceId", () => {
    let counter = 0;
    const uniqueGenId = () => `unique-${counter++}`;
    const state = makeState({
      players: [makePlayer(0, { resourcePool: 10 }), makePlayer(1)],
    });
    const r1 = buyFixedSupply(state, 0, "supply_errand_runner", 3, uniqueGenId);
    const r2 = buyFixedSupply(r1, 0, "supply_errand_runner", 3, uniqueGenId);

    const ids = r2.players[0].discard.map((c) => c.instanceId);
    expect(new Set(ids).size).toBe(2);
  });

  it("固定补给不从商店槽扣除（无限数量）", () => {
    const state = makeState();
    const result = buyFixedSupply(state, 0, "supply_errand_runner", 3, genId);
    expect(result.fixedSupplies).toEqual(state.fixedSupplies);
  });
});

// ── createMarketState ─────────────────────────────────────────────────────────

describe("createMarketState", () => {
  let idc = 0;
  const seqId = () => `m-${idc++}`;
  const noShuffle = (arr: unknown[]) => [...arr]; // 保序随机（用 identity sort）

  beforeEach(() => { idc = 0; });

  it("三栏各自独立初始化", () => {
    const lanes = [
      { lane: "course" as const, cardIds: ["c1", "c2", "c3"] },
      { lane: "activity" as const, cardIds: ["a1", "a2"] },
      { lane: "daily" as const, cardIds: ["d1"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0.5);

    expect(result).toHaveLength(3);
    expect(result[0].lane).toBe("course");
    expect(result[1].lane).toBe("activity");
    expect(result[2].lane).toBe("daily");
  });

  it("每栏公开不超过 slotsPerLane 张", () => {
    const lanes = [
      { lane: "course" as const, cardIds: ["c1", "c2", "c3", "c4"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    expect(result[0].slots).toHaveLength(2);
    expect(result[0].slots.filter(Boolean)).toHaveLength(2);
  });

  it("超出槽位的牌进入隐藏牌堆", () => {
    const lanes = [
      { lane: "course" as const, cardIds: ["c1", "c2", "c3", "c4"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    expect(result[0].deck).toHaveLength(2);
  });

  it("牌数不足 slotsPerLane 时，剩余槽位为 null", () => {
    const lanes = [
      { lane: "activity" as const, cardIds: ["a1"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    expect(result[0].slots[0]).not.toBeNull();
    expect(result[0].slots[1]).toBeNull();
    expect(result[0].deck).toHaveLength(0);
  });

  it("cardIds 为空时槽位全为 null，牌堆为空", () => {
    const lanes = [
      { lane: "daily" as const, cardIds: [] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    expect(result[0].slots).toEqual([null, null]);
    expect(result[0].deck).toHaveLength(0);
  });

  it("所有牌都生成了唯一 instanceId", () => {
    const lanes = [
      { lane: "course" as const, cardIds: ["c1", "c2", "c3"] },
      { lane: "activity" as const, cardIds: ["a1", "a2"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    const allIds = result.flatMap((l) => [
      ...l.slots.filter(Boolean).map((s) => s!.instanceId),
      ...l.deck.map((d) => d.instanceId),
    ]);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("slots + deck 合计等于该栏 cardIds 数量", () => {
    const lanes = [
      { lane: "course" as const, cardIds: ["c1", "c2", "c3", "c4", "c5"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    const slotCount = result[0].slots.filter(Boolean).length;
    const deckCount = result[0].deck.length;
    expect(slotCount + deckCount).toBe(5);
  });

  it("不同栏互不影响", () => {
    const lanes = [
      { lane: "course" as const, cardIds: ["c1", "c2", "c3"] },
      { lane: "activity" as const, cardIds: ["a1"] },
      { lane: "daily" as const, cardIds: ["d1", "d2"] },
    ];
    const result = createMarketState(lanes, 2, seqId, () => 0);

    // course 有 3 张：2 公开 1 入堆
    expect(result[0].slots.filter(Boolean)).toHaveLength(2);
    expect(result[0].deck).toHaveLength(1);
    // activity 只有 1 张：1 公开 0 入堆
    expect(result[1].slots.filter(Boolean)).toHaveLength(1);
    expect(result[1].deck).toHaveLength(0);
    // daily 有 2 张：2 公开 0 入堆
    expect(result[2].slots.filter(Boolean)).toHaveLength(2);
    expect(result[2].deck).toHaveLength(0);
  });
});
