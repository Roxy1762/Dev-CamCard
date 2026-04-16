import { describe, it, expect } from "vitest";
import type { MatchEvent, MatchEventLog, MatchSnapshot } from "@dev-camcard/protocol";

/**
 * 事件日志结构 + 协议正确性的聚焦测试。
 *
 * 不测试 Colyseus / Phaser（无法在 Vitest 中运行），
 * 只测试：
 *  1. MatchEvent 结构合规
 *  2. 事件序号稳定有序
 *  3. 对局结束后事件仍可读取（内存快照不可变）
 *  4. MatchSnapshot 信息可取得
 */

// ── 模拟 GameRoom 内部的事件记录逻辑（纯函数提取版本） ──────────────────────

function makeEventRecorder() {
  const events: MatchEvent[] = [];
  let seq = 0;

  const push = (type: string, side?: 0 | 1, data?: Record<string, unknown>) => {
    events.push({ seq: seq++, ts: Date.now(), type, side, data });
  };

  return { events, push };
}

const SNAPSHOT: MatchSnapshot = {
  matchId: "room-test-001",
  rulesetVersion: "core-v1",
  contentSets: ["starter", "fixed-supplies", "market-core", "status"],
  startedAt: 1_700_000_000_000,
};

describe("MatchEvent 结构", () => {
  it("seq 从 0 开始，单调递增", () => {
    const { events, push } = makeEventRecorder();
    push("MATCH_START");
    push("READY", 0);
    push("READY", 1);
    push("PLAY_CARD", 0, { instanceId: "card-1" });
    push("END_TURN", 0);

    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it("ts 字段为正整数（毫秒时间戳）", () => {
    const { events, push } = makeEventRecorder();
    push("MATCH_START");
    expect(events[0].ts).toBeGreaterThan(0);
    expect(Number.isInteger(events[0].ts)).toBe(true);
  });

  it("side 字段：系统事件无 side，玩家操作有 side", () => {
    const { events, push } = makeEventRecorder();
    push("MATCH_START");               // 系统事件，无 side
    push("PLAY_CARD", 0, { instanceId: "c1" });  // 玩家 0

    expect(events[0].side).toBeUndefined();
    expect(events[1].side).toBe(0);
  });

  it("data 字段包含精简 payload", () => {
    const { events, push } = makeEventRecorder();
    push("BUY_MARKET_CARD", 1, { instanceId: "card-42" });

    expect(events[0].data).toEqual({ instanceId: "card-42" });
  });
});

describe("事件顺序稳定性", () => {
  it("多轮事件后顺序与追加顺序一致", () => {
    const { events, push } = makeEventRecorder();
    const types = ["MATCH_START", "READY", "READY", "PLAY_CARD", "END_TURN", "MATCH_END"];
    types.forEach((t) => push(t));

    expect(events.map((e) => e.type)).toEqual(types);
    expect(events.every((e, i) => e.seq === i)).toBe(true);
  });
});

describe("对局结束后事件可读取", () => {
  it("push MATCH_END 后数组仍完整", () => {
    const { events, push } = makeEventRecorder();
    push("MATCH_START");
    push("READY", 0);
    push("READY", 1);
    push("CONCEDE", 1, {});
    push("MATCH_END", undefined, { winner: 0 });

    // 对局结束后，仍可读取全部事件
    const frozen = [...events]; // 模拟不可变快照
    expect(frozen.length).toBe(5);
    expect(frozen[frozen.length - 1].type).toBe("MATCH_END");
    expect(frozen[frozen.length - 1].data?.winner).toBe(0);
  });
});

describe("MatchSnapshot 信息", () => {
  it("snapshot 包含 matchId / rulesetVersion / contentSets / startedAt", () => {
    expect(SNAPSHOT.matchId).toBe("room-test-001");
    expect(SNAPSHOT.rulesetVersion).toBe("core-v1");
    expect(SNAPSHOT.contentSets).toContain("starter");
    expect(SNAPSHOT.contentSets).toContain("market-core");
    expect(SNAPSHOT.startedAt).toBeGreaterThan(0);
  });

  it("MatchEventLog 可组合 snapshot + events", () => {
    const { events, push } = makeEventRecorder();
    push("MATCH_START");

    const log: MatchEventLog = { snapshot: SNAPSHOT, events };
    expect(log.snapshot.rulesetVersion).toBe("core-v1");
    expect(log.events.length).toBe(1);
  });
});
