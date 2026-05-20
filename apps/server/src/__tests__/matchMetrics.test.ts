/**
 * matchMetrics.test.ts
 *
 * 验证 computeMatchMetrics 的核心口径：
 *   - END_TURN → turns，且不受 side 影响
 *   - 命令分桶按 side 正确归集
 *   - ASSIGN_ATTACK 的 assignments[].amount/target 正确聚合
 *   - 时长 = MATCH_END 优先 / 否则末事件兜底；turns >= 1 才有 avgTurnMs
 *
 * 纯函数测试，无 DB / 无 HTTP / 无引擎依赖。
 */
import { describe, it, expect } from "vitest";
import {
  computeMatchMetrics,
  type MetricsEventLike,
  type MetricsMatchLike,
} from "../matchMetrics";

function mkMatch(over: Partial<MetricsMatchLike> = {}): MetricsMatchLike {
  return {
    id: "match-test",
    rulesetVersion: "core-v1",
    contentSets: ["starter", "market-core"],
    startedAt: new Date("2025-01-01T00:00:00Z"),
    endedAt: new Date("2025-01-01T00:10:00Z"),
    winner: 0,
    players: [
      { side: 0, name: "Alice" },
      { side: 1, name: "Bob" },
    ],
    ...over,
  };
}

describe("computeMatchMetrics", () => {
  it("returns zero buckets and null duration on empty event stream", () => {
    const m = computeMatchMetrics([], mkMatch({ endedAt: null }));
    expect(m.turns).toBe(0);
    expect(m.totalEvents).toBe(0);
    expect(m.durationMs).toBeNull();
    expect(m.avgTurnMs).toBeNull();
    expect(m.perSide).toHaveLength(2);
    expect(m.perSide[0]!.totalBuys).toBe(0);
    expect(m.perSide[0]!.name).toBe("Alice");
    expect(m.perSide[1]!.name).toBe("Bob");
  });

  it("counts END_TURN as turns and ignores side on the count", () => {
    const events: MetricsEventLike[] = [
      { type: "MATCH_START", ts: 1_000 },
      { type: "END_TURN", side: 0, ts: 2_000 },
      { type: "END_TURN", side: 1, ts: 3_000 },
      { type: "END_TURN", side: 0, ts: 4_000 },
    ];
    const m = computeMatchMetrics(events, mkMatch({ endedAt: null }));
    expect(m.turns).toBe(3);
  });

  it("buckets per-command counts by side", () => {
    const events: MetricsEventLike[] = [
      { type: "MATCH_START", ts: 1_000 },
      { type: "PLAY_CARD", side: 0, ts: 1_100 },
      { type: "PLAY_CARD", side: 0, ts: 1_200 },
      { type: "PLAY_CARD", side: 1, ts: 1_300 },
      { type: "PUT_CARD_TO_SCHEDULE", side: 1, ts: 1_400 },
      { type: "BUY_MARKET_CARD", side: 0, ts: 1_500 },
      { type: "BUY_RESERVED_CARD", side: 0, ts: 1_600 },
      { type: "BUY_FIXED_SUPPLY", side: 1, ts: 1_700 },
      { type: "ACTIVATE_VENUE", side: 1, ts: 1_800 },
      { type: "END_TURN", side: 0, ts: 1_900 },
      { type: "MATCH_END", ts: 2_000 },
    ];
    const m = computeMatchMetrics(events, mkMatch());
    expect(m.perSide[0]!.cardsPlayed).toBe(2);
    expect(m.perSide[1]!.cardsPlayed).toBe(1);
    expect(m.perSide[1]!.cardsScheduled).toBe(1);
    expect(m.perSide[0]!.marketBuys).toBe(1);
    expect(m.perSide[0]!.reservedBuys).toBe(1);
    expect(m.perSide[0]!.fixedBuys).toBe(0);
    expect(m.perSide[1]!.fixedBuys).toBe(1);
    expect(m.perSide[0]!.totalBuys).toBe(2);
    expect(m.perSide[1]!.totalBuys).toBe(1);
    expect(m.perSide[1]!.venuesActivated).toBe(1);
  });

  it("aggregates ASSIGN_ATTACK assignments by amount and target", () => {
    const events: MetricsEventLike[] = [
      {
        type: "ASSIGN_ATTACK",
        side: 0,
        ts: 1_000,
        data: {
          assignments: [
            { amount: 3, target: "player", targetSide: 1 },
            { amount: 2, target: "venue", targetSide: 1, venueInstanceId: "v1" },
          ],
        },
      },
      {
        type: "ASSIGN_ATTACK",
        side: 0,
        ts: 1_100,
        data: { assignments: [{ amount: 1, target: "venue", targetSide: 1 }] },
      },
      {
        type: "ASSIGN_ATTACK",
        side: 1,
        ts: 1_200,
        data: { assignments: [{ amount: 4, target: "player", targetSide: 0 }] },
      },
    ];
    const m = computeMatchMetrics(events, mkMatch({ endedAt: null }));
    expect(m.perSide[0]!.attackCommands).toBe(2);
    expect(m.perSide[0]!.totalAttackAmount).toBe(6);
    expect(m.perSide[0]!.attacksOnPlayer).toBe(1);
    expect(m.perSide[0]!.attacksOnVenue).toBe(2);
    expect(m.perSide[1]!.attackCommands).toBe(1);
    expect(m.perSide[1]!.totalAttackAmount).toBe(4);
  });

  it("computes durationMs from MATCH_END when present, falls back to last ts otherwise", () => {
    const withEnd: MetricsEventLike[] = [
      { type: "MATCH_START", ts: 1_000 },
      { type: "END_TURN", side: 0, ts: 5_000 },
      { type: "MATCH_END", ts: 7_000 },
      { type: "END_TURN", side: 1, ts: 9_000 }, // 异常：MATCH_END 后还有事件，不应影响 duration
    ];
    const m1 = computeMatchMetrics(withEnd, mkMatch());
    expect(m1.durationMs).toBe(6_000); // 7000 - 1000
    expect(m1.turns).toBe(2);
    expect(m1.avgTurnMs).toBe(3_000); // 6000 / 2

    const withoutEnd: MetricsEventLike[] = [
      { type: "MATCH_START", ts: 1_000 },
      { type: "END_TURN", side: 0, ts: 5_000 },
    ];
    const m2 = computeMatchMetrics(withoutEnd, mkMatch({ endedAt: null }));
    expect(m2.durationMs).toBe(4_000); // 兜底用末事件 ts
    expect(m2.turns).toBe(1);
    expect(m2.avgTurnMs).toBe(4_000);
  });

  it("accepts bigint ts and converts safely", () => {
    const events: MetricsEventLike[] = [
      { type: "MATCH_START", ts: 1_000n },
      { type: "END_TURN", side: 0, ts: 2_500n },
      { type: "MATCH_END", ts: 3_000n },
    ];
    const m = computeMatchMetrics(events, mkMatch());
    expect(m.durationMs).toBe(2_000);
    expect(m.turns).toBe(1);
  });

  it("falls back to P1/P2 names when no players are provided", () => {
    const m = computeMatchMetrics([], mkMatch({ players: undefined }));
    expect(m.perSide[0]!.name).toBe("P1");
    expect(m.perSide[1]!.name).toBe("P2");
  });
});
