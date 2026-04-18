/**
 * persistence.test.ts
 *
 * 最小持久化验证：
 * 1. Prisma 能连接真实 DB 并写入 / 读取 Match
 * 2. MatchEvent 的 BigInt ts 字段正确落库并读回
 * 3. 只读 API 端点返回正确格式（通过 express app 直接测试，无需 HTTP 服务）
 *
 * 不测试 GameRoom 业务逻辑，不测试 Colyseus 状态同步。
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { getPrisma, closePrisma } from "../prisma";
import { Prisma } from "@prisma/client";

const HAS_DATABASE_URL = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

// ── 测试用 matchId ──────────────────────────────────────────────────────────
const TEST_MATCH_ID = `test-persist-${Date.now()}`;

// ── 复用 index.ts 的 API 路由（直接内联，避免引入 Colyseus 启动逻辑）─────────

function buildTestApp() {
  const prisma = getPrisma();
  const app = express();
  app.use(express.json());

  app.get("/api/matches", async (_req, res) => {
    const matches = await prisma.match.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { players: { orderBy: { side: "asc" } } },
    });
    res.json(matches.map((m) => ({ id: m.id, winner: m.winner })));
  });

  app.get("/api/matches/:id", async (req, res) => {
    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      include: { players: { orderBy: { side: "asc" } } },
    });
    if (!match) { res.status(404).json({ error: "not found" }); return; }
    res.json({ id: match.id, winner: match.winner });
  });

  app.get("/api/matches/:id/events", async (req, res) => {
    const events = await prisma.matchEvent.findMany({
      where: { matchId: req.params.id },
      orderBy: { seq: "asc" },
    });
    res.json(events.map((e) => ({
      seq: e.seq,
      ts: e.ts.toString(),
      type: e.type,
    })));
  });

  return app;
}

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe.skipIf(!HAS_DATABASE_URL)("Prisma 持久化 & 只读 API", () => {
  afterAll(async () => {
    // 清理测试数据
    const prisma = getPrisma();
    await prisma.matchEvent.deleteMany({ where: { matchId: TEST_MATCH_ID } });
    await prisma.matchPlayer.deleteMany({ where: { matchId: TEST_MATCH_ID } });
    await prisma.match.deleteMany({ where: { id: TEST_MATCH_ID } });
    await closePrisma();
  });

  it("写入 Match 并读回", async () => {
    const prisma = getPrisma();
    const now = new Date();
    await prisma.match.create({
      data: {
        id: TEST_MATCH_ID,
        rulesetVersion: "core-v1",
        contentSets: ["starter", "market-core"],
        startedAt: now,
      },
    });
    const found = await prisma.match.findUnique({ where: { id: TEST_MATCH_ID } });
    expect(found).not.toBeNull();
    expect(found!.rulesetVersion).toBe("core-v1");
    expect(found!.winner).toBeNull();
  });

  it("写入 MatchEvent（BigInt ts）并读回", async () => {
    const prisma = getPrisma();
    const ts = BigInt(Date.now());
    await prisma.matchEvent.create({
      data: {
        matchId: TEST_MATCH_ID,
        seq: 0,
        ts,
        type: "MATCH_START",
        side: null,
        data: Prisma.JsonNull,
      },
    });
    const events = await prisma.matchEvent.findMany({
      where: { matchId: TEST_MATCH_ID },
    });
    expect(events).toHaveLength(1);
    expect(events[0].ts).toBe(ts);
    expect(events[0].type).toBe("MATCH_START");
  });

  it("更新 Match winner / endedAt", async () => {
    const prisma = getPrisma();
    await prisma.match.update({
      where: { id: TEST_MATCH_ID },
      data: { winner: 0, endedAt: new Date() },
    });
    const found = await prisma.match.findUnique({ where: { id: TEST_MATCH_ID } });
    expect(found!.winner).toBe(0);
    expect(found!.endedAt).not.toBeNull();
  });

  it("GET /api/matches 包含测试对局", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/matches");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain(TEST_MATCH_ID);
  });

  it("GET /api/matches/:id 返回对局详情", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/api/matches/${TEST_MATCH_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_MATCH_ID);
  });

  it("GET /api/matches/:id 不存在时返回 404", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/matches/does-not-exist-xyz");
    expect(res.status).toBe(404);
  });

  it("GET /api/matches/:id/events 返回事件（ts 为字符串）", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/api/matches/${TEST_MATCH_ID}/events`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const evt = (res.body as Array<{ seq: number; ts: string; type: string }>)[0];
    expect(evt.seq).toBe(0);
    expect(typeof evt.ts).toBe("string");   // BigInt 序列化为 string
    expect(evt.type).toBe("MATCH_START");
  });
});
