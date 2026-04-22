"use client";

import { useCallback, useEffect, useState } from "react";

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

export default function MatchesDashboard({ apiBase }: DashboardProps) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<MatchEventRow[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setErr(null);
    try {
      const res = await fetch(`${apiBase}/api/matches`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as MatchRow[];
      setMatches(data);
      setStatus("ok");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEvents = useCallback(
    async (matchId: string) => {
      setSelected(matchId);
      setEvents(null);
      setEventsLoading(true);
      try {
        const res = await fetch(`${apiBase}/api/matches/${matchId}/events`, {
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
    },
    [apiBase]
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <h2 style={{ fontSize: "1.2rem", margin: 0 }}>最近对局</h2>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: "0.25rem 0.75rem",
            background: "#222",
            color: "#eee",
            border: "1px solid #444",
            cursor: "pointer",
          }}
        >
          刷新
        </button>
        {status === "loading" && <span style={{ color: "#888" }}>加载中...</span>}
        {status === "error" && (
          <span style={{ color: "#c00" }}>
            拉取失败：{err}（请确认 server 已启动且 NEXT_PUBLIC_API_BASE 可达）
          </span>
        )}
      </div>

      {status === "ok" && matches.length === 0 && (
        <p style={{ color: "#777" }}>
          还没有对局记录。先去游戏前端打一把，这里就会看到数据。
        </p>
      )}

      {matches.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={cellHead}>Match ID</th>
              <th style={cellHead}>玩家</th>
              <th style={cellHead}>开始</th>
              <th style={cellHead}>结束</th>
              <th style={cellHead}>胜方</th>
              <th style={cellHead}>操作</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={cell}>
                  <code style={{ fontSize: "0.8rem" }}>{m.id}</code>
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
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <section
          style={{
            border: "1px solid #eee",
            padding: "1rem",
            background: "#fafafa",
            maxHeight: 420,
            overflow: "auto",
          }}
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.5rem",
            }}
          >
            <strong>事件流：{selected}</strong>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setEvents(null);
              }}
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
            >
              关闭 ✕
            </button>
          </header>
          {eventsLoading && <p style={{ color: "#888" }}>加载事件中...</p>}
          {!eventsLoading && events && events.length === 0 && (
            <p style={{ color: "#888" }}>无事件。</p>
          )}
          {!eventsLoading && events && events.length > 0 && (
            <ol style={{ paddingLeft: "1.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
              {events.map((e) => (
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

const cellHead: React.CSSProperties = {
  padding: "0.5rem",
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "1px solid #ddd",
};

const cell: React.CSSProperties = {
  padding: "0.5rem",
  verticalAlign: "top",
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
