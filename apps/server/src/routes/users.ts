/**
 * routes/users.ts — 账号维度只读 API（P3-2 对战记录与账号关联）。
 *
 * 与 index.ts 内联路由不同，这里抽成可注册函数：
 *  - index.ts 与集成测试共用同一份处理逻辑，杜绝"测试里复制一份路由"导致的漂移。
 *  - prisma 以工厂注入，测试可指向同一单例而不强耦合进程级状态。
 */

import type { Express } from "express";
import { getPrisma } from "../prisma";
import { normalizeUserId, buildUserMatchesSummary } from "../users";

type PrismaProvider = typeof getPrisma;

/**
 * GET /api/users/:id/matches
 * 返回某账号的对战档案：账号信息 + 战绩聚合（场次/胜率/平均时长）+ 对局列表。
 * 单局回放复用既有 GET /api/matches/:id/replay。
 */
export function registerUserRoutes(app: Express, prismaProvider: PrismaProvider = getPrisma): void {
  app.get("/api/users/:id/matches", async (req, res) => {
    const userId = normalizeUserId(req.params.id);
    if (!userId) {
      res.status(400).json({ error: "userId 格式不合法" });
      return;
    }

    try {
      const prisma = prismaProvider();
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "账号不存在" });
        return;
      }

      const matches = await prisma.match.findMany({
        where: { players: { some: { userId } } },
        orderBy: { startedAt: "desc" },
        take: 50,
        include: { players: { orderBy: { side: "asc" } } },
      });

      res.json(buildUserMatchesSummary(user, matches));
    } catch (err) {
      console.error("[API] GET /api/users/:id/matches 失败:", err);
      res.status(500).json({ error: "查询失败" });
    }
  });
}
