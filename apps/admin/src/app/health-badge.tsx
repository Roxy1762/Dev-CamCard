"use client";

import { useCallback, useEffect, useState } from "react";

interface HealthState {
  server: string;
  core: { ok: boolean; status?: number; error?: string };
  db: { ok: boolean; status?: number; error?: string };
  elapsedMs: number;
}

/**
 * 顶部健康指示灯 —— 同时检查 game server /health 与 /health/db。
 * 出现红灯时把错误原文 hover 出来，运维不必再开 terminal 翻日志。
 */
export function HealthBadge() {
  const [state, setState] = useState<HealthState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);

  const probe = useCallback(async () => {
    setPulsing(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HealthState;
      setState(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPulsing(false);
    }
  }, []);

  useEffect(() => {
    void probe();
    const id = setInterval(() => void probe(), 15000);
    return () => clearInterval(id);
  }, [probe]);

  const overallOk = state?.core.ok && state?.db.ok;
  const dotColor = err
    ? "#c00"
    : overallOk
    ? "#22a360"
    : state
    ? "#d4a017"
    : "#888";

  const tooltip = err
    ? `健康检查请求失败：${err}`
    : state
    ? [
        `server: ${state.server}`,
        `core: ${state.core.ok ? "OK" : `FAIL · ${state.core.error ?? "?"}`}`,
        `db: ${state.db.ok ? "OK" : `FAIL · ${state.db.error ?? "?"}`}`,
        `延时: ${state.elapsedMs}ms`,
      ].join("\n")
    : "等待首次探测...";

  return (
    <button
      type="button"
      onClick={() => void probe()}
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "0.25rem 0.6rem",
        cursor: "pointer",
        fontSize: "0.85rem",
        color: "#444",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: pulsing ? `0 0 0 3px ${dotColor}33` : "none",
          transition: "box-shadow 0.2s ease",
        }}
      />
      {err
        ? "服务异常"
        : overallOk
        ? "Server / DB 正常"
        : state
        ? "部分异常"
        : "探测中..."}
    </button>
  );
}
