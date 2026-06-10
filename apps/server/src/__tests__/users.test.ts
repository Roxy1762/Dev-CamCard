/**
 * users.test.ts — 账号系统最小实现（P3-1 / P3-2）。
 *
 * 1. normalizeUserId：合法/非法输入口径（GameRoom 与路由共用）。
 * 2. buildUserMatchesSummary：胜/负/平/进行中分类、胜率与平均时长聚合（纯函数，无 DB）。
 * 3. GET /api/users/:id/matches：真实路由集成（仅在配置 DATABASE_URL 时运行）。
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { normalizeUserId, buildUserMatchesSummary } from "../users";
import { registerUserRoutes } from "../routes/users";
import { getPrisma, closePrisma } from "../prisma";

const HAS_DATABASE_URL = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

// ── normalizeUserId ──────────────────────────────────────────────────────────

describe("normalizeUserId", () => {
  it("接受 crypto.randomUUID 形态并 trim 两端空白", () => {
    const uuid = "6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
    expect(normalizeUserId(uuid)).toBe(uuid);
    expect(normalizeUserId(`  ${uuid}  `)).toBe(uuid);
  });

  it("拒绝非字符串 / 空串 / 过短 / 过长 / 特殊字符", () => {
    expect(normalizeUserId(undefined)).toBeNull();
    expect(normalizeUserId(42)).toBeNull();
    expect(normalizeUserId("")).toBeNull();
    expect(normalizeUserId("short")).toBeNull();
    expect(normalizeUserId("x".repeat(65))).toBeNull();
    expect(normalizeUserId("abcd-efgh-中文注入")).toBeNull();
    expect(normalizeUserId("abc'; DROP TABLE--")).toBeNull();
  });
});

// ── buildUserMatchesSummary（纯函数聚合）─────────────────────────────────────

const USER = {
  id: "11111111-aaaa-4bbb-8ccc-222222222222",
  displayName: "天天",
  createdAt: new Date("2026-06-01T00:00:00Z"),
  lastSeenAt: new Date("2026-06-09T00:00:00Z"),
};

function matchRow(opts: {
  id: string;
  mySide: number;
  winner: number | null;
  ended?: boolean;
  durationMs?: number;
  opponentName?: string | null;
}) {
  const startedAt = new Date("2026-06-09T10:00:00Z");
  const players = [
    { side: opts.mySide, name: "天天", userId: USER.id },
    ...(opts.opponentName === null
      ? []
      : [{ side: 1 - opts.mySide, name: opts.opponentName ?? "对手", userId: null }]),
  ];
  return {
    id: opts.id,
    startedAt,
    endedAt:
      opts.ended === false ? null : new Date(startedAt.getTime() + (opts.durationMs ?? 60000)),
    winner: opts.winner,
    players,
  };
}

describe("buildUserMatchesSummary", () => {
  it("按席位正确分类 胜/负/平/进行中", () => {
    const summary = buildUserMatchesSummary(USER, [
      matchRow({ id: "m-win", mySide: 0, winner: 0 }),
      matchRow({ id: "m-loss", mySide: 1, winner: 0 }),
      matchRow({ id: "m-draw", mySide: 0, winner: null }),
      matchRow({ id: "m-live", mySide: 1, winner: null, ended: false }),
    ]);

    const byId = Object.fromEntries(summary.matches.map((m) => [m.matchId, m.result]));
    expect(byId).toEqual({
      "m-win": "win",
      "m-loss": "loss",
      "m-draw": "draw",
      "m-live": "ongoing",
    });
    expect(summary.stats).toMatchObject({
      total: 4,
      finished: 3,
      wins: 1,
      losses: 1,
      draws: 1,
      ongoing: 1,
    });
  });

  it("胜率以已结束对局为分母，平均时长只算已结束对局", () => {
    const summary = buildUserMatchesSummary(USER, [
      matchRow({ id: "a", mySide: 0, winner: 0, durationMs: 30000 }),
      matchRow({ id: "b", mySide: 0, winner: 1, durationMs: 90000 }),
      matchRow({ id: "c", mySide: 0, winner: null, ended: false }),
    ]);
    expect(summary.stats.winRate).toBe(0.5);
    expect(summary.stats.avgDurationMs).toBe(60000);
  });

  it("无已结束对局时 winRate / avgDurationMs 为 null", () => {
    const summary = buildUserMatchesSummary(USER, [
      matchRow({ id: "live", mySide: 0, winner: null, ended: false }),
    ]);
    expect(summary.stats.winRate).toBeNull();
    expect(summary.stats.avgDurationMs).toBeNull();
  });

  it("对手缺席时使用兜底名，账号信息序列化为 ISO 字符串", () => {
    const summary = buildUserMatchesSummary(USER, [
      matchRow({ id: "solo", mySide: 0, winner: null, ended: false, opponentName: null }),
    ]);
    expect(summary.matches[0].opponentName).toBe("（虚位以待）");
    expect(summary.user.createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(summary.user.lastSeenAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("防御性跳过不含该账号的脏数据行", () => {
    const stray = {
      id: "stray",
      startedAt: new Date(),
      endedAt: null,
      winner: null,
      players: [{ side: 0, name: "别人", userId: "99999999-aaaa-4bbb-8ccc-000000000000" }],
    };
    const summary = buildUserMatchesSummary(USER, [stray]);
    expect(summary.matches).toHaveLength(0);
    expect(summary.stats.total).toBe(0);
  });
});

// ── 路由集成（需要真实 DB）───────────────────────────────────────────────────

const TEST_USER_ID = `e2e00000-1111-4222-8333-${Date.now().toString().padStart(12, "0").slice(-12)}`;
const TEST_MATCH_ID = `test-users-${Date.now()}`;

describe.skipIf(!HAS_DATABASE_URL)("GET /api/users/:id/matches", () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    registerUserRoutes(app);
    return app;
  }

  afterAll(async () => {
    const prisma = getPrisma();
    await prisma.matchPlayer.deleteMany({ where: { matchId: TEST_MATCH_ID } });
    await prisma.match.deleteMany({ where: { id: TEST_MATCH_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await closePrisma();
  });

  it("非法 userId 返回 400", async () => {
    const res = await request(buildApp()).get("/api/users/!!bad!!/matches");
    expect(res.status).toBe(400);
  });

  it("不存在的账号返回 404", async () => {
    const res = await request(buildApp()).get(
      "/api/users/00000000-0000-4000-8000-000000000000/matches"
    );
    expect(res.status).toBe(404);
  });

  it("返回账号战绩档案（写入 → 查询闭环）", async () => {
    const prisma = getPrisma();
    await prisma.user.create({ data: { id: TEST_USER_ID, displayName: "集成测试员" } });
    const startedAt = new Date(Date.now() - 120000);
    await prisma.match.create({
      data: {
        id: TEST_MATCH_ID,
        rulesetVersion: "core-v1",
        contentSets: ["starter"],
        startedAt,
        endedAt: new Date(),
        winner: 0,
        players: {
          create: [
            { side: 0, name: "集成测试员", userId: TEST_USER_ID },
            { side: 1, name: "匿名对手" },
          ],
        },
      },
    });

    const res = await request(buildApp()).get(`/api/users/${TEST_USER_ID}/matches`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(TEST_USER_ID);
    expect(res.body.stats.total).toBeGreaterThanOrEqual(1);
    const entry = (res.body.matches as Array<{ matchId: string; result: string }>).find(
      (m) => m.matchId === TEST_MATCH_ID
    );
    expect(entry?.result).toBe("win");
  });
});
