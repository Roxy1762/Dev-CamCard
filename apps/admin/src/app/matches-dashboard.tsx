"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MatchPlayer = { side: number; name: string };
type MatchRow = {
  id: string;
  rulesetVersion: string;
  contentSets: string[];
  startedAt: string;
  endedAt: string | null;
  winner: number | null;
  players?: MatchPlayer[];
};

type MatchEventRow = {
  id: number;
  seq: number;
  ts: string;
  type: string;
  side: number | null;
  data: unknown;
};

type MatchMetricsSide = {
  side: number;
  name: string;
  cardsPlayed: number;
  cardsScheduled: number;
  marketBuys: number;
  reservedBuys: number;
  fixedBuys: number;
  totalBuys: number;
  venuesActivated: number;
  attackCommands: number;
  totalAttackAmount: number;
  attacksOnPlayer: number;
  attacksOnVenue: number;
};

type MatchMetrics = {
  matchId: string;
  rulesetVersion: string;
  startedAt: string;
  endedAt: string | null;
  winner: number | null;
  totalEvents: number;
  turns: number;
  durationMs: number | null;
  avgTurnMs: number | null;
  perSide: MatchMetricsSide[];
};

type DashboardProps = { apiBase: string };

/** 自动刷新可选间隔。"off" 表示关闭。 */
const REFRESH_INTERVALS: Array<{ key: string; label: string; ms: number }> = [
  { key: "off", label: "关闭", ms: 0 },
  { key: "10s", label: "10 秒", ms: 10_000 },
  { key: "30s", label: "30 秒", ms: 30_000 },
  { key: "60s", label: "1 分钟", ms: 60_000 },
];

export default function MatchesDashboard({ apiBase: _apiBase }: DashboardProps) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<MatchEventRow[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [metrics, setMetrics] = useState<MatchMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState<string>("30s");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  /** 详情面板模式：事件流（命令列表）或逐帧回放（牌桌状态）。 */
  const [panelMode, setPanelMode] = useState<"events" | "replay">("events");

  const load = useCallback(async () => {
    setStatus("loading");
    setErr(null);
    try {
      const res = await fetch(`/api/matches`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as MatchRow[];
      setMatches(data);
      setStatus("ok");
      setLastRefreshedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 自动刷新：interval 期间每隔 N ms 重新拉取列表。
  useEffect(() => {
    const interval = REFRESH_INTERVALS.find((i) => i.key === refreshKey);
    if (!interval || interval.ms === 0) return;
    const id = setInterval(() => void load(), interval.ms);
    return () => clearInterval(id);
  }, [refreshKey, load]);

  const openEvents = useCallback(async (matchId: string, mode: "events" | "replay" = "events") => {
    setSelected(matchId);
    setPanelMode(mode);
    setEvents(null);
    setMetrics(null);
    setEventsLoading(true);
    setMetricsLoading(true);
    setEventTypeFilter("all");
    // 同时拉事件流与指标聚合，两条请求互不阻塞
    void (async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/events`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as MatchEventRow[];
        setEvents(data);
      } catch (e) {
        setEvents([]);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setEventsLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/metrics`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as MatchMetrics;
        setMetrics(data);
      } catch {
        // 指标失败不阻塞事件流展示 —— 静默兜底，避免 panel 永远进不去。
        setMetrics(null);
      } finally {
        setMetricsLoading(false);
      }
    })();
  }, []);

  // ── 统计：总场数 / 进行中 / 完结 / 平均时长 ──────────────────────────────
  const stats = useMemo(() => {
    if (matches.length === 0) {
      return { total: 0, live: 0, ended: 0, avgDurationSec: null as number | null };
    }
    let live = 0;
    let ended = 0;
    let durSum = 0;
    let durCnt = 0;
    for (const m of matches) {
      if (m.endedAt) {
        ended++;
        const d = (new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 1000;
        if (Number.isFinite(d) && d > 0) {
          durSum += d;
          durCnt++;
        }
      } else {
        live++;
      }
    }
    return {
      total: matches.length,
      live,
      ended,
      avgDurationSec: durCnt > 0 ? Math.round(durSum / durCnt) : null,
    };
  }, [matches]);

  // 事件流类型筛选
  const eventTypes = useMemo(() => {
    if (!events) return [] as string[];
    const set = new Set<string>();
    for (const e of events) set.add(e.type);
    return Array.from(set).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    if (eventTypeFilter === "all") return events;
    return events.filter((e) => e.type === eventTypeFilter);
  }, [events, eventTypeFilter]);

  /** 把当前 events 导出为 JSON 文件，供运营复盘用。 */
  const downloadEvents = useCallback(() => {
    if (!events || !selected) return;
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `match-${selected}-events.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events, selected]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: "1.2rem", margin: 0 }}>最近对局</h2>
        <button
          type="button"
          onClick={() => void load()}
          style={refreshBtn}
        >
          {status === "loading" ? "加载中..." : "刷新"}
        </button>

        <label style={selectorLabel}>
          自动刷新：
          <select
            value={refreshKey}
            onChange={(e) => setRefreshKey(e.target.value)}
            style={selectStyle}
          >
            {REFRESH_INTERVALS.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
              </option>
            ))}
          </select>
        </label>

        {lastRefreshedAt && (
          <span style={{ color: "#888", fontSize: "0.8rem" }}>
            最近刷新 {fmtAgo(lastRefreshedAt)}
          </span>
        )}

        {status === "error" && (
          <span style={{ color: "#c00" }}>
            拉取失败：{err}（请确认 server 已启动且 NEXT_PUBLIC_API_BASE 可达）
          </span>
        )}
      </header>

      {/* ── 概览统计卡 ─────────────────────────────────────────── */}
      {status === "ok" && (
        <div style={statsRow}>
          <StatCard label="总场数" value={String(stats.total)} />
          <StatCard label="进行中" value={String(stats.live)} accent="#1e88e5" />
          <StatCard label="已结束" value={String(stats.ended)} accent="#22a360" />
          <StatCard
            label="平均时长"
            value={stats.avgDurationSec != null ? fmtDuration(stats.avgDurationSec) : "—"}
          />
        </div>
      )}

      {status === "ok" && matches.length === 0 && (
        <p style={{ color: "#777" }}>
          还没有对局记录。先去游戏前端打一把，这里就会看到数据。
        </p>
      )}

      {matches.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={cellHead}>Match ID</th>
                <th style={cellHead}>玩家</th>
                <th style={cellHead}>开始</th>
                <th style={cellHead}>结束</th>
                <th style={cellHead}>胜方</th>
                <th style={cellHead}>状态</th>
                <th style={cellHead}>操作</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const isLive = !m.endedAt;
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={cell}>
                      <code style={{ fontSize: "0.8rem" }}>{m.id.slice(0, 12)}</code>
                    </td>
                    <td style={cell}>
                      {(m.players ?? [])
                        .map((p) => `[${p.side}] ${p.name}`)
                        .join(" vs ") || "-"}
                    </td>
                    <td style={cell}>{fmt(m.startedAt)}</td>
                    <td style={cell}>{m.endedAt ? fmt(m.endedAt) : "—"}</td>
                    <td style={cell}>
                      {m.winner == null ? "—" : `side ${m.winner}`}
                    </td>
                    <td style={cell}>
                      <span
                        style={{
                          ...statusPill,
                          background: isLive ? "#fff7d6" : "#eef9f0",
                          color: isLive ? "#a37300" : "#1f6b3d",
                        }}
                      >
                        {isLive ? "进行中" : "已结束"}
                      </span>
                    </td>
                    <td style={cell}>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button
                          type="button"
                          onClick={() => void openEvents(m.id, "events")}
                          style={{
                            padding: "0.2rem 0.6rem",
                            cursor: "pointer",
                            border: "1px solid #ccc",
                            background:
                              selected === m.id && panelMode === "events" ? "#eee" : "#fff",
                          }}
                        >
                          事件流
                        </button>
                        <button
                          type="button"
                          onClick={() => void openEvents(m.id, "replay")}
                          style={{
                            padding: "0.2rem 0.6rem",
                            cursor: "pointer",
                            border: "1px solid #ccc",
                            background:
                              selected === m.id && panelMode === "replay" ? "#eee" : "#fff",
                          }}
                        >
                          回放
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <section
          style={{
            border: "1px solid #eee",
            padding: "1rem",
            background: "#fafafa",
            maxHeight: 460,
            overflow: "auto",
          }}
        >
          <header
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              marginBottom: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <strong>{panelMode === "replay" ? "逐帧回放：" : "事件流："}</strong>
            <code style={{ fontSize: "0.8rem", color: "#444" }}>{selected}</code>
            {panelMode === "events" && events && events.length > 0 && (
              <>
                <span style={{ color: "#888", fontSize: "0.85rem" }}>
                  共 {events.length} 条 / 当前 {filteredEvents.length} 条
                </span>
                <label style={selectorLabel}>
                  类型筛选：
                  <select
                    value={eventTypeFilter}
                    onChange={(e) => setEventTypeFilter(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="all">全部</option>
                    {eventTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={downloadEvents} style={refreshBtn}>
                  导出 JSON
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setEvents(null);
                setMetrics(null);
              }}
              style={{
                marginLeft: "auto",
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              关闭 ✕
            </button>
          </header>

          {/* 对局指标聚合（P1-3）：在事件流上方先给一个一眼可读的小看板 */}
          <MatchMetricsPanel
            metrics={metrics}
            loading={metricsLoading}
          />

          {panelMode === "replay" && selected && <ReplayViewer matchId={selected} />}

          {panelMode === "events" && (
            <>
              {eventsLoading && <p style={{ color: "#888" }}>加载事件中...</p>}
              {!eventsLoading && events && events.length === 0 && (
                <p style={{ color: "#888" }}>无事件。</p>
              )}
              {!eventsLoading && filteredEvents.length > 0 && (
                <ol style={{ paddingLeft: "1.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
                  {filteredEvents.map((e) => (
                    <li key={e.id} style={{ marginBottom: "0.25rem" }}>
                      <span style={{ color: "#888" }}>#{e.seq}</span>{" "}
                      <span style={{ color: "#06c" }}>{e.type}</span>
                      {e.side != null && (
                        <span style={{ color: "#999" }}> (side {e.side})</span>
                      )}
                      {e.data != null && (
                        <pre
                          style={{
                            margin: "0.25rem 0 0",
                            padding: "0.25rem 0.5rem",
                            background: "#eee",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {safeStringify(e.data)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}

// ── 子组件 / 工具 ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 140px",
        minWidth: 120,
        padding: "0.75rem 1rem",
        border: "1px solid #e5e7ee",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <div style={{ color: "#888", fontSize: "0.75rem", marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: accent ?? "#222",
          fontSize: "1.4rem",
          fontWeight: 600,
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── 对局指标看板（P1-3 平衡观测） ─────────────────────────────────────────────
// 渲染规则：
//   - loading：占位
//   - 无 metrics（接口失败 / 旧数据）：直接不渲染，避免污染 UI
//   - 有 metrics：渲染 4 个 KPI（回合数 / 时长 / 平均回合时长 / 总事件）+ 双侧对照表
function MatchMetricsPanel({
  metrics,
  loading,
}: {
  metrics: MatchMetrics | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div style={{ color: "#888", padding: "0.25rem 0" }}>加载对局指标中...</div>
    );
  }
  if (!metrics) return null;

  const durSec =
    metrics.durationMs !== null ? Math.round(metrics.durationMs / 1000) : null;
  const avgSec =
    metrics.avgTurnMs !== null ? Math.round(metrics.avgTurnMs / 1000) : null;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem",
        border: "1px solid #e5e7ee",
        borderRadius: 8,
        background: "#fafbfd",
      }}
    >
      <header style={{ fontWeight: 600, color: "#444" }}>对局指标</header>
      <div style={statsRow}>
        <StatCard label="回合数" value={String(metrics.turns)} />
        <StatCard
          label="对局时长"
          value={durSec === null ? "—" : fmtDuration(durSec)}
        />
        <StatCard
          label="平均每回合"
          value={avgSec === null ? "—" : fmtDuration(avgSec)}
        />
        <StatCard label="事件总数" value={String(metrics.totalEvents)} />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead>
          <tr style={{ background: "#f0f2f8" }}>
            <th style={cellHead}>玩家</th>
            <th style={cellHead}>出牌</th>
            <th style={cellHead}>安排</th>
            <th style={cellHead}>市场买</th>
            <th style={cellHead}>预约买</th>
            <th style={cellHead}>固定补给</th>
            <th style={cellHead}>购买合计</th>
            <th style={cellHead}>激活场馆</th>
            <th style={cellHead}>攻击次数</th>
            <th style={cellHead}>总攻击量</th>
            <th style={cellHead}>打玩家 / 场馆</th>
          </tr>
        </thead>
        <tbody>
          {metrics.perSide.map((p) => (
            <tr key={p.side} style={{ borderBottom: "1px solid #eee" }}>
              <td style={cell}>
                <strong>P{p.side + 1}</strong>{" "}
                <span style={{ color: "#888" }}>{p.name}</span>
                {metrics.winner === p.side && (
                  <span
                    style={{
                      marginLeft: 6,
                      padding: "0 6px",
                      background: "#dcfbe2",
                      color: "#1f7a36",
                      borderRadius: 4,
                      fontSize: "0.7rem",
                    }}
                  >
                    胜
                  </span>
                )}
              </td>
              <td style={cell}>{p.cardsPlayed}</td>
              <td style={cell}>{p.cardsScheduled}</td>
              <td style={cell}>{p.marketBuys}</td>
              <td style={cell}>{p.reservedBuys}</td>
              <td style={cell}>{p.fixedBuys}</td>
              <td style={cell}>
                <strong>{p.totalBuys}</strong>
              </td>
              <td style={cell}>{p.venuesActivated}</td>
              <td style={cell}>{p.attackCommands}</td>
              <td style={cell}>
                <strong>{p.totalAttackAmount}</strong>
              </td>
              <td style={cell}>
                {p.attacksOnPlayer} / {p.attacksOnVenue}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── 逐帧回放（P0-4 可复现回放的牌桌渲染层） ─────────────────────────────────
// 消费 /api/matches/:id/replay 返回的逐帧 PublicMatchView，提供
// 起点 / 上一步 / 播放(1x·2x·4x) / 下一步 / 末尾 + 进度条，并把当前帧的
// 牌桌状态（双方 HP / 资源 / 攻击 / 场馆 / 日程 / 预约 + 三栏市场）渲染出来。

type ReplayVenue = {
  cardId: string;
  durability: number;
  maxDurability: number;
  isGuard: boolean;
  activationsLeft: number;
};
type ReplayCardRef = { id: string; instanceId: string };
type ReplayPlayer = {
  side: number;
  name: string;
  hp: number;
  block: number;
  deckSize: number;
  handSize: number;
  discardSize: number;
  resourcePool: number;
  attackPool: number;
  venues: ReplayVenue[];
  scheduleSlots: (ReplayCardRef | null)[];
  reservedCard: ReplayCardRef | null;
  pendingDiscardCount: number;
};
type ReplayMarketLane = { lane: string; slots: (ReplayCardRef | null)[] };
type ReplayView = {
  turnNumber: number;
  activePlayer: number;
  players: [ReplayPlayer, ReplayPlayer];
  market: ReplayMarketLane[];
  fixedSupplies: string[];
  started: boolean;
  ended: boolean;
  winner: number | null;
};
type ReplayFrame = {
  index: number;
  seq: number;
  ts: number;
  type: string;
  side: number | null;
  error?: string;
  view: ReplayView;
};
type ReplayResult = {
  matchId: string;
  initialSeed: number;
  playerNames: [string, string];
  initialView: ReplayView;
  frameCount: number;
  errors: Array<{ seq: number; type: string; message: string }>;
  frames: ReplayFrame[];
};

const REPLAY_SPEEDS = [1, 2, 4];

function ReplayViewer({ matchId }: { matchId: string }) {
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // -1 = 起点（initialView，未应用任何事件）；0..frameCount-1 = frames[cursor]
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setResult(null);
    setCursor(-1);
    setPlaying(false);
    void (async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/replay`, { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as ReplayResult;
        if (alive) setResult(data);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [matchId]);

  const frameCount = result?.frameCount ?? 0;

  // 自动播放：按 speed 推进 cursor，到末尾自动停。
  useEffect(() => {
    if (!playing || frameCount === 0) return;
    if (cursor >= frameCount - 1) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setCursor((c) => Math.min(frameCount - 1, c + 1)), Math.max(120, 1000 / speed));
    return () => clearTimeout(id);
  }, [playing, cursor, speed, frameCount]);

  if (loading) return <p style={{ color: "#888" }}>重建回放中...</p>;
  if (err) return <p style={{ color: "#c00" }}>回放加载失败：{err}</p>;
  if (!result) return <p style={{ color: "#888" }}>无回放数据。</p>;
  if (frameCount === 0) {
    return <p style={{ color: "#888" }}>该对局暂无可回放事件。</p>;
  }

  const atStart = cursor <= -1;
  const atEnd = cursor >= frameCount - 1;
  const frame = cursor < 0 ? null : result.frames[cursor];
  const view = frame ? frame.view : result.initialView;

  const jump = (i: number) => {
    setPlaying(false);
    setCursor(Math.max(-1, Math.min(frameCount - 1, i)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {/* 控制条 */}
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={replayBtnStyle} disabled={atStart} onClick={() => jump(-1)}>
          ⏮ 起点
        </button>
        <button type="button" style={replayBtnStyle} disabled={atStart} onClick={() => jump(cursor - 1)}>
          ◀ 上一步
        </button>
        {playing ? (
          <button type="button" style={replayBtnStyle} onClick={() => setPlaying(false)}>
            ⏸ 暂停
          </button>
        ) : (
          <button type="button" style={replayBtnStyle} disabled={atEnd} onClick={() => setPlaying(true)}>
            ▶ 播放
          </button>
        )}
        <button type="button" style={replayBtnStyle} disabled={atEnd} onClick={() => jump(cursor + 1)}>
          下一步 ▶
        </button>
        <button type="button" style={replayBtnStyle} disabled={atEnd} onClick={() => jump(frameCount - 1)}>
          ⏭ 末尾
        </button>
        <span style={{ marginLeft: 6, fontSize: "0.8rem", color: "#555" }}>速度</span>
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            style={{ ...replayBtnStyle, background: speed === s ? "#06c" : "#222" }}
            onClick={() => setSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* 进度 */}
      <input
        type="range"
        min={-1}
        max={frameCount - 1}
        value={cursor}
        onChange={(e) => jump(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      <div style={{ fontSize: "0.8rem", color: "#555", fontFamily: "monospace" }}>
        {cursor < 0
          ? `起点（共 ${frameCount} 帧，seed=${result.initialSeed}）`
          : `第 ${cursor + 1} / ${frameCount} 帧 · seq=${frame!.seq} · ${frame!.type}${
              frame!.side != null ? ` (side ${frame!.side})` : ""
            }`}
        {frame?.error && <span style={{ color: "#c00" }}> · ⚠ {frame.error}</span>}
      </div>

      {/* 牌桌状态 */}
      <div style={{ fontSize: "0.85rem", color: "#333" }}>
        回合 {view.turnNumber} · 行动方 P{view.activePlayer + 1}
        {view.ended && (
          <span style={{ marginLeft: 8, color: "#1f7a36", fontWeight: 600 }}>
            对局结束 · 胜者 {view.winner == null ? "—" : `P${view.winner + 1}`}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {view.players.map((p) => (
          <ReplayPlayerCard key={p.side} p={p} active={p.side === view.activePlayer} />
        ))}
      </div>

      {/* 市场三栏 */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {view.market.map((lane) => (
          <div key={lane.lane} style={replayLaneStyle}>
            <div style={{ fontWeight: 600, color: "#06c", fontSize: "0.8rem" }}>
              {lane.lane.toUpperCase()}
            </div>
            {lane.slots.map((s, i) => (
              <div key={i} style={{ fontSize: "0.78rem", color: s ? "#333" : "#bbb" }}>
                {s ? s.id : "（空）"}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReplayPlayerCard({ p, active }: { p: ReplayPlayer; active: boolean }) {
  return (
    <div
      style={{
        flex: "1 1 280px",
        minWidth: 260,
        border: `1px solid ${active ? "#06c" : "#e5e7ee"}`,
        borderRadius: 8,
        padding: "0.5rem 0.75rem",
        background: active ? "#f0f6ff" : "#fff",
        fontSize: "0.82rem",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        P{p.side + 1} · {p.name}
        {active && <span style={{ color: "#06c", marginLeft: 6 }}>● 行动中</span>}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontFamily: "monospace" }}>
        <span>HP {p.hp}</span>
        <span>防备 {p.block}</span>
        <span>资源 {p.resourcePool}</span>
        <span>攻击 {p.attackPool}</span>
        <span style={{ color: "#888" }}>手 {p.handSize}</span>
        <span style={{ color: "#888" }}>堆 {p.deckSize}</span>
        <span style={{ color: "#888" }}>弃 {p.discardSize}</span>
      </div>
      {p.venues.length > 0 && (
        <div style={{ marginTop: 4, color: "#555" }}>
          场馆：
          {p.venues.map((v, i) => (
            <span key={i} style={{ marginRight: 8 }}>
              {v.isGuard ? "🛡" : "🏛"} {v.cardId} ({v.durability}/{v.maxDurability})
            </span>
          ))}
        </div>
      )}
      {p.scheduleSlots.some((s) => s) && (
        <div style={{ marginTop: 2, color: "#555" }}>
          日程：{p.scheduleSlots.map((s) => (s ? s.id : "空")).join(" · ")}
        </div>
      )}
      {p.reservedCard && (
        <div style={{ marginTop: 2, color: "#555" }}>预约：{p.reservedCard.id}</div>
      )}
      {p.pendingDiscardCount > 0 && (
        <div style={{ marginTop: 2, color: "#a37300" }}>
          下回合需弃 {p.pendingDiscardCount} 张
        </div>
      )}
    </div>
  );
}

const replayBtnStyle: React.CSSProperties = {
  padding: "0.2rem 0.55rem",
  background: "#222",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "0.8rem",
};

const replayLaneStyle: React.CSSProperties = {
  flex: "1 1 160px",
  minWidth: 140,
  border: "1px solid #e5e7ee",
  borderRadius: 6,
  padding: "0.4rem 0.6rem",
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const cellHead: React.CSSProperties = {
  padding: "0.5rem",
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const cell: React.CSSProperties = {
  padding: "0.5rem",
  verticalAlign: "top",
};

const refreshBtn: React.CSSProperties = {
  padding: "0.25rem 0.75rem",
  background: "#222",
  color: "#eee",
  border: "1px solid #444",
  cursor: "pointer",
  borderRadius: 4,
};

const selectorLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: "0.85rem",
  color: "#555",
};

const selectStyle: React.CSSProperties = {
  padding: "0.2rem 0.4rem",
  border: "1px solid #ccc",
  borderRadius: 4,
};

const statsRow: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
};

const statusPill: React.CSSProperties = {
  display: "inline-block",
  padding: "0 8px",
  borderRadius: 999,
  fontSize: "0.75rem",
  border: "1px solid currentColor",
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtAgo(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s 前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m 前`;
  return `${Math.round(min / 60)}h 前`;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
