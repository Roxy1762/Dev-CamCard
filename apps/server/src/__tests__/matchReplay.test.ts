/**
 * matchReplay.test.ts — 逐帧回放重建（buildReplayFrames）测试。
 *
 * 用最小自带 ruleset / laneDefinitions / engineConfig（不依赖 content.ts 的真实数据），
 * 保证测试快速、隔离。
 *
 * 覆盖：
 *  1. 空事件流 → 0 帧，但有起点视图 initialView（started=false）
 *  2. READY×2 → 对局开始（最后一帧 started=true），逐帧 PublicMatchView
 *  3. bigint / string 形态的 ts 兼容
 *  4. 缺少 side 的命令事件被记录到 errors，但不中断流程
 *  5. 同一 matchId → initialSeed 稳定可复现
 */
import { describe, it, expect } from "vitest";
import type { RulesetConfig, EngineConfig } from "@dev-camcard/engine";
import { hashStringToSeed } from "@dev-camcard/engine";
import type { Lane } from "@dev-camcard/protocol";
import { buildReplayFrames, type ReplayEventLike, type ReplayContent } from "../matchReplay";

const RULESET: RulesetConfig = {
  id: "test-core",
  hp: 30,
  handSize: 5,
  firstPlayerOpeningHand: 5,
  secondPlayerOpeningHand: 5,
  scheduleSlots: 2,
  reserveSlots: 1,
  marketLanesCount: 3,
  marketSlotsPerLane: 2,
  starterDeck: [{ cardId: "starter_allowance", count: 10 }],
  fixedSupplies: ["supply_milk_bread"],
};

const LANE_DEFS: Array<{ lane: Lane; cardIds: string[] }> = [
  { lane: "course", cardIds: ["c_a", "c_b", "c_c"] },
  { lane: "activity", cardIds: ["a_a", "a_b", "a_c"] },
  { lane: "daily", cardIds: ["d_a", "d_b", "d_c"] },
];

const ENGINE_CONFIG: EngineConfig = {
  ruleset: RULESET,
  getCardCost: () => 2,
  getCardDef: () => undefined,
};

const CONTENT: ReplayContent = {
  ruleset: RULESET,
  laneDefinitions: LANE_DEFS,
  engineConfig: ENGINE_CONFIG,
};

const NAMES: [string, string] = ["甲", "乙"];

describe("buildReplayFrames", () => {
  it("空事件流：0 帧，但有起点视图（started=false）", () => {
    const result = buildReplayFrames("room-empty", [], NAMES, CONTENT);
    expect(result.frameCount).toBe(0);
    expect(result.frames).toHaveLength(0);
    expect(result.initialView.started).toBe(false);
    expect(result.initialView.players[0].name).toBe("甲");
    expect(result.initialView.players[1].name).toBe("乙");
    // 市场三栏各 2 个公开槽
    expect(result.initialView.market).toHaveLength(3);
    expect(result.initialView.market[0].slots).toHaveLength(2);
  });

  it("READY×2：最后一帧 started=true，逐帧给出 PublicMatchView", () => {
    const events: ReplayEventLike[] = [
      { seq: 0, type: "MATCH_START", ts: 1000, side: null },
      { seq: 1, type: "READY", ts: 1001, side: 0 },
      { seq: 2, type: "READY", ts: 1002, side: 1 },
    ];
    const result = buildReplayFrames("room-ready", events, NAMES, CONTENT);
    expect(result.frameCount).toBe(3);
    // 系统事件 MATCH_START 占位帧：still not started
    expect(result.frames[0].type).toBe("MATCH_START");
    expect(result.frames[0].view.started).toBe(false);
    // 双方 READY 后对局开始
    expect(result.frames[2].view.started).toBe(true);
    // 起点手牌为空，开始后双方都摸到开局手牌
    expect(result.initialView.players[0].handSize).toBe(0);
    expect(result.frames[2].view.players[0].handSize).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it("兼容 bigint / string 形态的 ts", () => {
    const events: ReplayEventLike[] = [
      { seq: 0, type: "MATCH_START", ts: 1000n, side: null },
      { seq: 1, type: "READY", ts: "1001", side: 0 },
      { seq: 2, type: "READY", ts: 1002, side: 1 },
    ];
    const result = buildReplayFrames("room-ts", events, NAMES, CONTENT);
    expect(result.frames[0].ts).toBe(1000);
    expect(result.frames[1].ts).toBe(1001);
    expect(result.frames[2].view.started).toBe(true);
  });

  it("命令事件缺少 side：记录到 errors 但不中断", () => {
    const events: ReplayEventLike[] = [
      { seq: 0, type: "READY", ts: 1, side: null }, // 非法：缺 side
      { seq: 1, type: "READY", ts: 2, side: 0 },
      { seq: 2, type: "READY", ts: 3, side: 1 },
    ];
    const result = buildReplayFrames("room-bad", events, NAMES, CONTENT);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].seq).toBe(0);
    expect(result.frames[0].error).toBeDefined();
    // 后续合法 READY 仍推进，最终开始
    expect(result.frames[2].view.started).toBe(true);
  });

  it("乱序输入按 seq 排序后重建", () => {
    const events: ReplayEventLike[] = [
      { seq: 2, type: "READY", ts: 3, side: 1 },
      { seq: 0, type: "MATCH_START", ts: 1, side: null },
      { seq: 1, type: "READY", ts: 2, side: 0 },
    ];
    const result = buildReplayFrames("room-order", events, NAMES, CONTENT);
    expect(result.frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(result.frames[2].view.started).toBe(true);
  });

  it("同 matchId → initialSeed 稳定可复现", () => {
    const a = buildReplayFrames("same-room", [], NAMES, CONTENT);
    const b = buildReplayFrames("same-room", [], NAMES, CONTENT);
    expect(a.initialSeed).toBe(hashStringToSeed("same-room"));
    expect(a.initialSeed).toBe(b.initialSeed);
    // 同 seed → 起点市场布局逐字节一致
    expect(JSON.stringify(a.initialView.market)).toBe(
      JSON.stringify(b.initialView.market)
    );
  });
});
