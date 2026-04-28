import { NextResponse } from "next/server";

const SERVER_URL =
  process.env.ADMIN_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:2567";

/**
 * 透传 server 健康检查 —— 同时拉 /health 与 /health/db，给 admin 一个统一视图。
 * 任一失败不阻断另一个，便于诊断"server 起来了但 DB 没连上"这种情况。
 */
export async function GET() {
  const startedAt = Date.now();
  const [coreRes, dbRes] = await Promise.allSettled([
    fetch(`${SERVER_URL}/health`, { cache: "no-store" }),
    fetch(`${SERVER_URL}/health/db`, { cache: "no-store" }),
  ]);

  const core =
    coreRes.status === "fulfilled" && coreRes.value.ok
      ? { ok: true as const, status: coreRes.value.status }
      : {
          ok: false as const,
          error:
            coreRes.status === "rejected"
              ? String(coreRes.reason)
              : `HTTP ${coreRes.value.status}`,
        };

  const db =
    dbRes.status === "fulfilled" && dbRes.value.ok
      ? { ok: true as const, status: dbRes.value.status }
      : {
          ok: false as const,
          error:
            dbRes.status === "rejected"
              ? String(dbRes.reason)
              : `HTTP ${dbRes.value.status}`,
        };

  return NextResponse.json({
    server: SERVER_URL,
    core,
    db,
    elapsedMs: Date.now() - startedAt,
  });
}
