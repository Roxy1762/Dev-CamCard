/**
 * matchHistory.ts — 大厅「我的战绩」面板（P3-2 对战记录与账号关联）。
 *
 * 数据来源：
 *  - GET /api/users/:id/matches   账号信息 + 战绩聚合 + 对局列表
 *  - GET /api/matches/:id/replay  单局逐帧回放（复用 P0-4 服务端投影，
 *    不把引擎打进客户端 bundle）
 *
 * 结构：
 *  - 纯格式化函数（formatResult / formatDuration / buildStatsChips /
 *    summarizeFrame）与 DOM 解耦，可在 node 环境单测。
 *  - initMatchHistory 负责 DOM 接线；所有用户可控文本（昵称等）一律走
 *    textContent，杜绝注入。
 */

import type { PublicMatchView } from "@dev-camcard/protocol";

// ── 服务端响应形（与 apps/server/src/users.ts 对齐的最小子集）────────────────

export type UserMatchResult = "win" | "loss" | "draw" | "ongoing";

export interface UserMatchEntry {
  matchId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
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
  winRate: number | null;
  avgDurationMs: number | null;
}

export interface UserMatchesSummary {
  user: { id: string; displayName: string; createdAt: string };
  stats: UserMatchStats;
  matches: UserMatchEntry[];
}

interface ReplayFrameLike {
  index: number;
  seq: number;
  type: string;
  side: number | null;
  error?: string;
  view: PublicMatchView;
}

export interface ReplayFramesLike {
  matchId: string;
  playerNames: [string, string];
  initialView: PublicMatchView;
  frameCount: number;
  frames: ReplayFrameLike[];
}

// ── 纯格式化 ──────────────────────────────────────────────────────────────────

export function formatResult(result: UserMatchResult): { label: string; cls: string } {
  switch (result) {
    case "win":
      return { label: "胜", cls: "result-win" };
    case "loss":
      return { label: "负", cls: "result-loss" };
    case "draw":
      return { label: "平", cls: "result-draw" };
    default:
      return { label: "进行中", cls: "result-ongoing" };
  }
}

/** 毫秒 → "x分y秒"（不足 1 分钟只显示秒）。 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
}

/** 战绩聚合 → 顶部统计 chip 文案列表。 */
export function buildStatsChips(stats: UserMatchStats): string[] {
  const chips = [
    `${stats.total} 场`,
    `${stats.wins} 胜 ${stats.losses} 负${stats.draws > 0 ? ` ${stats.draws} 平` : ""}`,
  ];
  if (stats.winRate !== null) chips.push(`胜率 ${Math.round(stats.winRate * 100)}%`);
  if (stats.avgDurationMs !== null) chips.push(`场均 ${formatDuration(stats.avgDurationMs)}`);
  if (stats.ongoing > 0) chips.push(`${stats.ongoing} 场进行中`);
  return chips;
}

/** "2026-06-09T10:00:00.000Z" → 本地可读时间（列表行用）。 */
export function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface FrameSummary {
  /** 帧头："起点" 或 "[P1] PLAY_CARD" */
  title: string;
  /** 每位玩家一行的盘面摘要 */
  playerLines: string[];
  /** 回合与状态行 */
  statusLine: string;
}

/** 把一帧 PublicMatchView 压缩成大厅回放的文本摘要（不渲染整张牌桌）。 */
export function summarizeFrame(
  view: PublicMatchView,
  meta: { type: string; side: number | null } | null
): FrameSummary {
  const title = meta
    ? `${meta.side === 0 || meta.side === 1 ? `[P${meta.side + 1}] ` : ""}${meta.type}`
    : "起点（开局盘面）";

  const playerLines = view.players.map((p) => {
    const venues =
      p.venues.length > 0
        ? `场馆×${p.venues.length}(${p.venues.map((v) => `${v.durability}/${v.maxDurability}`).join(",")})`
        : "无场馆";
    const scheduled = p.scheduleSlots.filter((s) => s !== null).length;
    return (
      `P${p.side + 1} ${p.name} · HP ${p.hp} · 防 ${p.block} · 资 ${p.resourcePool} · 攻 ${p.attackPool}` +
      ` · 牌库 ${p.deckSize}/手 ${p.handSize}/弃 ${p.discardSize} · ${venues} · 日程 ${scheduled}` +
      `${p.reservedCard ? " · 有预约" : ""}`
    );
  });

  const statusLine = view.ended
    ? `回合 ${view.turnNumber} · 对局结束${view.winner !== null ? `（P${view.winner + 1} 获胜）` : "（平局）"}`
    : `回合 ${view.turnNumber} · 轮到 P${view.activePlayer + 1}`;

  return { title, playerLines, statusLine };
}

// ── DOM 控制器 ────────────────────────────────────────────────────────────────

type FetchJson = (url: string) => Promise<unknown>;

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败（HTTP ${res.status}）`);
  }
  return res.json();
}

interface HistoryDom {
  refreshBtn: HTMLButtonElement;
  status: HTMLElement;
  stats: HTMLElement;
  list: HTMLElement;
  replayModal: HTMLElement;
  replayTitle: HTMLElement;
  replayFrame: HTMLElement;
  replayProgress: HTMLElement;
  replayFirst: HTMLButtonElement;
  replayPrev: HTMLButtonElement;
  replayNext: HTMLButtonElement;
  replayLast: HTMLButtonElement;
  replayClose: HTMLButtonElement;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[matchHistory] 缺少 DOM 元素 #${id}`);
  return el as T;
}

function readHistoryDom(): HistoryDom {
  return {
    refreshBtn: $<HTMLButtonElement>("history-refresh"),
    status: $<HTMLElement>("history-status"),
    stats: $<HTMLElement>("history-stats"),
    list: $<HTMLElement>("history-list"),
    replayModal: $<HTMLElement>("lobby-replay-modal"),
    replayTitle: $<HTMLElement>("lobby-replay-title"),
    replayFrame: $<HTMLElement>("lobby-replay-frame"),
    replayProgress: $<HTMLElement>("lobby-replay-progress"),
    replayFirst: $<HTMLButtonElement>("lobby-replay-first"),
    replayPrev: $<HTMLButtonElement>("lobby-replay-prev"),
    replayNext: $<HTMLButtonElement>("lobby-replay-next"),
    replayLast: $<HTMLButtonElement>("lobby-replay-last"),
    replayClose: $<HTMLButtonElement>("lobby-replay-close"),
  };
}

export interface MatchHistoryOptions {
  /** 当前持久玩家 ID（playerIdentity.getOrCreateUserId）。 */
  userId: string;
  /** 注入 fetch 便于测试；缺省走同域 /api。 */
  fetchJson?: FetchJson;
}

/**
 * initMatchHistory — 把「我的战绩」面板接到大厅 DOM。
 * 点击「查询战绩」按需拉取（首屏不打 API），列表行内「回放」打开逐帧浏览模态。
 */
export function initMatchHistory(opts: MatchHistoryOptions): void {
  const dom = readHistoryDom();
  const fetchJson = opts.fetchJson ?? defaultFetchJson;

  // ── 回放模态状态 ────────────────────────────────────────────────────────────
  let replay: ReplayFramesLike | null = null;
  /** -1 = 起点帧（未应用任何事件） */
  let cursor = -1;

  const renderFrame = (): void => {
    if (!replay) return;
    const meta = cursor >= 0 ? replay.frames[cursor] : null;
    const view = meta ? meta.view : replay.initialView;
    const summary = summarizeFrame(view, meta ? { type: meta.type, side: meta.side } : null);

    dom.replayFrame.replaceChildren();
    const titleEl = document.createElement("div");
    titleEl.className = "frame-title";
    titleEl.textContent = summary.title;
    dom.replayFrame.appendChild(titleEl);
    for (const line of summary.playerLines) {
      const lineEl = document.createElement("div");
      lineEl.className = "frame-player";
      lineEl.textContent = line;
      dom.replayFrame.appendChild(lineEl);
    }
    const statusEl = document.createElement("div");
    statusEl.className = "frame-status";
    statusEl.textContent = summary.statusLine;
    dom.replayFrame.appendChild(statusEl);
    if (meta?.error) {
      const errEl = document.createElement("div");
      errEl.className = "frame-error";
      errEl.textContent = `⚠ 本帧重建出错：${meta.error}`;
      dom.replayFrame.appendChild(errEl);
    }

    dom.replayProgress.textContent = `第 ${cursor + 1} / ${replay.frameCount} 步`;
    dom.replayFirst.disabled = cursor < 0;
    dom.replayPrev.disabled = cursor < 0;
    dom.replayNext.disabled = cursor >= replay.frameCount - 1;
    dom.replayLast.disabled = cursor >= replay.frameCount - 1;
  };

  const openReplay = async (entry: UserMatchEntry): Promise<void> => {
    dom.replayTitle.textContent = `回放 · ${entry.myName} vs ${entry.opponentName}`;
    dom.replayFrame.replaceChildren();
    dom.replayProgress.textContent = "加载中...";
    dom.replayModal.classList.remove("hidden");
    try {
      replay = (await fetchJson(`/api/matches/${encodeURIComponent(entry.matchId)}/replay`)) as ReplayFramesLike;
      cursor = -1;
      renderFrame();
    } catch (err) {
      dom.replayProgress.textContent = `回放加载失败：${err instanceof Error ? err.message : String(err)}`;
    }
  };

  dom.replayFirst.addEventListener("click", () => { cursor = -1; renderFrame(); });
  dom.replayPrev.addEventListener("click", () => { cursor = Math.max(-1, cursor - 1); renderFrame(); });
  dom.replayNext.addEventListener("click", () => {
    if (replay) cursor = Math.min(replay.frameCount - 1, cursor + 1);
    renderFrame();
  });
  dom.replayLast.addEventListener("click", () => {
    if (replay) cursor = replay.frameCount - 1;
    renderFrame();
  });
  dom.replayClose.addEventListener("click", () => {
    dom.replayModal.classList.add("hidden");
    replay = null;
  });

  // ── 战绩列表 ────────────────────────────────────────────────────────────────
  const renderSummary = (summary: UserMatchesSummary): void => {
    dom.stats.replaceChildren();
    for (const chip of buildStatsChips(summary.stats)) {
      const el = document.createElement("span");
      el.className = "stat-chip";
      el.textContent = chip;
      dom.stats.appendChild(el);
    }

    dom.list.replaceChildren();
    if (summary.matches.length === 0) {
      dom.status.textContent = "还没有对局记录——去打一场吧！";
      return;
    }
    dom.status.textContent = "";

    for (const entry of summary.matches) {
      const row = document.createElement("div");
      row.className = "history-row";

      const badge = document.createElement("span");
      const { label, cls } = formatResult(entry.result);
      badge.className = `result-badge ${cls}`;
      badge.textContent = label;

      const info = document.createElement("span");
      info.className = "history-info";
      info.textContent = `${formatStartedAt(entry.startedAt)} · vs ${entry.opponentName} · ${formatDuration(entry.durationMs)}`;

      const replayBtn = document.createElement("button");
      replayBtn.type = "button";
      replayBtn.className = "history-replay-btn";
      replayBtn.textContent = "回放";
      replayBtn.addEventListener("click", () => void openReplay(entry));

      row.append(badge, info, replayBtn);
      dom.list.appendChild(row);
    }
  };

  const refresh = async (): Promise<void> => {
    dom.refreshBtn.disabled = true;
    dom.status.textContent = "查询中...";
    try {
      const summary = (await fetchJson(
        `/api/users/${encodeURIComponent(opts.userId)}/matches`
      )) as UserMatchesSummary;
      renderSummary(summary);
    } catch (err) {
      // 账号还没打过任何对局时服务端返回 404 —— 按"暂无战绩"处理而非报错。
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("账号不存在") || msg.includes("404")) {
        dom.stats.replaceChildren();
        dom.list.replaceChildren();
        dom.status.textContent = "还没有对局记录——打完第一场即可在这里看到战绩。";
      } else {
        dom.status.textContent = `查询失败：${msg}`;
      }
    } finally {
      dom.refreshBtn.disabled = false;
    }
  };

  dom.refreshBtn.addEventListener("click", () => void refresh());
}
