/**
 * gainFaceUpCard.test.ts
 *
 * 聚焦测试：gainFaceUpCard 效果（市场选牌）与 chooseTarget 效果（场馆/玩家目标选择）。
 */
import { describe, it, expect } from "vitest";
import { applyStateEffects, resolveChoice } from "../effects";
import type { CardInstance, InternalMatchState, InternalPlayerState, MarketLaneState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

let _id = 0;
const seqId = () => `g-${_id++}`;

function card(cardId = "c", iid?: string): CardInstance {
  return { instanceId: iid ?? `ci-${_id++}`, cardId };
}

function makePlayer(side: 0 | 1, overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side, name: `P${side}`, hp: 32, block: 0,
    resourcePool: 8, attackPool: 0,
    deck: [], hand: [], discard: [], played: [], venues: [],
    scheduleSlots: [null, null],
    reservedCard: null, reservedCardTurn: null,
    hasReservedThisTurn: false, activeFlags: [],
    pendingDiscardCount: 0,
    ...overrides,
  };
}

function makeLane(slots: (CardInstance | null)[], deck: CardInstance[] = []): MarketLaneState {
  return { lane: "activity", slots, deck };
}

function makeState(
  p0?: Partial<InternalPlayerState>,
  p1?: Partial<InternalPlayerState>,
  market: MarketLaneState[] = []
): InternalMatchState {
  return {
    roomId: "r1", rulesetId: "core-v1", turnNumber: 1,
    activePlayer: 0,
    players: [makePlayer(0, p0), makePlayer(1, p1)],
    market,
    fixedSupplies: [],
    readyPlayers: [true, true],
    started: true, ended: false, winner: null,
    pendingChoice: null,
  };
}

// 简单费用表
const getCardCost = (id: string) => {
  const costs: Record<string, number> = { cheap: 2, mid: 4, expensive: 6 };
  return costs[id] ?? 3;
};

// ── gainFaceUpCard ────────────────────────────────────────────────────────────

describe("gainFaceUpCard — 市场选牌", () => {
  it("市场有满足费用上限的牌 → 产生 gainFaceUpCardDecision pendingChoice", () => {
    const mkt = [makeLane([card("cheap", "c1"), card("mid", "c2")])];
    const state = makeState({}, {}, mkt);

    const result = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4 }],
      Math.random, 32, seqId, getCardCost
    );

    expect(result.pendingChoice).not.toBeNull();
    expect(result.pendingChoice!.type).toBe("gainFaceUpCardDecision");
    const choice = result.pendingChoice as Extract<typeof result.pendingChoice, { type: "gainFaceUpCardDecision" }>;
    // cheap(2) 和 mid(4) 都满足 maxCost=4
    expect(choice.candidates.map((c) => c.cardId)).toEqual(expect.arrayContaining(["cheap", "mid"]));
    expect(choice.destination).toBe("discard");
  });

  it("所有市场牌费用超出 maxCost → 无 pendingChoice（跳过）", () => {
    const mkt = [makeLane([card("expensive", "e1")])];
    const state = makeState({}, {}, mkt);

    const result = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4 }],
      Math.random, 32, seqId, getCardCost
    );

    expect(result.pendingChoice).toBeNull();
  });

  it("解决 gainFaceUpCardDecision → 牌进入弃牌堆，市场槽正确补位", () => {
    const refill = card("mid", "refill1");
    const mkt = [makeLane([card("cheap", "c1"), null], [refill])];
    const state = makeState({}, {}, mkt);

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4, destination: "discard" }],
      Math.random, 32, seqId, getCardCost
    );
    expect(withChoice.pendingChoice?.type).toBe("gainFaceUpCardDecision");

    const resolved = resolveChoice(withChoice, 0, ["c1"], Math.random, 32, seqId, getCardCost);
    expect(resolved.pendingChoice).toBeNull();

    // 牌进入 side=0 的弃牌堆
    expect(resolved.players[0].discard.some((c) => c.instanceId === "c1")).toBe(true);

    // 市场槽补位：c1 槽现在是 refill1
    const slot0 = resolved.market[0].slots[0];
    expect(slot0?.instanceId).toBe("refill1");
    expect(resolved.market[0].deck).toHaveLength(0);
  });

  it("destination=deckTop → 牌进入牌堆顶", () => {
    const mkt = [makeLane([card("cheap", "c2")])];
    const state = makeState({}, {}, mkt);

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4, destination: "deckTop" }],
      Math.random, 32, seqId, getCardCost
    );
    const resolved = resolveChoice(withChoice, 0, ["c2"], Math.random, 32, seqId, getCardCost);

    expect(resolved.players[0].deck[0]?.instanceId).toBe("c2");
    expect(resolved.players[0].discard).toHaveLength(0);
  });

  it("选择 0 张（跳过）→ 市场不变，无效果", () => {
    const mkt = [makeLane([card("cheap", "c3")])];
    const state = makeState({}, {}, mkt);

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4 }],
      Math.random, 32, seqId, getCardCost
    );
    const resolved = resolveChoice(withChoice, 0, [], Math.random, 32, seqId, getCardCost);

    expect(resolved.players[0].discard).toHaveLength(0);
    expect(resolved.market[0].slots[0]?.instanceId).toBe("c3");
  });

  it("非当前玩家提交 → 抛出错误", () => {
    const mkt = [makeLane([card("cheap", "c4")])];
    const state = makeState({}, {}, mkt);

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4 }],
      Math.random, 32, seqId, getCardCost
    );

    expect(() => resolveChoice(withChoice, 1, ["c4"], Math.random, 32, seqId, getCardCost))
      .toThrow(/非选择方/);
  });

  it("提交不在候选列表中的实例 → 抛出错误", () => {
    const mkt = [makeLane([card("cheap", "c5")])];
    const state = makeState({}, {}, mkt);

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "gainFaceUpCard", maxCost: 4 }],
      Math.random, 32, seqId, getCardCost
    );

    expect(() => resolveChoice(withChoice, 0, ["nonexistent"], Math.random, 32, seqId, getCardCost))
      .toThrow(/不在可选市场牌/);
  });
});

// ── chooseTarget ──────────────────────────────────────────────────────────────

describe("chooseTarget — 场馆 / 玩家目标选择", () => {
  it("opponentVenue → 候选为对方场馆，产生 chooseTarget pendingChoice", () => {
    const venue = { instanceId: "v1", cardId: "white_duty_student", owner: 1 as const,
      isGuard: false, durability: 4, maxDurability: 4, activationsLeft: 1, activationsPerTurn: 1 };
    const state = makeState({}, { venues: [venue] });

    const result = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentVenue", onChosen: [{ op: "damageVenue", amount: 2 }] }],
      Math.random, 32, seqId
    );

    expect(result.pendingChoice?.type).toBe("chooseTarget");
    const choice = result.pendingChoice as Extract<typeof result.pendingChoice, { type: "chooseTarget" }>;
    expect(choice.candidates).toHaveLength(1);
    expect(choice.candidates[0]).toMatchObject({ kind: "venue", instanceId: "v1" });
  });

  it("选中对方场馆 → damageVenue 减少耐久", () => {
    const venue = { instanceId: "v1", cardId: "wd", owner: 1 as const,
      isGuard: false, durability: 4, maxDurability: 4, activationsLeft: 1, activationsPerTurn: 1 };
    const state = makeState({}, { venues: [venue] });

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentVenue", onChosen: [{ op: "damageVenue", amount: 2 }] }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withChoice, 0, ["v1"], Math.random, 32, seqId);

    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.players[1].venues[0].durability).toBe(2);
  });

  it("damageVenue 使耐久 ≤ 0 → 场馆被摧毁", () => {
    const venue = { instanceId: "v2", cardId: "wd", owner: 1 as const,
      isGuard: false, durability: 2, maxDurability: 4, activationsLeft: 1, activationsPerTurn: 1 };
    const state = makeState({}, { venues: [venue] });

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentVenue", onChosen: [{ op: "damageVenue", amount: 3 }] }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withChoice, 0, ["v2"], Math.random, 32, seqId);

    expect(resolved.players[1].venues).toHaveLength(0);
  });

  it("对手无场馆 → opponentVenue chooseTarget 直接跳过（无 pendingChoice）", () => {
    const state = makeState({}, { venues: [] });

    const result = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentVenue", onChosen: [{ op: "damageVenue", amount: 2 }] }],
      Math.random, 32, seqId
    );

    expect(result.pendingChoice).toBeNull();
  });

  it("opponentPlayer → 候选为对手玩家", () => {
    const state = makeState();

    const result = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentPlayer", onChosen: [{ op: "dealDamage", amount: 3 }] }],
      Math.random, 32, seqId
    );

    expect(result.pendingChoice?.type).toBe("chooseTarget");
    const choice = result.pendingChoice as Extract<typeof result.pendingChoice, { type: "chooseTarget" }>;
    expect(choice.candidates[0]).toMatchObject({ kind: "player", side: 1 });
  });

  it("dealDamage → 玩家 HP 减少", () => {
    const state = makeState({}, { hp: 10 });

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentPlayer", onChosen: [{ op: "dealDamage", amount: 3 }] }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withChoice, 0, ["player:1"], Math.random, 32, seqId);

    expect(resolved.players[1].hp).toBe(7);
  });

  it("提交非法目标 ID → 抛出错误", () => {
    const state = makeState();

    const withChoice = applyStateEffects(
      state, 0,
      [{ op: "chooseTarget", targetType: "opponentPlayer", onChosen: [{ op: "dealDamage", amount: 1 }] }],
      Math.random, 32, seqId
    );

    expect(() => resolveChoice(withChoice, 0, ["player:0"], Math.random, 32, seqId))
      .toThrow(/不在合法候选列表/);
  });
});
