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
  const [refreshKey, setRefreshKey] = useState<string>("30s");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");

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

  const openEvents = useCallback(async (matchId: string) => {
    setSelected(matchId);
    setEvents(null);
    setEventsLoading(true);
    setEventTypeFilter("all");
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
                      <button
                        type="button"
                        onClick={() => void openEvents(m.id)}
                        style={{
                          padding: "0.2rem 0.6rem",
                          cursor: "pointer",
                          border: "1px solid #ccc",
                          background: selected === m.id ? "#eee" : "#fff",
                        }}
                      >
                        事件流
                      </button>
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
            <strong>事件流：</strong>
            <code style={{ fontSize: "0.8rem", color: "#444" }}>{selected}</code>
            {events && events.length > 0 && (
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
