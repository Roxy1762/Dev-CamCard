import { describe, it, expect } from "vitest";
import { shuffle } from "../deck";
import { createSeededRng, hashStringToSeed, createSeededIdFactory } from "../rng";
import { createMarketState, createSeededMatchState, type RulesetConfig } from "../init";
import { reduce } from "../reduce";
import type { CardDef } from "../effects";
import type { CardInstance } from "../types";
import { CMD } from "@dev-camcard/protocol";

// ── 聚焦测试：围绕「seed 可复现」做最小验证 ──
// 本文件只覆盖本轮目标：
//  1) 同 seed 的 shuffle 一致
//  2) 不同 seed 的 shuffle 可以不同
//  3) createMarketState 在同 seed 下稳定（槽位 + 隐藏牌堆）
//  4) 同初始状态 + 同命令流 → reduce 结果一致

const ruleset: RulesetConfig = {
  id: "test-core",
  hp: 32,
  handSize: 5,
  firstPlayerOpeningHand: 5,
  secondPlayerOpeningHand: 5,
  scheduleSlots: 2,
  reserveSlots: 1,
  marketLanesCount: 3,
  marketSlotsPerLane: 2,
  starterDeck: [
    { cardId: "starter_a", count: 5 },
    { cardId: "starter_b", count: 5 },
  ],
  fixedSupplies: [],
};

const STARTER_DEFS: Record<string, CardDef> = {
  starter_a: { id: "starter_a", type: "action", abilities: [] },
  starter_b: { id: "starter_b", type: "action", abilities: [] },
};

function makeCards(n: number): CardInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `inst-${i}`,
    cardId: `c-${i}`,
  }));
}

describe("RNG 确定性（Mulberry32）", () => {
  it("1) 同 seed 的 shuffle 结果一致", () => {
    const deckA = makeCards(12);
    const deckB = makeCards(12);
    const rngA = createSeededRng(42);
    const rngB = createSeededRng(42);
    const a = shuffle(deckA, () => rngA.next());
    const b = shuffle(deckB, () => rngB.next());
    expect(a.map((c) => c.instanceId)).toEqual(b.map((c) => c.instanceId));
  });

  it("2) 不同 seed 的 shuffle 至少在 12 张牌上产生不同顺序", () => {
    const deck = makeCards(12);
    const rng1 = createSeededRng(1);
    const rng2 = createSeededRng(2);
    const a = shuffle(deck, () => rng1.next());
    const b = shuffle(deck, () => rng2.next());
    expect(a.map((c) => c.instanceId)).not.toEqual(b.map((c) => c.instanceId));
  });

  it("3) createMarketState 在同 seed 下稳定（槽位 + 隐藏牌堆完全一致）", () => {
    const lanes = [
      { lane: "course", cardIds: ["c1", "c2", "c3", "c4", "c5"] },
      { lane: "activity", cardIds: ["a1", "a2", "a3", "a4", "a5"] },
      { lane: "daily", cardIds: ["d1", "d2", "d3", "d4", "d5"] },
    ] as const;

    const idA = createSeededIdFactory("room-x");
    const rngA = createSeededRng(hashStringToSeed("room-x"));
    const marketA = createMarketState(
      lanes.map((l) => ({ lane: l.lane, cardIds: [...l.cardIds] })),
      2,
      idA.genId,
      () => rngA.next()
    );

    const idB = createSeededIdFactory("room-x");
    const rngB = createSeededRng(hashStringToSeed("room-x"));
    const marketB = createMarketState(
      lanes.map((l) => ({ lane: l.lane, cardIds: [...l.cardIds] })),
      2,
      idB.genId,
      () => rngB.next()
    );

    expect(marketA).toEqual(marketB);
  });
});

describe("同初始状态 + 同命令流 → reduce 关键结果一致", () => {
  it("4) READY + END_TURN 序列在同 seed 下产生相同的手牌 instanceId", () => {
    const config = {
      ruleset,
      getCardCost: () => 0,
      getCardDef: (id: string) => STARTER_DEFS[id],
    };

    const runOnce = () => {
      const { state } = createSeededMatchState("room-det", ruleset, ["p0", "p1"], 2026);
      let s = state;
      s = reduce(s, 0, { type: CMD.READY } as never, config);
      s = reduce(s, 1, { type: CMD.READY } as never, config);
      // 已 started，activePlayer=0，抽过开局手牌
      s = reduce(s, 0, { type: CMD.END_TURN } as never, config);
      s = reduce(s, 1, { type: CMD.END_TURN } as never, config);
      return {
        handsP0: s.players[0].hand.map((c) => c.instanceId),
        handsP1: s.players[1].hand.map((c) => c.instanceId),
        rngState: s.rngState,
        idCounter: s.idCounter,
      };
    };

    const a = runOnce();
    const b = runOnce();

    expect(a.handsP0).toEqual(b.handsP0);
    expect(a.handsP1).toEqual(b.handsP1);
    expect(a.rngState).toBe(b.rngState);
    expect(a.idCounter).toBe(b.idCounter);
  });

  it("5) 不同 seed 下 END_TURN 的手牌排列可不同（抽样合理性）", () => {
    const config = {
      ruleset,
      getCardCost: () => 0,
      getCardDef: (id: string) => STARTER_DEFS[id],
    };

    const handsFor = (seed: number) => {
      const { state } = createSeededMatchState("room-det", ruleset, ["p0", "p1"], seed);
      let s = state;
      s = reduce(s, 0, { type: CMD.READY } as never, config);
      s = reduce(s, 1, { type: CMD.READY } as never, config);
      return s.players[0].hand.map((c) => c.instanceId);
    };

    const a = handsFor(111);
    const b = handsFor(222);
    // 起始牌堆 instanceId 是由 createMatchState 按序生成的，不依赖 seed；
    // 但开局 shuffle 会被 seed 改变，因此手牌顺序应不同。
    expect(a).not.toEqual(b);
  });
});
