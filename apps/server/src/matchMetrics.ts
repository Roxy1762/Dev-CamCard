/**
 * matchMetrics.ts — 把 MatchEvent 流压缩成可观测的指标字典。
 *
 * 设计动机（roadmap-next.md P1-3 平衡验证与观测）：
 *  - 回合时长 / 平均伤害 / 购买分布需要在不重跑引擎的前提下也能查到。
 *  - 服务端落库的 matchEvent 已经包含足够信号；这一层只做投影，不重算状态。
 *
 * 与引擎解耦：
 *  - 命令类型按字符串硬编码（与 packages/protocol/src/commands.ts 的 CMD.* 一致），
 *    避免 server 端只读 API 反向依赖运行时模块。
 *  - 若 protocol 端命令字段改名，这里会落下一个为 0 的桶，admin 上肉眼可见 ——
 *    比静默失败更好。
 */

export interface MetricsEventLike {
  /** 命令类型字符串 或 MATCH_START / MATCH_END */
  type: string;
  /** 服务端 ts（毫秒）。允许 bigint / number / string，内部统一 Number 化。 */
  ts: number | bigint | string;
  /** 0 / 1 = 玩家席位；null / undefined = 系统事件 */
  side?: number | null;
  /** 命令的精简 payload */
  data?: unknown;
}

export interface MetricsMatchLike {
  id: string;
  rulesetVersion: string;
  contentSets: string[];
  startedAt: Date;
  endedAt: Date | null;
  winner: number | null;
  players?: Array<{ side: number; name: string }>;
}

export interface MatchMetricsPerSide {
  side: number;
  name: string;
  cardsPlayed: number;
  cardsScheduled: number;
  marketBuys: number;
  reservedBuys: number;
  fixedBuys: number;
  totalBuys: number;
  venuesActivated: number;
  /** ASSIGN_ATTACK 命令次数（一条命令可能拆分多段攻击）。 */
  attackCommands: number;
  /** 所有 ASSIGN_ATTACK.assignments[].amount 之和 —— 该玩家累计造成的攻击量。 */
  totalAttackAmount: number;
  attacksOnPlayer: number;
  attacksOnVenue: number;
}

export interface MatchMetrics {
  matchId: string;
  rulesetVersion: string;
  contentSets: string[];
  startedAt: string;
  endedAt: string | null;
  winner: number | null;
  totalEvents: number;
  turns: number;
  /** 对局时长（毫秒）；无 MATCH_END 时按最末事件 ts 兜底。 */
  durationMs: number | null;
  /** 平均每回合时长（毫秒），turns ≥ 1 时才计算。 */
  avgTurnMs: number | null;
  perSide: MatchMetricsPerSide[];
}

function emptyPerSide(side: number, name: string): MatchMetricsPerSide {
  return {
    side,
    name,
    cardsPlayed: 0,
    cardsScheduled: 0,
    marketBuys: 0,
    reservedBuys: 0,
    fixedBuys: 0,
    totalBuys: 0,
    venuesActivated: 0,
    attackCommands: 0,
    totalAttackAmount: 0,
    attacksOnPlayer: 0,
    attacksOnVenue: 0,
  };
}

function toNumberTs(ts: number | bigint | string): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "bigint") return Number(ts);
  return Number(ts);
}

export function computeMatchMetrics(
  events: MetricsEventLike[],
  match: MetricsMatchLike
): MatchMetrics {
  const players = match.players ?? [];
  const sideName = (s: number): string =>
    players.find((p) => p.side === s)?.name ?? `P${s + 1}`;

  const perSide: Record<0 | 1, MatchMetricsPerSide> = {
    0: emptyPerSide(0, sideName(0)),
    1: emptyPerSide(1, sideName(1)),
  };

  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let matchEndTs: number | null = null;
  let turns = 0;

  for (const evt of events) {
    const ts = toNumberTs(evt.ts);
    if (firstTs === null) firstTs = ts;
    lastTs = ts;

    if (evt.type === "MATCH_END") {
      matchEndTs = ts;
    }
    if (evt.type === "END_TURN") {
      turns += 1;
    }

    const side = evt.side;
    if (side !== 0 && side !== 1) continue;
    const bucket = perSide[side];

    switch (evt.type) {
      case "PLAY_CARD":
        bucket.cardsPlayed += 1;
        break;
      case "PUT_CARD_TO_SCHEDULE":
        bucket.cardsScheduled += 1;
        break;
      case "BUY_MARKET_CARD":
        bucket.marketBuys += 1;
        bucket.totalBuys += 1;
        break;
      case "BUY_RESERVED_CARD":
        bucket.reservedBuys += 1;
        bucket.totalBuys += 1;
        break;
      case "BUY_FIXED_SUPPLY":
        bucket.fixedBuys += 1;
        bucket.totalBuys += 1;
        break;
      case "ACTIVATE_VENUE":
        bucket.venuesActivated += 1;
        break;
      case "ASSIGN_ATTACK": {
        bucket.attackCommands += 1;
        const data = evt.data as
          | { assignments?: Array<{ amount?: number; target?: string }> }
          | null
          | undefined;
        const assigns = data?.assignments ?? [];
        for (const a of assigns) {
          const amt = typeof a.amount === "number" ? a.amount : 0;
          bucket.totalAttackAmount += amt;
          if (a.target === "player") bucket.attacksOnPlayer += 1;
          else if (a.target === "venue") bucket.attacksOnVenue += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  const endTs = matchEndTs ?? lastTs;
  const durationMs = firstTs !== null && endTs !== null ? endTs - firstTs : null;
  const avgTurnMs =
    durationMs !== null && turns >= 1 ? Math.round(durationMs / turns) : null;

  return {
    matchId: match.id,
    rulesetVersion: match.rulesetVersion,
    contentSets: match.contentSets,
    startedAt: match.startedAt.toISOString(),
    endedAt: match.endedAt?.toISOString() ?? null,
    winner: match.winner,
    totalEvents: events.length,
    turns,
    durationMs,
    avgTurnMs,
    perSide: [perSide[0], perSide[1]],
  };
}
