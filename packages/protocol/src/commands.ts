import type { PlayerSide } from "./enums";

/**
 * 客户端命令类型常量
 * 客户端只发送命令，不发送结算结果（non-negotiables.md）。
 */
export const CMD = {
  READY: "READY",
  PLAY_CARD: "PLAY_CARD",
  PUT_CARD_TO_SCHEDULE: "PUT_CARD_TO_SCHEDULE",
  ACTIVATE_VENUE: "ACTIVATE_VENUE",
  RESERVE_MARKET_CARD: "RESERVE_MARKET_CARD",
  BUY_MARKET_CARD: "BUY_MARKET_CARD",
  BUY_RESERVED_CARD: "BUY_RESERVED_CARD",
  BUY_FIXED_SUPPLY: "BUY_FIXED_SUPPLY",
  ASSIGN_ATTACK: "ASSIGN_ATTACK",
  END_TURN: "END_TURN",
  CONCEDE: "CONCEDE",
} as const;

export type CmdKey = (typeof CMD)[keyof typeof CMD];

// ── Command payload shapes ─────────────────────────────────────────────────────

export interface AttackAssignment {
  /** 攻击量 */
  amount: number;
  /** 攻击目标类型 */
  target: "player" | "venue";
  /** 目标方席位 */
  targetSide: PlayerSide;
  /** 攻击场馆时提供 instanceId */
  venueInstanceId?: string;
}

export interface ReadyCmd {
  type: typeof CMD.READY;
  playerName?: string;
}

export interface PlayCardCmd {
  type: typeof CMD.PLAY_CARD;
  instanceId: string;
}

export interface PutCardToScheduleCmd {
  type: typeof CMD.PUT_CARD_TO_SCHEDULE;
  instanceId: string;
  slotIndex: number;
}

export interface ActivateVenueCmd {
  type: typeof CMD.ACTIVATE_VENUE;
  instanceId: string;
}

export interface ReserveMarketCardCmd {
  type: typeof CMD.RESERVE_MARKET_CARD;
  instanceId: string;
}

export interface BuyMarketCardCmd {
  type: typeof CMD.BUY_MARKET_CARD;
  instanceId: string;
}

export interface BuyReservedCardCmd {
  type: typeof CMD.BUY_RESERVED_CARD;
}

export interface BuyFixedSupplyCmd {
  type: typeof CMD.BUY_FIXED_SUPPLY;
  cardId: string;
}

export interface AssignAttackCmd {
  type: typeof CMD.ASSIGN_ATTACK;
  assignments: AttackAssignment[];
}

export interface EndTurnCmd {
  type: typeof CMD.END_TURN;
}

export interface ConcedeCmd {
  type: typeof CMD.CONCEDE;
}

/** 所有客户端命令的 discriminated union */
export type ClientCommand =
  | ReadyCmd
  | PlayCardCmd
  | PutCardToScheduleCmd
  | ActivateVenueCmd
  | ReserveMarketCardCmd
  | BuyMarketCardCmd
  | BuyReservedCardCmd
  | BuyFixedSupplyCmd
  | AssignAttackCmd
  | EndTurnCmd
  | ConcedeCmd;
