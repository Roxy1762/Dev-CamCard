/**
 * viewmodel.test.ts — BoardViewModel 构建函数最小验证测试
 *
 * 覆盖：
 *  1. mySide / oppSide 正确推导
 *  2. isMyTurn 各分支
 *  3. hand / discard 来自 PrivatePlayerView
 *  4. pendingChoice 透传
 *  5. getCardName 无 catalog 降级返回 cardId
 *  6. getCardName 有 catalog 返回本地化名称
 *  7. me / opp 字段正确投影
 *  8. 对局未开始时 isMyTurn = false
 */
import { describe, it, expect } from "vitest";
import type { PublicMatchView, PrivatePlayerView } from "@dev-camcard/protocol";
import { buildBoardViewModel } from "../viewmodel/BoardViewModel";

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

function makePlayer(side: 0 | 1, overrides: Partial<{
  hp: number; block: number; resourcePool: number; attackPool: number;
  deckSize: number; handSize: number; discardSize: number; name: string;
}> = {}) {
  return {
    side,
    name: overrides.name ?? `玩家${side + 1}`,
    hp: overrides.hp ?? 30,
    block: overrides.block ?? 0,
    deckSize: overrides.deckSize ?? 10,
    handSize: overrides.handSize ?? 5,
    discardSize: overrides.discardSize ?? 0,
    resourcePool: overrides.resourcePool ?? 0,
    attackPool: overrides.attackPool ?? 0,
    venues: [],
    scheduleSlots: [null, null],
    reservedCard: null,
    hasReservedThisTurn: false,
    pendingDiscardCount: 0,
  };
}

function makePub(activePlayer: 0 | 1, opts: {
  started?: boolean; ended?: boolean; winner?: 0 | 1 | null;
} = {}): PublicMatchView {
  return {
    roomId: "room-test",
    turnNumber: 1,
    activePlayer,
    players: [makePlayer(0), makePlayer(1)],
    market: [],
    fixedSupplies: ["supply_milk_bread"],
    started: opts.started ?? true,
    ended: opts.ended ?? false,
    winner: opts.winner ?? null,
    pendingChoiceSide: null,
  };
}

function makePriv(side: 0 | 1, opts: {
  hand?: { id: string; instanceId: string }[];
  discard?: { id: string; instanceId: string }[];
  pendingChoice?: PrivatePlayerView["pendingChoice"];
} = {}): PrivatePlayerView {
  return {
    side,
    hand: opts.hand ?? [],
    discard: opts.discard ?? [],
    pendingChoice: opts.pendingChoice ?? null,
  };
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe("buildBoardViewModel", () => {
  it("mySide / oppSide — side=0 时对方为 1", () => {
    const vm = buildBoardViewModel(makePub(0), makePriv(0));
    expect(vm.mySide).toBe(0);
    expect(vm.oppSide).toBe(1);
  });

  it("mySide / oppSide — side=1 时对方为 0", () => {
    const vm = buildBoardViewModel(makePub(0), makePriv(1));
    expect(vm.mySide).toBe(1);
    expect(vm.oppSide).toBe(0);
  });

  it("isMyTurn — started && activePlayer === mySide", () => {
    const vm = buildBoardViewModel(makePub(0), makePriv(0));
    expect(vm.isMyTurn).toBe(true);
  });

  it("isMyTurn — activePlayer 不是自己时为 false", () => {
    const vm = buildBoardViewModel(makePub(1), makePriv(0));
    expect(vm.isMyTurn).toBe(false);
  });

  it("isMyTurn — 未开始时为 false（即使 activePlayer === mySide）", () => {
    const vm = buildBoardViewModel(makePub(0, { started: false }), makePriv(0));
    expect(vm.isMyTurn).toBe(false);
  });

  it("isMyTurn — 已结束时为 false", () => {
    const vm = buildBoardViewModel(makePub(0, { ended: true }), makePriv(0));
    expect(vm.isMyTurn).toBe(false);
  });

  it("hand 来自 PrivatePlayerView", () => {
    const hand = [{ id: "starter_allowance", instanceId: "i1" }];
    const vm = buildBoardViewModel(makePub(0), makePriv(0, { hand }));
    expect(vm.hand).toEqual(hand);
  });

  it("discard 来自 PrivatePlayerView", () => {
    const discard = [{ id: "starter_quarrel", instanceId: "i2" }];
    const vm = buildBoardViewModel(makePub(0), makePriv(0, { discard }));
    expect(vm.discard).toEqual(discard);
  });

  it("pendingChoice 透传（非 null）", () => {
    const pc = { type: "chooseCardsFromHand" as const, minCount: 0, maxCount: 1 };
    const vm = buildBoardViewModel(makePub(0), makePriv(0, { pendingChoice: pc }));
    expect(vm.pendingChoice).toEqual(pc);
  });

  it("getCardName — 无 catalog 时降级返回 cardId", () => {
    const vm = buildBoardViewModel(makePub(0), makePriv(0));
    expect(vm.getCardName("blue_draft_simulation")).toBe("blue_draft_simulation");
  });

  it("getCardName — 有 catalog 时返回本地化名称", () => {
    const names = new Map([["blue_draft_simulation", "模拟草稿"]]);
    const vm = buildBoardViewModel(makePub(0), makePriv(0), names);
    expect(vm.getCardName("blue_draft_simulation")).toBe("模拟草稿");
  });

  it("getCardName — catalog 中找不到时降级返回 cardId", () => {
    const names = new Map([["other_card", "其他牌"]]);
    const vm = buildBoardViewModel(makePub(0), makePriv(0), names);
    expect(vm.getCardName("unknown_card")).toBe("unknown_card");
  });

  it("me / opp 字段正确投影 — me 对应 mySide", () => {
    const pub = makePub(0);
    pub.players[0] = { ...makePlayer(0), hp: 25, name: "测试者" };
    pub.players[1] = { ...makePlayer(1), hp: 18 };
    const vm = buildBoardViewModel(pub, makePriv(0));
    expect(vm.me.hp).toBe(25);
    expect(vm.me.name).toBe("测试者");
    expect(vm.opp.hp).toBe(18);
  });
});
