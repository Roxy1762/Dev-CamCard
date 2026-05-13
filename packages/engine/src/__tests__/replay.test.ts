import { describe, it, expect } from "vitest";
import { CMD } from "@dev-camcard/protocol";
import type { MatchEvent } from "@dev-camcard/protocol";
import { reduce, type EngineConfig } from "../reduce";
import {
  buildReplayInitialState,
  reconstructCommand,
  replayFromEvents,
  SYSTEM_EVENT_TYPES,
} from "../replay";
import type { RulesetConfig } from "../init";
import type { CardDef } from "../effects";

// ── 测试用规则集与卡牌定义 ────────────────────────────────────────────────────

const RULESET: RulesetConfig = {
  id: "replay-test",
  hp: 32,
  handSize: 5,
  firstPlayerOpeningHand: 4,
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

const CARD_DEFS: Record<string, CardDef> = {
  starter_a: { id: "starter_a", type: "action", abilities: [] },
  starter_b: { id: "starter_b", type: "action", abilities: [] },
  market_x: { id: "market_x", type: "action", abilities: [] },
  market_y: { id: "market_y", type: "action", abilities: [] },
  market_z: { id: "market_z", type: "action", abilities: [] },
};

const CONFIG: EngineConfig = {
  ruleset: RULESET,
  getCardCost: () => 0,
  getCardDef: (id) => CARD_DEFS[id],
};

const LANE_DEFS = [
  { lane: "course" as const, cardIds: ["market_x", "market_x", "market_x"] },
  { lane: "activity" as const, cardIds: ["market_y", "market_y", "market_y"] },
  { lane: "daily" as const, cardIds: ["market_z", "market_z", "market_z"] },
];

function makeInitial() {
  return buildReplayInitialState({
    roomId: "room-rep",
    ruleset: RULESET,
    playerNames: ["P0", "P1"],
    initialSeed: 1234,
    laneDefinitions: LANE_DEFS.map((l) => ({ lane: l.lane, cardIds: [...l.cardIds] })),
  });
}

// ── buildReplayInitialState ─────────────────────────────────────────────────

describe("buildReplayInitialState", () => {
  it("同 setup 重复调用产出逐字节相同的初始状态", () => {
    const a = makeInitial();
    const b = makeInitial();
    expect(a).toEqual(b);
  });

  it("不同 seed 产出不同的牌堆 / 市场布局", () => {
    const a = buildReplayInitialState({
      roomId: "room-rep",
      ruleset: RULESET,
      playerNames: ["P0", "P1"],
      initialSeed: 1,
      laneDefinitions: LANE_DEFS.map((l) => ({ lane: l.lane, cardIds: [...l.cardIds] })),
    });
    const b = buildReplayInitialState({
      roomId: "room-rep",
      ruleset: RULESET,
      playerNames: ["P0", "P1"],
      initialSeed: 2,
      laneDefinitions: LANE_DEFS.map((l) => ({ lane: l.lane, cardIds: [...l.cardIds] })),
    });
    // 由于初始 createMatchState 阶段 deck 顺序仅依赖 starterDeck 配置，与 seed 无关；
    // 但 market shuffle 直接消费 rng，所以应当不同。
    const aMarketIds = a.market.flatMap((lane) =>
      [...lane.slots, ...lane.deck].map((s) => s?.instanceId ?? "")
    );
    const bMarketIds = b.market.flatMap((lane) =>
      [...lane.slots, ...lane.deck].map((s) => s?.instanceId ?? "")
    );
    expect(aMarketIds).not.toEqual(bMarketIds);
  });

  it("写入 initialSeed / rngState / idCounter", () => {
    const s = makeInitial();
    expect(s.initialSeed).toBe(1234);
    expect(s.rngState).toBeTypeOf("number");
    expect(s.idCounter).toBeTypeOf("number");
  });
});

// ── reconstructCommand ──────────────────────────────────────────────────────

describe("reconstructCommand", () => {
  it("对系统事件返回 null", () => {
    expect(
      reconstructCommand({ seq: 0, ts: 0, type: "MATCH_START" })
    ).toBeNull();
    expect(
      reconstructCommand({ seq: 1, ts: 0, type: "MATCH_END" })
    ).toBeNull();
  });

  it("还原无 payload 的命令", () => {
    expect(reconstructCommand({ seq: 0, ts: 0, type: CMD.READY })).toEqual({
      type: CMD.READY,
    });
    expect(reconstructCommand({ seq: 1, ts: 0, type: CMD.END_TURN })).toEqual({
      type: CMD.END_TURN,
    });
    expect(reconstructCommand({ seq: 2, ts: 0, type: CMD.CONCEDE })).toEqual({
      type: CMD.CONCEDE,
    });
    expect(
      reconstructCommand({ seq: 3, ts: 0, type: CMD.BUY_RESERVED_CARD })
    ).toEqual({ type: CMD.BUY_RESERVED_CARD });
  });

  it("还原 instanceId 类命令", () => {
    expect(
      reconstructCommand({
        seq: 0,
        ts: 0,
        type: CMD.PLAY_CARD,
        data: { instanceId: "inst-1" },
      })
    ).toEqual({ type: CMD.PLAY_CARD, instanceId: "inst-1" });

    expect(
      reconstructCommand({
        seq: 1,
        ts: 0,
        type: CMD.PUT_CARD_TO_SCHEDULE,
        data: { instanceId: "inst-2", slotIndex: 1 },
      })
    ).toEqual({ type: CMD.PUT_CARD_TO_SCHEDULE, instanceId: "inst-2", slotIndex: 1 });

    expect(
      reconstructCommand({
        seq: 2,
        ts: 0,
        type: CMD.BUY_FIXED_SUPPLY,
        data: { cardId: "supply_x" },
      })
    ).toEqual({ type: CMD.BUY_FIXED_SUPPLY, cardId: "supply_x" });
  });

  it("还原 ASSIGN_ATTACK 与 SUBMIT_CHOICE", () => {
    expect(
      reconstructCommand({
        seq: 0,
        ts: 0,
        type: CMD.ASSIGN_ATTACK,
        data: {
          assignments: [
            { amount: 3, target: "player", targetSide: 1 },
          ],
        },
      })
    ).toEqual({
      type: CMD.ASSIGN_ATTACK,
      assignments: [{ amount: 3, target: "player", targetSide: 1 }],
    });

    expect(
      reconstructCommand({
        seq: 1,
        ts: 0,
        type: CMD.SUBMIT_CHOICE,
        data: { selectedInstanceIds: ["a", "b"] },
      })
    ).toEqual({ type: CMD.SUBMIT_CHOICE, selectedInstanceIds: ["a", "b"] });
  });

  it("缺失字段时安全降级（不抛错）", () => {
    expect(
      reconstructCommand({ seq: 0, ts: 0, type: CMD.PLAY_CARD })
    ).toEqual({ type: CMD.PLAY_CARD, instanceId: "" });
    expect(
      reconstructCommand({ seq: 1, ts: 0, type: CMD.SUBMIT_CHOICE })
    ).toEqual({ type: CMD.SUBMIT_CHOICE, selectedInstanceIds: [] });
  });

  it("未知 type 返回 null", () => {
    expect(
      reconstructCommand({ seq: 0, ts: 0, type: "TOTALLY_BOGUS_TYPE" })
    ).toBeNull();
  });
});

// ── replayFromEvents ────────────────────────────────────────────────────────

describe("replayFromEvents", () => {
  it("空事件流：steps 为空，finalState 等于初始状态", () => {
    const init = makeInitial();
    const result = replayFromEvents(init, [], CONFIG);
    expect(result.steps).toEqual([]);
    expect(result.finalState).toEqual(init);
    expect(result.errors).toEqual([]);
  });

  it("系统事件作为占位帧通过，state 复用上一帧", () => {
    const init = makeInitial();
    const events: MatchEvent[] = [
      { seq: 0, ts: 1, type: "MATCH_START" },
      { seq: 1, ts: 2, type: "MATCH_END", data: { winner: 0 } },
    ];
    const result = replayFromEvents(init, events, CONFIG);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.state).toBe(init);
    expect(result.steps[1]!.state).toBe(init);
    expect(result.finalState).toBe(init);
    expect(result.errors).toEqual([]);
  });

  it("等价于直接 reduce：READY x2 + END_TURN x2 后产物一致", () => {
    const init = makeInitial();

    // 直接 reduce 的"金标准"
    let gold = init;
    gold = reduce(gold, 0, { type: CMD.READY }, CONFIG);
    gold = reduce(gold, 1, { type: CMD.READY }, CONFIG);
    gold = reduce(gold, 0, { type: CMD.END_TURN }, CONFIG);
    gold = reduce(gold, 1, { type: CMD.END_TURN }, CONFIG);

    // 通过事件回放
    const events: MatchEvent[] = [
      { seq: 0, ts: 1, type: "MATCH_START" },
      { seq: 1, ts: 2, type: CMD.READY, side: 0 },
      { seq: 2, ts: 3, type: CMD.READY, side: 1 },
      { seq: 3, ts: 4, type: CMD.END_TURN, side: 0 },
      { seq: 4, ts: 5, type: CMD.END_TURN, side: 1 },
    ];
    const result = replayFromEvents(init, events, CONFIG);

    expect(result.errors).toEqual([]);
    // 关键不变量：手牌内容、回合数、活跃方、rngState、idCounter
    expect(result.finalState.players[0].hand.map((c) => c.instanceId)).toEqual(
      gold.players[0].hand.map((c) => c.instanceId)
    );
    expect(result.finalState.players[1].hand.map((c) => c.instanceId)).toEqual(
      gold.players[1].hand.map((c) => c.instanceId)
    );
    expect(result.finalState.turnNumber).toBe(gold.turnNumber);
    expect(result.finalState.activePlayer).toBe(gold.activePlayer);
    expect(result.finalState.rngState).toBe(gold.rngState);
    expect(result.finalState.idCounter).toBe(gold.idCounter);
  });

  it("单条事件出错不会中断流程：错误被捕获，state 回退到上一帧", () => {
    const init = makeInitial();
    const events: MatchEvent[] = [
      { seq: 0, ts: 1, type: CMD.READY, side: 0 },
      { seq: 1, ts: 2, type: CMD.READY, side: 1 },
      // 非活动方发非法命令：side=1 但当前 activePlayer=0
      {
        seq: 2,
        ts: 3,
        type: CMD.PLAY_CARD,
        side: 1,
        data: { instanceId: "non-existent" },
      },
      // 后续合法事件继续生效
      { seq: 3, ts: 4, type: CMD.END_TURN, side: 0 },
    ];
    const result = replayFromEvents(init, events, CONFIG);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.seq).toBe(2);

    // 第 2 步（出错）state 应当 === 第 1 步 state
    expect(result.steps[2]!.state).toBe(result.steps[1]!.state);
    expect(result.steps[2]!.error).toBeTruthy();

    // END_TURN 在 side=0 上仍然合法 —— 流程未被中断
    expect(result.finalState.activePlayer).toBe(1);
  });

  it("缺失 side 的命令事件被记错而非崩溃", () => {
    const init = makeInitial();
    const events: MatchEvent[] = [
      // 没有 side
      { seq: 0, ts: 1, type: CMD.READY },
    ];
    const result = replayFromEvents(init, events, CONFIG);
    expect(result.errors).toHaveLength(1);
    expect(result.steps[0]!.error).toMatch(/缺少 side/);
    expect(result.finalState).toBe(init);
  });

  it("未知 type 被记错为'未知事件类型'", () => {
    const init = makeInitial();
    const events: MatchEvent[] = [
      { seq: 0, ts: 1, type: "WHAT_IS_THIS", side: 0 },
    ];
    const result = replayFromEvents(init, events, CONFIG);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/未知事件类型/);
  });
});

// ── 防回归 ──────────────────────────────────────────────────────────────────

describe("SYSTEM_EVENT_TYPES", () => {
  it("包含 MATCH_START 与 MATCH_END，且不包含 CMD.*", () => {
    expect(SYSTEM_EVENT_TYPES.has("MATCH_START")).toBe(true);
    expect(SYSTEM_EVENT_TYPES.has("MATCH_END")).toBe(true);
    expect(SYSTEM_EVENT_TYPES.has(CMD.READY)).toBe(false);
    expect(SYSTEM_EVENT_TYPES.has(CMD.PLAY_CARD)).toBe(false);
  });
});
