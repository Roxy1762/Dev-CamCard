import { describe, it, expect } from "vitest";
import { shuffle, draw } from "../deck";
import type { CardInstance, InternalPlayerState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

function makeCards(count: number): CardInstance[] {
  return Array.from({ length: count }, (_, i) => ({
    instanceId: `inst-${i}`,
    cardId: `card-${i}`,
  }));
}

function makePlayer(overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side: 0,
    name: "测试玩家",
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

// 固定随机数函数（始终返回 0，即始终选索引 0）
const seededRandom = () => 0;

// ── shuffle ───────────────────────────────────────────────────────────────────

describe("shuffle", () => {
  it("返回长度相同的新数组", () => {
    const cards = makeCards(5);
    const result = shuffle(cards);
    expect(result).toHaveLength(5);
  });

  it("不修改原始数组", () => {
    const cards = makeCards(5);
    const original = [...cards];
    shuffle(cards);
    expect(cards).toEqual(original);
  });

  it("包含所有原始元素（无丢失）", () => {
    const cards = makeCards(10);
    const result = shuffle(cards, Math.random);
    expect(result.map((c) => c.instanceId).sort()).toEqual(
      cards.map((c) => c.instanceId).sort()
    );
  });

  it("空数组返回空数组", () => {
    expect(shuffle([])).toEqual([]);
  });

  it("单元素数组保持不变", () => {
    const cards = makeCards(1);
    expect(shuffle(cards)).toEqual(cards);
  });

  it("固定随机数产生确定顺序", () => {
    const cards = makeCards(4);
    const r1 = shuffle(cards, seededRandom);
    const r2 = shuffle(cards, seededRandom);
    expect(r1).toEqual(r2);
  });
});

// ── draw ──────────────────────────────────────────────────────────────────────

describe("draw", () => {
  it("从牌堆顶抽指定数量", () => {
    const deck = makeCards(10);
    const player = makePlayer({ deck });
    const result = draw(player, 3);
    expect(result.hand).toHaveLength(3);
    expect(result.deck).toHaveLength(7);
    // 牌堆不变
    expect(result.discard).toHaveLength(0);
  });

  it("保留原有手牌", () => {
    const deck = makeCards(5);
    const hand = makeCards(2).map((c) => ({ ...c, instanceId: `hand-${c.instanceId}` }));
    const player = makePlayer({ deck, hand });
    const result = draw(player, 2);
    expect(result.hand).toHaveLength(4);
  });

  it("牌堆耗尽时用弃牌堆洗牌补充", () => {
    const discard = makeCards(6);
    const player = makePlayer({ deck: [], discard });
    const result = draw(player, 3, seededRandom);
    expect(result.hand).toHaveLength(3);
    expect(result.discard).toHaveLength(0);
    expect(result.deck).toHaveLength(3);
  });

  it("牌堆+弃牌堆均耗尽时停止抽牌", () => {
    const deck = makeCards(2);
    const player = makePlayer({ deck, discard: [] });
    const result = draw(player, 10);
    expect(result.hand).toHaveLength(2);
    expect(result.deck).toHaveLength(0);
  });

  it("牌堆与弃牌堆均为空时手牌不变", () => {
    const player = makePlayer({ deck: [], discard: [], hand: [] });
    const result = draw(player, 5);
    expect(result.hand).toHaveLength(0);
  });

  it("抽 0 张返回原玩家状态（内容相同）", () => {
    const deck = makeCards(5);
    const player = makePlayer({ deck });
    const result = draw(player, 0);
    expect(result.hand).toHaveLength(0);
    expect(result.deck).toHaveLength(5);
  });

  it("纯函数：不修改传入的 player 对象", () => {
    const deck = makeCards(5);
    const player = makePlayer({ deck });
    const originalDeckRef = player.deck;
    draw(player, 3);
    expect(player.deck).toBe(originalDeckRef); // 原对象未被修改
    expect(player.hand).toHaveLength(0);
  });
});
