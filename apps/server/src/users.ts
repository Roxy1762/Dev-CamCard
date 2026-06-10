/**
 * users.ts — 账号系统最小实现的纯函数层（P3-1 / P3-2）。
 *
 * 设计原则（与 matchMetrics.ts / matchReplay.ts 同构）：
 *  - 校验与聚合全部是纯函数，DB 行显式传入，可脱离数据库单测。
 *  - 身份模型：客户端生成 UUID 并持久化在 localStorage，入座时随
 *    joinOptions 带上；服务端 upsert User 并把 userId 写到 MatchPlayer。
 *  - 当前阶段无认证（known-issues 已记录）：知道某个 userId 即可查询其
 *    战绩——与 /api/matches 本就公开的现状一致，后续接 OAuth 再收紧。
 */

/**
 * 合法 userId 形态：8~64 位的字母 / 数字 / 连字符。
 * 覆盖 crypto.randomUUID() 输出，同时拒绝空串、超长串与特殊字符注入。
 */
export const USER_ID_PATTERN = /^[0-9a-zA-Z-]{8,64}$/;

/**
 * 把 joinOptions / URL 参数里的原始值规范成合法 userId；不合法返回 null。
 * GameRoom 与只读 API 共用，保证两侧口径一致。
 */
export function normalizeUserId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return USER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

// ── 战绩聚合 ──────────────────────────────────────────────────────────────────

/** 与 Prisma 行兼容的输入形（避免直接依赖生成的 client 类型）。 */
export interface UserMatchRowInput {
  id: string;
  startedAt: Date | string;
  endedAt: Date | string | null;
  winner: number | null;
  rulesetVersion?: string;
  players: Array<{ side: number; name: string; userId?: string | null }>;
}

export interface UserInfoInput {
  id: string;
  displayName: string;
  createdAt: Date | string;
  lastSeenAt?: Date | string;
}

export type UserMatchResult = "win" | "loss" | "draw" | "ongoing";

export interface UserMatchEntry {
  matchId: string;
  startedAt: string;
  endedAt: string | null;
  /** endedAt - startedAt（毫秒）；未结束为 null */
  durationMs: number | null;
  /** 该账号在本局的席位（0 | 1） */
  mySide: number;
  myName: string;
  opponentName: string;
  winner: number | null;
  result: UserMatchResult;
}

export interface UserMatchStats {
  total: number;
  finished: number;
  wins: number;
  losses: number;
  draws: number;
  ongoing: number;
  /** wins / finished，保留 3 位小数；无已结束对局为 null */
  winRate: number | null;
  /** 已结束对局平均时长（毫秒）；无已结束对局为 null */
  avgDurationMs: number | null;
}

export interface UserMatchesSummary {
  user: { id: string; displayName: string; createdAt: string; lastSeenAt: string | null };
  stats: UserMatchStats;
  matches: UserMatchEntry[];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function classifyResult(mySide: number, winner: number | null, ended: boolean): UserMatchResult {
  if (!ended) return "ongoing";
  if (winner === null) return "draw";
  return winner === mySide ? "win" : "loss";
}

/**
 * buildUserMatchesSummary — 把某账号参与过的对局行聚合成战绩档案。
 *
 * @param user    User 表行（路由层已确认存在）
 * @param matches 该账号参与的对局（含 players，按 startedAt 倒序传入即可）
 */
export function buildUserMatchesSummary(
  user: UserInfoInput,
  matches: UserMatchRowInput[]
): UserMatchesSummary {
  const entries: UserMatchEntry[] = [];

  for (const m of matches) {
    const mine = m.players.find((p) => p.userId === user.id);
    // 数据异常（查询条件应保证存在）：跳过而非抛错，保持只读 API 健壮。
    if (!mine) continue;

    const opponent = m.players.find((p) => p.side !== mine.side);
    const ended = m.endedAt !== null;
    const durationMs = ended ? Math.max(0, toMillis(m.endedAt!) - toMillis(m.startedAt)) : null;

    entries.push({
      matchId: m.id,
      startedAt: toIso(m.startedAt),
      endedAt: ended ? toIso(m.endedAt!) : null,
      durationMs,
      mySide: mine.side,
      myName: mine.name,
      opponentName: opponent?.name ?? "（虚位以待）",
      winner: m.winner,
      result: classifyResult(mine.side, m.winner, ended),
    });
  }

  const finishedEntries = entries.filter((e) => e.result !== "ongoing");
  const wins = entries.filter((e) => e.result === "win").length;
  const losses = entries.filter((e) => e.result === "loss").length;
  const draws = entries.filter((e) => e.result === "draw").length;
  const finished = finishedEntries.length;
  const durations = finishedEntries
    .map((e) => e.durationMs)
    .filter((d): d is number => d !== null);

  const stats: UserMatchStats = {
    total: entries.length,
    finished,
    wins,
    losses,
    draws,
    ongoing: entries.length - finished,
    winRate: finished > 0 ? Math.round((wins / finished) * 1000) / 1000 : null,
    avgDurationMs:
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
  };

  return {
    user: {
      id: user.id,
      displayName: user.displayName,
      createdAt: toIso(user.createdAt),
      lastSeenAt: user.lastSeenAt != null ? toIso(user.lastSeenAt) : null,
    },
    stats,
    matches: entries,
  };
}
