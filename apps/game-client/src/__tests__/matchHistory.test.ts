/**
 * matchHistory.test.ts — 「我的战绩」纯格式化逻辑（P3-2）。
 *
 * DOM 接线由手动 / e2e 验证；这里覆盖与服务端响应解耦的展示口径：
 * 结果徽章、时长、统计 chips、回放帧摘要。
 */
import { describe, it, expect } from "vitest";
import type { PublicMatchView } from "@dev-camcard/protocol";
import {
  formatResult,
  formatDuration,
  buildStatsChips,
  formatStartedAt,
  summarizeFrame,
  type UserMatchStats,
} from "../lobby/matchHistory";

describe("formatResult", () => {
  it("四种结果映射到正确文案与样式", () => {
    expect(formatResult("win")).toEqual({ label: "胜", cls: "result-win" });
    expect(formatResult("loss")).toEqual({ label: "负", cls: "result-loss" });
    expect(formatResult("draw")).toEqual({ label: "平", cls: "result-draw" });
    expect(formatResult("ongoing")).toEqual({ label: "进行中", cls: "result-ongoing" });
  });
});

describe("formatDuration", () => {
  it("分秒组合与边界", () => {
    expect(formatDuration(90000)).toBe("1分30秒");
    expect(formatDuration(45000)).toBe("45秒");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("buildStatsChips", () => {
  const base: UserMatchStats = {
    total: 5,
    finished: 4,
    wins: 3,
    losses: 1,
    draws: 0,
    ongoing: 1,
    winRate: 0.75,
    avgDurationMs: 60000,
  };

  it("完整聚合输出全部 chips", () => {
    expect(buildStatsChips(base)).toEqual([
      "5 场",
      "3 胜 1 负",
      "胜率 75%",
      "场均 1分0秒",
      "1 场进行中",
    ]);
  });

  it("无已结束对局时省略胜率与场均", () => {
    const chips = buildStatsChips({
      ...base,
      total: 1,
      finished: 0,
      wins: 0,
      losses: 0,
      ongoing: 1,
      winRate: null,
      avgDurationMs: null,
    });
    expect(chips).toEqual(["1 场", "0 胜 0 负", "1 场进行中"]);
  });

  it("有平局时附带平局计数", () => {
    const chips = buildStatsChips({ ...base, draws: 2, ongoing: 0 });
    expect(chips[1]).toBe("3 胜 1 负 2 平");
  });
});

describe("formatStartedAt", () => {
  it("非法时间原样返回，不抛错", () => {
    expect(formatStartedAt("not-a-date")).toBe("not-a-date");
  });
});

// ── summarizeFrame ───────────────────────────────────────────────────────────

function makeView(overrides: Partial<PublicMatchView> = {}): PublicMatchView {
  const player = (side: 0 | 1) => ({
    side,
    name: side === 0 ? "天天" : "对手",
    hp: 30,
    block: 0,
    deckSize: 10,
    handSize: 5,
    discardSize: 0,
    resourcePool: 2,
    attackPool: 1,
    venues: [],
    scheduleSlots: [null, null],
    reservedCard: null,
    hasReservedThisTurn: false,
    pendingDiscardCount: 0,
  });
  return {
    roomId: "room-1",
    turnNumber: 3,
    activePlayer: 0,
    players: [player(0), player(1)],
    market: [],
    fixedSupplies: [],
    started: true,
    ended: false,
    winner: null,
    pendingChoiceSide: null,
    ...overrides,
  } as PublicMatchView;
}

describe("summarizeFrame", () => {
  it("起点帧无事件元数据", () => {
    const s = summarizeFrame(makeView(), null);
    expect(s.title).toBe("起点（开局盘面）");
    expect(s.playerLines).toHaveLength(2);
    expect(s.playerLines[0]).toContain("P1 天天");
    expect(s.playerLines[0]).toContain("HP 30");
    expect(s.statusLine).toBe("回合 3 · 轮到 P1");
  });

  it("事件帧带席位前缀，场馆显示耐久", () => {
    const view = makeView();
    view.players[1].venues = [
      {
        instanceId: "v1",
        cardId: "venue-a",
        owner: 1,
        isGuard: true,
        durability: 2,
        maxDurability: 4,
        activationsLeft: 1,
      },
    ];
    const s = summarizeFrame(view, { type: "PLAY_CARD", side: 1 });
    expect(s.title).toBe("[P2] PLAY_CARD");
    expect(s.playerLines[1]).toContain("场馆×1(2/4)");
  });

  it("结束帧显示胜者", () => {
    const s = summarizeFrame(makeView({ ended: true, winner: 1 }), {
      type: "MATCH_END",
      side: null,
    });
    expect(s.statusLine).toBe("回合 3 · 对局结束（P2 获胜）");
  });
});
