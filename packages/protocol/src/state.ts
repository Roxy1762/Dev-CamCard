import type { PlayerSide } from "./enums";

/**
 * InternalMatchState — 最小可扩展骨架。
 *
 * 仅服务端持有，禁止直接同步给客户端（technical-decisions.md）。
 * 后续任务 3 将在 packages/engine 中扩展此接口的完整字段。
 */
export interface InternalMatchState {
  roomId: string;
  rulesetId: string;
  turnNumber: number;
  activePlayer: PlayerSide;
  /** 比赛是否已开始（双方 READY 后） */
  started: boolean;
  ended: boolean;
  winner: PlayerSide | null;
  // TODO (任务 3)：添加完整牌堆 / 手牌 / 商店 / 日程槽 / 预约位字段
}
