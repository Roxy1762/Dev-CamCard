/**
 * delayedDiscard.test.ts
 *
 * 覆盖 queueDelayedDiscard 效果的完整行为：
 *  - applyStateEffects 正确积累 pendingDiscardCount
 *  - beginTurn 正确结算并归零
 *  - 多个效果叠加
 *  - 手牌不足时的边界处理
 *  - 与 endTurn / beginTurn 全链路衔接
 *  - 白色控制牌数据正确匹配效果
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { applyStateEffects } from "../effects";
import { beginTurn, endTurn } from "../turn";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

let _id = 0;
function card(cardId = "c"): CardInstance {
  return { instanceId: `inst-${_id++}`, cardId };
}

function makePlayer(
  side: 0 | 1,
  overrides: Partial<InternalPlayerState> = {}
): InternalPlayerState {
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
    players: [makePlayer(0, p0), makePlayer(1, p1)],
    market: [],
    fixedSupplies: [],
    readyPlayers: [true, true],
    started: true,
    ended: false,
    winner: null,
    ...overrides,
  };
}

// 测试用 genId（确定性序列）
let _genCounter = 0;
function genId(): string {
  return `gen-${_genCounter++}`;
}

// ── applyStateEffects: queueDelayedDiscard ────────────────────────────────────

describe("applyStateEffects: queueDelayedDiscard 积累阶段", () => {
  it("默认目标为对手 — 对手 pendingDiscardCount 增加", () => {
    const state = makeState();
    const result = applyStateEffects(
      state,
      0, // activeSide = player0
      [{ op: "queueDelayedDiscard", count: 1 }],
      Math.random,
      32,
      genId
    );
    expect(result.players[1].pendingDiscardCount).toBe(1);
    expect(result.players[0].pendingDiscardCount).toBe(0); // 自己不受影响
  });

  it("target: opponent 显式指定 — 对手 pendingDiscardCount 增加", () => {
    const state = makeState();
    const result = applyStateEffects(
      state,
      0,
      [{ op: "queueDelayedDiscard", count: 2, target: "opponent" }],
      Math.random,
      32,
      genId
    );
    expect(result.players[1].pendingDiscardCount).toBe(2);
  });

  it("target: self — 自己 pendingDiscardCount 增加", () => {
    const state = makeState();
    const result = applyStateEffects(
      state,
      0,
      [{ op: "queueDelayedDiscard", count: 2, target: "self" }],
      Math.random,
      32,
      genId
    );
    expect(result.players[0].pendingDiscardCount).toBe(2);
    expect(result.players[1].pendingDiscardCount).toBe(0);
  });

  it("多次 queueDelayedDiscard 效果叠加到同一目标", () => {
    const state = makeState();
    // 三张牌（discipline_warning + dorm_inspection + student_affairs_talk）分别打出
    let s = applyStateEffects(state, 0, [{ op: "queueDelayedDiscard", count: 1 }], Math.random, 32, genId);
    s = applyStateEffects(s, 0, [{ op: "queueDelayedDiscard", count: 2 }], Math.random, 32, genId);
    s = applyStateEffects(s, 0, [{ op: "queueDelayedDiscard", count: 3 }], Math.random, 32, genId);
    expect(s.players[1].pendingDiscardCount).toBe(6);
  });

  it("从 side=1 向 side=0 积累", () => {
    const state = makeState({ activePlayer: 1 });
    const result = applyStateEffects(
      state,
      1,
      [{ op: "queueDelayedDiscard", count: 2 }],
      Math.random,
      32,
      genId
    );
    expect(result.players[0].pendingDiscardCount).toBe(2);
    expect(result.players[1].pendingDiscardCount).toBe(0);
  });

  it("queueDelayedDiscard 与 gainBlock 组合 — 两者互不干扰", () => {
    const state = makeState();
    const result = applyStateEffects(
      state,
      0,
      [
        { op: "queueDelayedDiscard", count: 3, target: "opponent" },
        { op: "gainBlock", amount: 3 },
      ],
      Math.random,
      32,
      genId
    );
    // 自己获得防备
    expect(result.players[0].block).toBe(3);
    // 对手被打标记
    expect(result.players[1].pendingDiscardCount).toBe(3);
  });
});

// ── beginTurn: 延迟弃牌结算 ───────────────────────────────────────────────────

describe("beginTurn: 结算 pendingDiscardCount", () => {
  it("手牌充足 — 精确弃 count 张，pendingDiscardCount 归零", () => {
    const hand = [card("a"), card("b"), card("c"), card("d"), card("e")];
    const state = makeState(
      {},
      { hand, pendingDiscardCount: 2 } // player0 有 2 张待弃
    );
    // beginTurn 结算 player0 的 pending（activePlayer=0）
    const result = beginTurn(state);
    const p0 = result.players[0];
    expect(p0.hand).toHaveLength(3);          // 5 - 2 = 3
    expect(p0.discard).toHaveLength(2);        // 弃了 2 张
    expect(p0.pendingDiscardCount).toBe(0);    // 归零
  });

  it("手牌不足 — 全部弃光，不抛错，归零", () => {
    const hand = [card("x"), card("y")];
    const state = makeState({}, { hand, pendingDiscardCount: 5 });
    const result = beginTurn(state);
    const p0 = result.players[0];
    expect(p0.hand).toHaveLength(0);           // 全部弃光
    expect(p0.discard).toHaveLength(2);        // 只弃了实际存在的 2 张
    expect(p0.pendingDiscardCount).toBe(0);    // 归零
  });

  it("手牌为空 — 什么都不弃，正常归零", () => {
    const state = makeState({}, { hand: [], pendingDiscardCount: 3 });
    const result = beginTurn(state);
    const p0 = result.players[0];
    expect(p0.hand).toHaveLength(0);
    expect(p0.discard).toHaveLength(0);
    expect(p0.pendingDiscardCount).toBe(0);
  });

  it("pendingDiscardCount=0 — 不影响手牌", () => {
    const hand = [card("a"), card("b"), card("c")];
    const state = makeState({}, { hand, pendingDiscardCount: 0 });
    const result = beginTurn(state);
    expect(result.players[0].hand).toHaveLength(3);
  });

  it("弃牌精确取自手牌头部（最早入手的先弃）", () => {
    const a = card("a");
    const b = card("b");
    const c = card("c");
    const hand = [a, b, c];
    const state = makeState({}, { hand, pendingDiscardCount: 1 });
    const result = beginTurn(state);
    const p0 = result.players[0];
    // 只弃了 a（第一张）
    expect(p0.hand.map((c) => c.instanceId)).toEqual([b.instanceId, c.instanceId]);
    expect(p0.discard[0].instanceId).toBe(a.instanceId);
  });
});

// ── beginTurn 不结算非活跃方的 pending ────────────────────────────────────────

describe("beginTurn 只结算当前活跃玩家的 pending", () => {
  it("player1 有 pending，但 activePlayer=0 时不结算 player1", () => {
    const state = makeState(
      { activePlayer: 0 },
      { hand: [card("a"), card("b")] },          // p0 无 pending
      { hand: [card("c"), card("d")], pendingDiscardCount: 2 } // p1 有 pending
    );
    const result = beginTurn(state);
    // p1 的 pending 不应被结算（不是本回合活跃方）
    expect(result.players[1].pendingDiscardCount).toBe(2);
    expect(result.players[1].hand).toHaveLength(2);
    // p0 正常
    expect(result.players[0].pendingDiscardCount).toBe(0);
  });
});

// ── endTurn → beginTurn 全链路 ────────────────────────────────────────────────

describe("endTurn / beginTurn 延迟弃牌全链路", () => {
  it("player0 打出控制牌后，player1 在下回合开始时弃牌", () => {
    // 在真实游戏流程中，player1 的手牌在自己上回合结束时已抽好（5 张）。
    // endTurn(player0) 只给 player0 摸新牌，不影响 player1 的现有手牌。
    // beginTurn(player1) 结算 pendingDiscardCount 时，player1 手牌已有 5 张。
    const p1Hand = [card("d1"), card("d2"), card("d3"), card("d4"), card("d5")];

    let state = makeState(
      { activePlayer: 0 },
      { resourcePool: 5 },
      { hand: p1Hand }
    );

    // 手动给 player1 施加延迟弃牌（等价于 player0 打出 white_student_affairs_talk）
    state = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], pendingDiscardCount: 3 },
      ] as [InternalPlayerState, InternalPlayerState],
    };

    // player0 结束回合 → endTurn → player1 开始回合（beginTurn 结算 pending）
    const afterEnd = endTurn(state, 5, () => 0);

    // endTurn 后切换到 player1，beginTurn 已结算
    expect(afterEnd.activePlayer).toBe(1);

    const p1After = afterEnd.players[1];
    // player1 本来有 5 张手牌，beginTurn 弃 3 张 → 剩 2 张
    expect(p1After.pendingDiscardCount).toBe(0);
    expect(p1After.hand).toHaveLength(2); // 5 - 3 = 2
    expect(p1After.discard).toHaveLength(3);
  });

  it("多轮叠加：两张控制牌打出，对手积累 pendingDiscardCount=5，下回合弃 5", () => {
    // player1 手牌有 5 张
    const p1Hand = Array.from({ length: 5 }, (_, i) => card(`d${i}`));

    let state = makeState(
      { activePlayer: 0 },
      {},
      { hand: p1Hand }
    );

    // 叠加两次：2 + 3 = 5
    state = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], pendingDiscardCount: 5 },
      ] as [InternalPlayerState, InternalPlayerState],
    };

    const afterEnd = endTurn(state, 5, () => 0);
    const p1After = afterEnd.players[1];

    expect(p1After.pendingDiscardCount).toBe(0);
    expect(p1After.hand).toHaveLength(0); // 5 - 5 = 0
    expect(p1After.discard).toHaveLength(5);
  });

  it("pendingDiscardCount 在 endTurn 时不被清除 — 保留到 beginTurn 才结算", () => {
    // player1 有 pending，此时 activePlayer=1，player1 结束回合
    const p0Deck = Array.from({ length: 5 }, (_, i) => card(`p0d${i}`));

    const state = makeState(
      { activePlayer: 1 },
      { deck: p0Deck },
      { pendingDiscardCount: 2 } // player1 自身有 pending（不常见但需确保逻辑正确）
    );

    // endTurn player1 → beginTurn player0（此时切换到 player0，player1 的 pending 不结算）
    const afterEnd = endTurn(state, 5, () => 0);

    // activePlayer 应切换到 0
    expect(afterEnd.activePlayer).toBe(0);
    // player1 的 pending 未结算（因为 beginTurn 只处理活跃方）
    expect(afterEnd.players[1].pendingDiscardCount).toBe(2);
  });
});

// ── 与白色控制牌数据的集成验证 ───────────────────────────────────────────────

describe("白色控制牌效果数据验证", () => {
  const marketPath = path.resolve(__dirname, "../../../../data/cards/market-core.json");
  const cards: Array<{
    id: string;
    abilities?: Array<{
      trigger: string;
      effects: Array<{ op: string; count?: number; amount?: number; target?: string }>;
    }>;
  }> = JSON.parse(fs.readFileSync(marketPath, "utf-8"));

  function findCard(id: string) {
    return cards.find((c) => c.id === id);
  }

  it("white_discipline_warning: onPlay 包含 queueDelayedDiscard(opponent, 1) + gainBlock(2)", () => {
    const c = findCard("white_discipline_warning");
    expect(c).toBeDefined();
    const onPlay = c!.abilities?.find((a) => a.trigger === "onPlay");
    expect(onPlay).toBeDefined();
    const delayed = onPlay!.effects.find((e) => e.op === "queueDelayedDiscard");
    expect(delayed).toMatchObject({ op: "queueDelayedDiscard", count: 1, target: "opponent" });
    const block = onPlay!.effects.find((e) => e.op === "gainBlock");
    expect(block).toMatchObject({ op: "gainBlock", amount: 2 });
  });

  it("white_dorm_inspection: onPlay 包含 queueDelayedDiscard(opponent, 2) + gainBlock(1)", () => {
    const c = findCard("white_dorm_inspection");
    expect(c).toBeDefined();
    const onPlay = c!.abilities?.find((a) => a.trigger === "onPlay");
    const delayed = onPlay!.effects.find((e) => e.op === "queueDelayedDiscard");
    expect(delayed).toMatchObject({ op: "queueDelayedDiscard", count: 2, target: "opponent" });
    const block = onPlay!.effects.find((e) => e.op === "gainBlock");
    expect(block).toMatchObject({ op: "gainBlock", amount: 1 });
  });

  it("white_student_affairs_talk: onPlay 包含 queueDelayedDiscard(opponent, 3) + gainBlock(3)", () => {
    const c = findCard("white_student_affairs_talk");
    expect(c).toBeDefined();
    const onPlay = c!.abilities?.find((a) => a.trigger === "onPlay");
    const delayed = onPlay!.effects.find((e) => e.op === "queueDelayedDiscard");
    expect(delayed).toMatchObject({ op: "queueDelayedDiscard", count: 3, target: "opponent" });
    const block = onPlay!.effects.find((e) => e.op === "gainBlock");
    expect(block).toMatchObject({ op: "gainBlock", amount: 3 });
  });

  it("三张白色控制牌均不再含 createPressure", () => {
    for (const id of ["white_discipline_warning", "white_dorm_inspection", "white_student_affairs_talk"]) {
      const c = findCard(id);
      const hasPressure = c?.abilities?.some((a) =>
        a.effects.some((e) => e.op === "createPressure")
      );
      expect(hasPressure).toBe(false);
    }
  });
});
