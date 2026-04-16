/**
 * 服务端公共事件类型常量
 * 服务端权威结算后广播给客户端（non-negotiables.md）。
 */
export const EVT = {
  MATCH_CREATED: "MATCH_CREATED",
  OPENING_HAND_DRAWN: "OPENING_HAND_DRAWN",
  TURN_STARTED: "TURN_STARTED",
  CARD_PLAYED: "CARD_PLAYED",
  CARD_SCHEDULED: "CARD_SCHEDULED",
  SCHEDULE_RESOLVED: "SCHEDULE_RESOLVED",
  VENUE_ENTERED: "VENUE_ENTERED",
  VENUE_ACTIVATED: "VENUE_ACTIVATED",
  MARKET_CARD_RESERVED: "MARKET_CARD_RESERVED",
  CARD_BOUGHT: "CARD_BOUGHT",
  MARKET_REFILLED: "MARKET_REFILLED",
  BLOCK_GRANTED: "BLOCK_GRANTED",
  ATTACK_ASSIGNED: "ATTACK_ASSIGNED",
  VENUE_DESTROYED: "VENUE_DESTROYED",
  PRESSURE_ADDED: "PRESSURE_ADDED",
  TURN_ENDED: "TURN_ENDED",
  MATCH_ENDED: "MATCH_ENDED",
  /** Colyseus 消息 key：服务端推送 PublicMatchView */
  STATE_UPDATE: "state_update",
  /** Colyseus 消息 key：服务端推送 PrivatePlayerView（仅发给对应席位） */
  PRIVATE_UPDATE: "private_update",
  /** 服务端推送 MatchEventLog（重连时 / 客户端请求时） */
  MATCH_EVENTS: "match_events",
} as const;

export type EvtKey = (typeof EVT)[keyof typeof EVT];

// ── 最小事件日志类型 ──────────────────────────────────────────────────────────

import type { PlayerSide } from "./enums";

/**
 * MatchEvent — 对局内的最小事件记录。
 *
 * seq  : 全局递增序号（从 0 开始），用于排序与去重。
 * ts   : 服务端时间戳（Date.now()）。
 * type : 对应 CMD.* 或特殊事件标签（MATCH_START / MATCH_END）。
 * side : 执行方席位（nil = 系统事件）。
 * data : 精简后的 payload（不含完整状态）。
 */
export interface MatchEvent {
  seq: number;
  ts: number;
  type: string;
  side?: PlayerSide;
  data?: Record<string, unknown>;
}

/**
 * MatchSnapshot — 绑定到当前对局的最小快照头信息。
 * 用于回放 / 未来持久化的元数据基础。
 */
export interface MatchSnapshot {
  matchId: string;
  /** 规则集版本标识（来自 data/rulesets/*.json 的文件名） */
  rulesetVersion: string;
  /** 参与本对局的内容集合列表（仅文件名，不含路径） */
  contentSets: string[];
  startedAt: number;
  /**
   * 对局初始 RNG seed（32-bit 无符号）。
   * 同 seed + 同命令流可重建对局关键状态，是回放可复现的基础信号。
   * 历史对局可能缺失此字段（兼容旧日志）。
   */
  initialSeed?: number;
}

/**
 * MatchEventLog — 服务端发给客户端的事件日志包（MATCH_EVENTS 消息体）。
 */
export interface MatchEventLog {
  snapshot: MatchSnapshot;
  events: MatchEvent[];
}
