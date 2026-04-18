/**
 * pendingChoice.test.ts
 *
 * 覆盖 pending-choice 状态机的核心行为：
 *  - trashFromHandOrDiscard 产生 pendingChoice
 *  - 交互式 scry 产生 pendingChoice + 翻出牌
 *  - resolveChoice 正确应用选择并继续 remainingEffects
 *  - 非法操作：错误玩家提交 / 空选择 / 越界选择 / 不在区域内
 *  - 有 pendingChoice 时其他命令被拒绝
 *  - 弃牌堆报废 / 手牌报废
 */
import { describe, it, expect } from "vitest";
import { applyStateEffects, resolveChoice } from "../effects";
import { reduce } from "../reduce";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "../types";
import type { EngineConfig } from "../reduce";
import type { CardDef } from "../effects";
import { CMD } from "@dev-camcard/protocol";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

let _id = 0;
const seqId = () => `g-${_id++}`;

function card(cardId = "c", iid?: string): CardInstance {
  return { instanceId: iid ?? `ci-${_id++}`, cardId };
}

function makePlayer(
  side: 0 | 1,
  overrides: Partial<InternalPlayerState> = {}
): InternalPlayerState {
  return {
    side, name: `P${side}`, hp: 32, block: 0,
    resourcePool: 0, attackPool: 0,
    deck: [], hand: [], discard: [], played: [], venues: [],
    scheduleSlots: [null, null],
    reservedCard: null, reservedCardTurn: null,
    hasReservedThisTurn: false, activeFlags: [],
    pendingDiscardCount: 0,
    ...overrides,
  };
}

function makeState(
  p0?: Partial<InternalPlayerState>,
  p1?: Partial<InternalPlayerState>,
  extra: Partial<InternalMatchState> = {}
): InternalMatchState {
  return {
    roomId: "r1", rulesetId: "core-v1", turnNumber: 1,
    activePlayer: 0,
    players: [makePlayer(0, p0), makePlayer(1, p1)],
    market: [], fixedSupplies: [],
    readyPlayers: [true, true],
    started: true, ended: false, winner: null,
    pendingChoice: null,
    ...extra,
  };
}

// 最小 EngineConfig（仅用于 reduce 集成测试）
function makeConfig(cardDefs: CardDef[] = []): EngineConfig {
  const defMap = new Map(cardDefs.map((d) => [d.id, d]));
  return {
    ruleset: {
      id: "core-v1", hp: 32, handSize: 5,
      firstPlayerOpeningHand: 4, secondPlayerOpeningHand: 5,
      scheduleSlots: 2, reserveSlots: 1,
      marketLanesCount: 3, marketSlotsPerLane: 2,
      starterDeck: [], fixedSupplies: [],
    },
    getCardCost: () => 0,
    getCardDef: (id) => defMap.get(id),
  };
}

// ── trashFromHandOrDiscard ────────────────────────────────────────────────────

describe("trashFromHandOrDiscard — pendingChoice 产生", () => {
  it("打出带 trashFromHandOrDiscard 效果的牌后状态挂起", () => {
    const state = makeState({ hand: [card("a"), card("b")] });
    const result = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1 }],
      Math.random, 32, seqId
    );
    expect(result.pendingChoice).not.toBeNull();
    expect(result.pendingChoice!.type).toBe("chooseCardsFromHandOrDiscard");
    expect(result.pendingChoice!.forSide).toBe(0);
    if (!result.pendingChoice || result.pendingChoice.type !== "chooseCardsFromHandOrDiscard") {
      throw new Error("expected chooseCardsFromHandOrDiscard pendingChoice");
    }
    expect(result.pendingChoice.maxCount).toBe(1);
  });

  it("zone=hand → chooseCardsFromHand", () => {
    const state = makeState({ hand: [card("a")] });
    const result = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    expect(result.pendingChoice!.type).toBe("chooseCardsFromHand");
  });

  it("zone=discard → chooseCardsFromDiscard", () => {
    const state = makeState({ discard: [card("x")] });
    const result = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "discard" }],
      Math.random, 32, seqId
    );
    expect(result.pendingChoice!.type).toBe("chooseCardsFromDiscard");
  });

  it("trash 前的效果已立即应用，trash 后的效果存入 remainingEffects", () => {
    const state = makeState({ hand: [card("a")], resourcePool: 0 });
    // gainResource(1) 先执行；trashFromHandOrDiscard 产生 pending；gainAttack(2) 进 remainingEffects
    const result = applyStateEffects(
      state, 0,
      [
        { op: "gainResource", amount: 1 },
        { op: "trashFromHandOrDiscard", count: 1 },
        { op: "gainAttack", amount: 2 },
      ],
      Math.random, 32, seqId
    );
    expect(result.players[0].resourcePool).toBe(1);   // 已应用
    expect(result.players[0].attackPool).toBe(0);     // 未应用（在 remaining 中）
    expect(result.pendingChoice!.remainingEffects).toHaveLength(1);
    expect(result.pendingChoice!.remainingEffects[0]).toMatchObject({ op: "gainAttack", amount: 2 });
  });
});

describe("resolveChoice — 从手牌报废", () => {
  it("正常报废 1 张手牌，继续 remainingEffects", () => {
    const handCard = card("a", "inst-a");
    const state = makeState({ hand: [handCard, card("b")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }, { op: "gainResource", amount: 3 }],
      Math.random, 32, seqId
    );
    expect(withPending.pendingChoice).not.toBeNull();

    const resolved = resolveChoice(withPending, 0, ["inst-a"], Math.random, 32, seqId);
    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.players[0].hand).toHaveLength(1);           // 报废了 inst-a
    expect(resolved.players[0].hand[0].cardId).toBe("b");
    expect(resolved.players[0].resourcePool).toBe(3);           // remainingEffects 已执行
  });

  it("可以选择 0 张（minCount=0）", () => {
    const state = makeState({ hand: [card("a")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withPending, 0, [], Math.random, 32, seqId);
    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.players[0].hand).toHaveLength(1);   // 没有报废任何牌
  });

  it("手牌为空时仍可提交空选择", () => {
    const state = makeState({ hand: [] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withPending, 0, [], Math.random, 32, seqId);
    expect(resolved.pendingChoice).toBeNull();
  });
});

describe("resolveChoice — 从弃牌堆报废", () => {
  it("正常报废 1 张弃牌堆的牌", () => {
    const discardCard = card("old", "inst-old");
    const state = makeState({ discard: [discardCard] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "discard" }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withPending, 0, ["inst-old"], Math.random, 32, seqId);
    expect(resolved.players[0].discard).toHaveLength(0);
  });
});

describe("resolveChoice — HandOrDiscard", () => {
  it("可以选手牌中的牌", () => {
    const h = card("h", "inst-h");
    const d = card("d", "inst-d");
    const state = makeState({ hand: [h], discard: [d] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1 }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withPending, 0, ["inst-h"], Math.random, 32, seqId);
    expect(resolved.players[0].hand).toHaveLength(0);
    expect(resolved.players[0].discard).toHaveLength(1);
  });

  it("可以选弃牌堆中的牌", () => {
    const h = card("h", "inst-h");
    const d = card("d", "inst-d");
    const state = makeState({ hand: [h], discard: [d] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1 }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withPending, 0, ["inst-d"], Math.random, 32, seqId);
    expect(resolved.players[0].hand).toHaveLength(1);
    expect(resolved.players[0].discard).toHaveLength(0);
  });
});

// ── 交互式 scry ───────────────────────────────────────────────────────────────

describe("交互式 scry — pendingChoice 产生", () => {
  it("产生 scryDecision，并从牌堆移出翻开的牌", () => {
    const a = card("a", "ia"); const b = card("b", "ib"); const c = card("c", "ic");
    const rest = card("d", "id");
    const state = makeState({ deck: [a, b, c, rest] });

    const result = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 3, interactive: true }],
      Math.random, 32, seqId
    );
    expect(result.pendingChoice!.type).toBe("scryDecision");
    const choice = result.pendingChoice as Extract<typeof result.pendingChoice, { type: "scryDecision" }>;
    expect(choice!.revealedCards).toHaveLength(3);
    expect(choice!.deckBelow).toHaveLength(1);
    expect(choice!.deckBelow[0].instanceId).toBe("id");
    // 牌堆中已移走翻开的牌（只剩 deckBelow）
    expect(result.players[0].deck).toHaveLength(1);
    expect(result.players[0].deck[0].instanceId).toBe("id");
  });

  it("牌堆不足时只翻实际有的张数", () => {
    const state = makeState({ deck: [card("a"), card("b")] });
    const result = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 5, interactive: true }],
      Math.random, 32, seqId
    );
    const choice = result.pendingChoice!;
    expect(choice.type).toBe("scryDecision");
    const sc = choice as Extract<typeof choice, { type: "scryDecision" }>;
    expect(sc.revealedCards).toHaveLength(2);
    expect(sc.deckBelow).toHaveLength(0);
  });
});

describe("resolveChoice — scryDecision", () => {
  it("选择弃掉 1 张，其余原序放回牌堆顶", () => {
    const a = card("a", "ia"); const b = card("b", "ib"); const c = card("c", "ic");
    const state = makeState({ deck: [a, b, c] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 3, interactive: true }],
      Math.random, 32, seqId
    );

    // 弃掉 b，保留 a 和 c 按原序放回
    const resolved = resolveChoice(withPending, 0, ["ib"], Math.random, 32, seqId);
    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.players[0].discard).toHaveLength(1);
    expect(resolved.players[0].discard[0].instanceId).toBe("ib");
    expect(resolved.players[0].deck).toHaveLength(2);
    expect(resolved.players[0].deck[0].instanceId).toBe("ia");
    expect(resolved.players[0].deck[1].instanceId).toBe("ic");
  });

  it("选择不弃任何牌（空选择），所有牌原序放回", () => {
    const a = card("a", "ia"); const b = card("b", "ib");
    const state = makeState({ deck: [a, b] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 2, interactive: true }],
      Math.random, 32, seqId
    );
    const resolved = resolveChoice(withPending, 0, [], Math.random, 32, seqId);
    expect(resolved.players[0].deck).toHaveLength(2);
    expect(resolved.players[0].deck[0].instanceId).toBe("ia");
    expect(resolved.players[0].deck[1].instanceId).toBe("ib");
    expect(resolved.players[0].discard).toHaveLength(0);
  });

  it("scry 后的 remainingEffects 被执行（gainResource）", () => {
    const state = makeState({ deck: [card("a", "ia")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 1, interactive: true }, { op: "gainResource", amount: 2 }],
      Math.random, 32, seqId
    );
    expect(withPending.players[0].resourcePool).toBe(0);   // 还未执行

    const resolved = resolveChoice(withPending, 0, [], Math.random, 32, seqId);
    expect(resolved.players[0].resourcePool).toBe(2);      // 选择完成后执行
  });
});

// ── 边界与安全检查 ─────────────────────────────────────────────────────────────

describe("resolveChoice — 错误玩家提交", () => {
  it("非选择方提交时抛出错误", () => {
    const state = makeState({ hand: [card("a")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    expect(() =>
      resolveChoice(withPending, 1, [], Math.random, 32, seqId)
    ).toThrow("非选择方");
  });
});

describe("resolveChoice — 实例 ID 不在合法区域", () => {
  it("提交不存在于手牌的 instanceId 时抛出错误", () => {
    const state = makeState({ hand: [card("a", "ia")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    expect(() =>
      resolveChoice(withPending, 0, ["not-exist"], Math.random, 32, seqId)
    ).toThrow("不在手牌中");
  });

  it("scryDecision 中提交不在 revealedCards 的 ID 时抛出错误", () => {
    const state = makeState({ deck: [card("a", "ia")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 1, interactive: true }],
      Math.random, 32, seqId
    );
    expect(() =>
      resolveChoice(withPending, 0, ["not-in-scry"], Math.random, 32, seqId)
    ).toThrow("不在预习牌中");
  });

  it("scryDecision 超出 maxDiscard 时抛出错误", () => {
    const state = makeState({ deck: [card("a", "ia"), card("b", "ib")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "scry", count: 2, interactive: true }],
      Math.random, 32, seqId
    );
    expect(() =>
      resolveChoice(withPending, 0, ["ia", "ib"], Math.random, 32, seqId)
    ).toThrow("最多可弃 1 张");
  });
});

describe("有 pendingChoice 时其他命令被拒绝", () => {
  it("PLAY_CARD 被拒绝", () => {
    const hand = [card("action", "act-1")];
    const actionDef: CardDef = {
      id: "action", type: "action",
      abilities: [{ trigger: "onPlay", effects: [{ op: "gainResource", amount: 1 }] }],
    };
    const state = makeState({ hand: [card("a"), card("b")], resourcePool: 0 });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    expect(withPending.pendingChoice).not.toBeNull();

    const cfg = makeConfig([actionDef]);
    expect(() =>
      reduce(withPending, 0, { type: CMD.PLAY_CARD, instanceId: "act-1" }, cfg)
    ).toThrow("待处理的选择");
  });

  it("END_TURN 被拒绝", () => {
    const state = makeState({ hand: [card("a")] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    const cfg = makeConfig();
    expect(() =>
      reduce(withPending, 0, { type: CMD.END_TURN }, cfg)
    ).toThrow("待处理的选择");
  });

  it("SUBMIT_CHOICE 可以通过，解决后 pendingChoice 清空", () => {
    const h = card("a", "ia");
    const state = makeState({ hand: [h] });
    const withPending = applyStateEffects(
      state, 0,
      [{ op: "trashFromHandOrDiscard", count: 1, zone: "hand" }],
      Math.random, 32, seqId
    );
    const cfg = makeConfig();
    const resolved = reduce(withPending, 0, { type: CMD.SUBMIT_CHOICE, selectedInstanceIds: ["ia"] }, cfg);
    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.players[0].hand).toHaveLength(0);
  });
});

// ── 与卡牌数据集成验证 ──────────────────────────────────────────────────────────

describe("market-core 新卡数据验证", () => {
  const marketPath = require("path").resolve(__dirname, "../../../../data/cards/market-core.json");
  const cards: Array<{ id: string; abilities?: Array<{ trigger: string; effects: Array<{ op: string; [k: string]: unknown }> }> }>
    = require("fs").readFileSync(marketPath, "utf-8") && JSON.parse(require("fs").readFileSync(marketPath, "utf-8"));

  it("green_used_book_recycle 包含 trashFromHandOrDiscard + gainResource", () => {
    const c = cards.find((x) => x.id === "green_used_book_recycle");
    expect(c).toBeDefined();
    const play = c!.abilities?.find((a) => a.trigger === "onPlay");
    expect(play?.effects.find((e) => e.op === "trashFromHandOrDiscard")).toMatchObject({
      op: "trashFromHandOrDiscard", count: 1, zone: "either",
    });
    expect(play?.effects.find((e) => e.op === "gainResource")).toMatchObject({ op: "gainResource", amount: 2 });
  });

  it("blue_draft_simulation 包含 interactive scry(3) + gainResource", () => {
    const c = cards.find((x) => x.id === "blue_draft_simulation");
    expect(c).toBeDefined();
    const play = c!.abilities?.find((a) => a.trigger === "onPlay");
    expect(play?.effects.find((e) => e.op === "scry")).toMatchObject({
      op: "scry", count: 3, interactive: true,
    });
    expect(play?.effects.find((e) => e.op === "gainResource")).toMatchObject({ op: "gainResource", amount: 1 });
  });
});
