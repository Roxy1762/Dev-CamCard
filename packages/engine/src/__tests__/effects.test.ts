import { describe, it, expect } from "vitest";
import { applyEffects, applyStateEffects, checkCondition } from "../effects";
import type { CardCondition, CardEffect } from "../effects";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

let idCounter = 0;
const seqId = () => `gen-${idCounter++}`;

function card(cardId = "c", instanceId?: string): CardInstance {
  return { instanceId: instanceId ?? `c-${idCounter++}`, cardId };
}

function makePlayer(overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side: 0,
    name: "测试玩家",
    hp: 20,
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

function makeState(
  overrides: Partial<InternalMatchState> = {},
  p0?: Partial<InternalPlayerState>,
  p1?: Partial<InternalPlayerState>
): InternalMatchState {
  return {
    roomId: "room-1",
    rulesetId: "core-v1",
    turnNumber: 1,
    activePlayer: 0,
    players: [
      makePlayer({ side: 0, ...p0 }),
      makePlayer({ side: 1, ...p1 }),
    ],
    market: [],
    fixedSupplies: [],
    readyPlayers: [true, true],
    started: true,
    ended: false,
    winner: null,
    ...overrides,
  };
}

// ── applyEffects — 现有 ops ────────────────────────────────────────────────────

describe("applyEffects: gainResource / gainAttack / gainBlock / heal / draw", () => {
  it("gainResource 正确累加", () => {
    const p = makePlayer({ resourcePool: 3 });
    const result = applyEffects(p, [{ op: "gainResource", amount: 2 }]);
    expect(result.resourcePool).toBe(5);
  });

  it("gainAttack 正确累加", () => {
    const p = makePlayer({ attackPool: 1 });
    const result = applyEffects(p, [{ op: "gainAttack", amount: 3 }]);
    expect(result.attackPool).toBe(4);
  });

  it("gainBlock 正确累加", () => {
    const p = makePlayer({ block: 0 });
    const result = applyEffects(p, [{ op: "gainBlock", amount: 2 }]);
    expect(result.block).toBe(2);
  });

  it("heal 不超过 maxHp", () => {
    const p = makePlayer({ hp: 19 });
    const result = applyEffects(p, [{ op: "heal", amount: 5 }], Math.random, 20);
    expect(result.hp).toBe(20);
  });

  it("draw 从牌堆摸牌", () => {
    const deck = [card("a"), card("b"), card("c")];
    const p = makePlayer({ deck });
    const result = applyEffects(p, [{ op: "draw", count: 2 }]);
    expect(result.hand).toHaveLength(2);
    expect(result.deck).toHaveLength(1);
  });
});

// ── applyEffects — 新 ops ─────────────────────────────────────────────────────

describe("applyEffects: scry", () => {
  it("scry 将牌堆顶 N 张随机重洗（MVP 行为）", () => {
    const deck = [card("a", "a"), card("b", "b"), card("c", "c"), card("d", "d")];
    const p = makePlayer({ deck });
    // seeded random = 0, shuffle 行为固定
    const result = applyEffects(p, [{ op: "scry", count: 2 }], () => 0);
    // 牌堆总数不变
    expect(result.deck).toHaveLength(4);
    // 后两张（不参与预习）保持原序
    expect(result.deck[2]).toEqual(deck[2]);
    expect(result.deck[3]).toEqual(deck[3]);
  });

  it("scry count > deck 时只洗实际存在的牌", () => {
    const deck = [card("a", "a"), card("b", "b")];
    const p = makePlayer({ deck });
    const result = applyEffects(p, [{ op: "scry", count: 5 }], () => 0);
    expect(result.deck).toHaveLength(2);
  });

  it("空牌堆 scry 无操作", () => {
    const p = makePlayer();
    const result = applyEffects(p, [{ op: "scry", count: 2 }]);
    expect(result.deck).toHaveLength(0);
  });
});

describe("applyEffects: setFlag", () => {
  it("setFlag 添加标志位到 activeFlags", () => {
    const p = makePlayer();
    const result = applyEffects(p, [{ op: "setFlag", flag: "nextBoughtCardToDeckTop" }]);
    expect(result.activeFlags).toContain("nextBoughtCardToDeckTop");
  });

  it("setFlag 幂等：重复设置不重复添加", () => {
    const p = makePlayer({ activeFlags: ["nextBoughtCardToDeckTop"] });
    const result = applyEffects(p, [{ op: "setFlag", flag: "nextBoughtCardToDeckTop" }]);
    expect(result.activeFlags).toHaveLength(1);
  });
});

describe("applyEffects: createPressure (自我级别跳过)", () => {
  it("applyEffects 跳过 createPressure（由 applyStateEffects 处理）", () => {
    const p = makePlayer({ hp: 10 });
    // 不应抛错，createPressure 被跳过
    const result = applyEffects(p, [
      { op: "createPressure", count: 2 },
      { op: "gainResource", amount: 1 },
    ]);
    expect(result.resourcePool).toBe(1);
    expect(result.hand).toHaveLength(0); // 没有压力牌加到 self
  });
});

// ── applyStateEffects — createPressure ───────────────────────────────────────

describe("applyStateEffects: createPressure", () => {
  it("createPressure target=opponent 将压力牌加入对手手牌", () => {
    const state = makeState();
    const result = applyStateEffects(
      state,
      0,
      [{ op: "createPressure", count: 2 }],
      Math.random,
      32,
      seqId
    );

    // 对手（side=1）手牌应有 2 张 status_pressure
    const oppHand = result.players[1].hand;
    expect(oppHand).toHaveLength(2);
    expect(oppHand[0].cardId).toBe("status_pressure");
    expect(oppHand[1].cardId).toBe("status_pressure");
    // 每张实例 ID 唯一
    expect(oppHand[0].instanceId).not.toBe(oppHand[1].instanceId);
  });

  it("createPressure target=self 将压力牌加入自己手牌", () => {
    const state = makeState();
    const result = applyStateEffects(
      state,
      0,
      [{ op: "createPressure", count: 1, target: "self" }],
      Math.random,
      32,
      seqId
    );

    expect(result.players[0].hand).toHaveLength(1);
    expect(result.players[0].hand[0].cardId).toBe("status_pressure");
    // 对手不受影响
    expect(result.players[1].hand).toHaveLength(0);
  });

  it("混合效果：gainResource（自我）+ createPressure（对手）", () => {
    const state = makeState(undefined, { resourcePool: 3 });
    const result = applyStateEffects(
      state,
      0,
      [
        { op: "gainResource", amount: 2 },
        { op: "createPressure", count: 1 },
      ],
      Math.random,
      32,
      seqId
    );

    expect(result.players[0].resourcePool).toBe(5);
    expect(result.players[1].hand).toHaveLength(1);
    expect(result.players[1].hand[0].cardId).toBe("status_pressure");
  });

  it("createPressure 给双方（finals week 场景）", () => {
    const state = makeState(undefined, { resourcePool: 0 }, { resourcePool: 0 });
    const result = applyStateEffects(
      state,
      0,
      [
        { op: "createPressure", count: 2, target: "opponent" },
        { op: "createPressure", count: 1, target: "self" },
      ],
      Math.random,
      32,
      seqId
    );

    // 对手得 2 压力
    expect(result.players[1].hand).toHaveLength(2);
    // 自己得 1 压力
    expect(result.players[0].hand).toHaveLength(1);
  });
});

// ── checkCondition ────────────────────────────────────────────────────────────

describe("checkCondition", () => {
  it("firstActionThisTurn: played.length===1 时满足", () => {
    const p = makePlayer({ played: [card("a")] });
    const cond: CardCondition = { type: "firstActionThisTurn" };
    expect(checkCondition(p, cond)).toBe(true);
  });

  it("firstActionThisTurn: played.length>1 时不满足", () => {
    const p = makePlayer({ played: [card("a"), card("b")] });
    expect(checkCondition(p, { type: "firstActionThisTurn" })).toBe(false);
  });

  it("actionsPlayedAtLeast: 满足时返回 true", () => {
    const p = makePlayer({ played: [card("a"), card("b")] });
    expect(checkCondition(p, { type: "actionsPlayedAtLeast", count: 2 })).toBe(true);
  });

  it("actionsPlayedAtLeast: 不满足时返回 false", () => {
    const p = makePlayer({ played: [card("a")] });
    expect(checkCondition(p, { type: "actionsPlayedAtLeast", count: 3 })).toBe(false);
  });

  it("hasVenue: 有场馆时返回 true", () => {
    const p = makePlayer({
      venues: [{
        instanceId: "v1", cardId: "some_venue", owner: 0,
        isGuard: false, durability: 3, maxDurability: 3,
        activationsLeft: 1, activationsPerTurn: 1,
      }],
    });
    expect(checkCondition(p, { type: "hasVenue" })).toBe(true);
  });

  it("hasVenue: 无场馆时返回 false", () => {
    const p = makePlayer();
    expect(checkCondition(p, { type: "hasVenue" })).toBe(false);
  });

  it("hasScheduledCard: 日程槽有牌时满足", () => {
    const p = makePlayer({ scheduleSlots: [card("sched"), null] });
    expect(checkCondition(p, { type: "hasScheduledCard" })).toBe(true);
  });

  it("hasScheduledCard: 日程槽全空时不满足", () => {
    const p = makePlayer({ scheduleSlots: [null, null] });
    expect(checkCondition(p, { type: "hasScheduledCard" })).toBe(false);
  });

  it("hasReservedCard: 预约位有牌时满足", () => {
    const p = makePlayer({ reservedCard: card("reserved") });
    expect(checkCondition(p, { type: "hasReservedCard" })).toBe(true);
  });

  it("hasReservedCard: 预约位空时不满足", () => {
    const p = makePlayer();
    expect(checkCondition(p, { type: "hasReservedCard" })).toBe(false);
  });
});
