/**
 * matchReplay.ts — 把 MatchEvent 流重建成"逐帧牌桌视图"（PublicMatchView）。
 *
 * 设计动机（roadmap-next.md P0-4 可复现回放的最后一步）：
 *  - 引擎已提供 buildReplayInitialState / replayFromEvents 原语（逐事件重建
 *    InternalMatchState）。这一层把每一帧 state 投影成对外安全的 PublicMatchView，
 *    让回放从"事件列表"升级为"逐帧牌桌状态"——调试 / 验 bug / 赛事仲裁都能
 *    看到每一步之后的真实盘面。
 *  - 纯函数：内容（ruleset / laneDefinitions / engineConfig）与玩家名全部显式传入，
 *    可脱离 DB 与网络单测（与 matchMetrics.ts 同构）。
 *
 * 可复现前提：
 *  - initialSeed 由 hashStringToSeed(matchId) 派生，与 GameRoom.onCreate 在
 *    "客户端不传自定义 seed" 时的取值完全一致（当前 lobby 即如此）。
 *  - ruleset / laneDefinitions / engineConfig 必须与 live 对局同源（由 content.ts
 *    统一提供），否则 seeded RNG 起点会偏。
 *  - 若将来引入自定义 seed，需要把 initialSeed 落库并在此处读取，而非重算。
 */

import {
  hashStringToSeed,
  buildReplayInitialState,
  replayFromEvents,
  toPublicMatchView,
} from "@dev-camcard/engine";
import type { RulesetConfig, EngineConfig } from "@dev-camcard/engine";
import type { MatchEvent, PublicMatchView, Lane, PlayerSide } from "@dev-camcard/protocol";

/** 与 DB 行 / 内存事件兼容的输入形（ts 允许 bigint/string）。 */
export interface ReplayEventLike {
  seq: number;
  type: string;
  ts: number | bigint | string;
  side?: number | null;
  data?: unknown;
}

/** 回放所需的内容（与 live 对局同源，由 content.ts 提供）。 */
export interface ReplayContent {
  ruleset: RulesetConfig;
  laneDefinitions: Array<{ lane: Lane; cardIds: string[] }>;
  engineConfig: EngineConfig;
}

/** 单帧回放：应用该事件之后的牌桌视图 + 元信息。 */
export interface ReplayFrame {
  /** 0-based 帧序（= 事件下标） */
  index: number;
  seq: number;
  ts: number;
  type: string;
  side: number | null;
  /** 该帧 reduce 出错时的人类可读信息（不中断回放） */
  error?: string;
  /** 应用该事件之后的公开牌桌视图 */
  view: PublicMatchView;
}

export interface ReplayFramesResult {
  matchId: string;
  initialSeed: number;
  playerNames: [string, string];
  /** 起点帧（未应用任何事件）的牌桌视图。 */
  initialView: PublicMatchView;
  frameCount: number;
  /** 出错事件清单（与某些 frame.error 对应）。 */
  errors: Array<{ seq: number; type: string; message: string }>;
  frames: ReplayFrame[];
}

function toNumberTs(ts: number | bigint | string): number {
  if (typeof ts === "number") return ts;
  return Number(ts);
}

function normalizeSide(side: number | null | undefined): PlayerSide | undefined {
  return side === 0 || side === 1 ? (side as PlayerSide) : undefined;
}

/**
 * 把输入事件标准化为引擎可消费的 MatchEvent，并按 seq 升序排序。
 */
function normalizeEvents(events: ReplayEventLike[]): MatchEvent[] {
  return events
    .map((e) => ({
      seq: e.seq,
      ts: toNumberTs(e.ts),
      type: e.type,
      side: normalizeSide(e.side),
      data: (e.data ?? undefined) as Record<string, unknown> | undefined,
    }))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * buildReplayFrames — 从事件流重建逐帧 PublicMatchView。
 *
 * @param matchId      对局 ID（= roomId，用于派生 initialSeed 与 instanceId 前缀）
 * @param events       事件流（DB 行或内存日志，顺序无关，内部按 seq 排序）
 * @param playerNames  两位玩家显示名（来自 MatchPlayer；缺失时调用方兜底）
 * @param content      与 live 同源的 ruleset / laneDefinitions / engineConfig
 */
export function buildReplayFrames(
  matchId: string,
  events: ReplayEventLike[],
  playerNames: [string, string],
  content: ReplayContent
): ReplayFramesResult {
  const initialSeed = hashStringToSeed(matchId);

  const initialState = buildReplayInitialState({
    roomId: matchId,
    ruleset: content.ruleset,
    playerNames,
    initialSeed,
    laneDefinitions: content.laneDefinitions,
  });

  const normalized = normalizeEvents(events);
  const result = replayFromEvents(initialState, normalized, content.engineConfig);

  const frames: ReplayFrame[] = result.steps.map((step, index) => ({
    index,
    seq: step.event.seq,
    ts: step.event.ts,
    type: step.event.type,
    side: step.event.side ?? null,
    error: step.error,
    view: toPublicMatchView(step.state),
  }));

  return {
    matchId,
    initialSeed,
    playerNames,
    initialView: toPublicMatchView(initialState),
    frameCount: frames.length,
    errors: result.errors,
    frames,
  };
}
