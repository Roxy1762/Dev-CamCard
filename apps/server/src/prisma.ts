/**
 * Prisma singleton for the server.
 *
 * Prisma 7 requires a driver adapter for the runtime client.
 * We use @prisma/adapter-pg with the pg Pool.
 */
import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ── env 读取（开发时从 apps/server/.env，生产时从进程环境变量）────────────────

function resolveDatabaseUrl(): string {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  // 尝试从同级 .env 文件读取
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

// ── 全局单例（生产/开发均只实例化一次）──────────────────────────────────────

let _prisma: PrismaClient | null = null;
let _pool: pg.Pool | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const url = resolveDatabaseUrl();
    if (!url) {
      throw new Error("[Prisma] DATABASE_URL 未设置，无法连接数据库");
    }
    _pool = new pg.Pool({ connectionString: url });
    const adapter = new PrismaPg(_pool);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _prisma = new PrismaClient({ adapter } as any);
  }
  return _prisma;
}

/** 关闭连接池（进程退出时调用）*/
export async function closePrisma(): Promise<void> {
  if (_prisma) {
    await (_prisma as PrismaClient).$disconnect();
    _prisma = null;
  }
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
