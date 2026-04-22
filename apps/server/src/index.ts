import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { GameRoom } from "./rooms/GameRoom";
import { getPrisma, closePrisma } from "./prisma";

const port = Number(process.env.PORT ?? 2567);

function resolveAllowedOrigins(): string[] {
  const raw = process.env.CLIENT_ORIGIN?.trim();
  if (!raw) {
    return ["http://localhost:5173", "http://localhost:3000"];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = resolveAllowedOrigins();

const app = express();
// 允许来自 Phaser 开发服务器与部署前端的跨域请求
app.use(
  cors({
    origin(origin, callback) {
      // 无 Origin 的请求（health check / curl / 服务器间调用）直接放行。
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.redirect("/health");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", message: "房间服务已启动" });
});

// ── 只读对局 API ────────────────────────────────────────────────────────────────

/**
 * GET /api/matches
 * 返回最近 50 场对局（按开始时间倒序）。
 */
app.get("/api/matches", async (_req, res) => {
  try {
    const prisma = getPrisma();
    const matches = await prisma.match.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { players: { orderBy: { side: "asc" } } },
    });
    res.json(matches.map(serializeMatch));
  } catch (err) {
    console.error("[API] GET /api/matches 失败:", err);
    res.status(500).json({ error: "查询失败" });
  }
});

/**
 * GET /api/matches/:id
 * 返回指定对局详情（含玩家信息）。
 */
app.get("/api/matches/:id", async (req, res) => {
  try {
    const prisma = getPrisma();
    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      include: { players: { orderBy: { side: "asc" } } },
    });
    if (!match) {
      res.status(404).json({ error: "对局不存在" });
      return;
    }
    res.json(serializeMatch(match));
  } catch (err) {
    console.error("[API] GET /api/matches/:id 失败:", err);
    res.status(500).json({ error: "查询失败" });
  }
});

/**
 * GET /api/matches/:id/events
 * 返回该对局全部事件流（按 seq 升序）。
 */
app.get("/api/matches/:id/events", async (req, res) => {
  try {
    const prisma = getPrisma();
    const match = await prisma.match.findUnique({ where: { id: req.params.id } });
    if (!match) {
      res.status(404).json({ error: "对局不存在" });
      return;
    }
    const events = await prisma.matchEvent.findMany({
      where: { matchId: req.params.id },
      orderBy: { seq: "asc" },
    });
    res.json(events.map(serializeEvent));
  } catch (err) {
    console.error("[API] GET /api/matches/:id/events 失败:", err);
    res.status(500).json({ error: "查询失败" });
  }
});

// ── 序列化辅助（BigInt → string，避免 JSON.stringify 报错）──────────────────

type MatchRow = Awaited<ReturnType<ReturnType<typeof getPrisma>["match"]["findMany"]>>[number];
type EventRow = Awaited<ReturnType<ReturnType<typeof getPrisma>["matchEvent"]["findMany"]>>[number];

function serializeMatch(m: MatchRow) {
  return {
    id: m.id,
    rulesetVersion: m.rulesetVersion,
    contentSets: m.contentSets,
    startedAt: m.startedAt.toISOString(),
    endedAt: m.endedAt?.toISOString() ?? null,
    winner: m.winner,
    players:
      "players" in m
        ? (m as MatchRow & { players: { id: number; side: number; name: string }[] }).players
        : undefined,
  };
}

function serializeEvent(e: EventRow) {
  return {
    id: e.id,
    matchId: e.matchId,
    seq: e.seq,
    ts: e.ts.toString(), // BigInt → string
    type: e.type,
    side: e.side,
    data: e.data,
  };
}

// ── Colyseus 服务器 ──────────────────────────────────────────────────────────

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });
gameServer.define("game_room", GameRoom);

gameServer.listen(port).then(() => {
  console.log(`房间服务已启动，端口 ${port}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
  console.log(`WebSocket: ws://localhost:${port}`);
  console.log(`Health:    http://localhost:${port}/health`);
  console.log(`API:       http://localhost:${port}/api/matches`);
});

// 进程退出时关闭 Prisma 连接池
process.on("SIGINT", async () => {
  await closePrisma();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closePrisma();
  process.exit(0);
});
