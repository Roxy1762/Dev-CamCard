import { describe, it, expect } from "vitest";
import { buyFromMarket, buyFixedSupply } from "../market";
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

function makeMarket(card1: CardInstance | null = null, card2: CardInstance | null = null): MarketLaneState[] {
  return [
    { lane: "course", slots: [card1, card2] },
    { lane: "activity", slots: [null, null] },
    { lane: "daily", slots: [null, null] },
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

    // 槽位应变为 null
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
    // 足够资源购买两次（各 3）
    const state = makeState({
      players: [makePlayer(0, { resourcePool: 10 }), makePlayer(1)],
    });
    const r1 = buyFixedSupply(state, 0, "supply_errand_runner", 3, uniqueGenId);
    const r2 = buyFixedSupply(r1, 0, "supply_errand_runner", 3, uniqueGenId);

    const ids = r2.players[0].discard.map((c) => c.instanceId);
    expect(new Set(ids).size).toBe(2); // 两次生成不同 ID
  });

  it("固定补给不从商店槽扣除（无限数量）", () => {
    const state = makeState();
    const result = buyFixedSupply(state, 0, "supply_errand_runner", 3, genId);
    // fixedSupplies 列表本身不变
    expect(result.fixedSupplies).toEqual(state.fixedSupplies);
  });
});
