import type { Lane, PlayerSide } from "./enums";
import type { AttackAssignment } from "./commands";

// Re-export AttackAssignment so consumers only need to import from views
export type { AttackAssignment };

/**
 * 公开卡牌引用 — 仅暴露 id 与实例标识，不暴露手牌信息。
 */
export interface PublicCardRef {
  /** 卡牌定义 ID（对应 card-catalog.md） */
  id: string;
  /** 运行时实例 ID（UUID，由 engine 生成） */
  instanceId: string;
}

/**
 * 场馆公开视图
 */
export interface PublicVenueView {
  instanceId: string;
  cardId: string;
  owner: PlayerSide;
  isGuard: boolean;
  /** 本回合剩余可启动次数 */
  activationsLeft: number;
}

/**
 * 玩家公开摘要 — 双方均可见
 */
export interface PublicPlayerSummary {
  side: PlayerSide;
  name: string;
  hp: number;
  /** 当前防备值（跨回合） */
  block: number;
  deckSize: number;
  handSize: number;
  discardSize: number;
  /** 本回合剩余资源 */
  resourcePool: number;
  /** 本回合剩余攻击 */
  attackPool: number;
  venues: PublicVenueView[];
  /** 日程槽（最多 2，null = 空） */
  scheduleSlots: (PublicCardRef | null)[];
  /** 预约位（最多 1） */
  reservedCard: PublicCardRef | null;
  /** 本回合是否已执行过预约（每回合只能预约 1 次） */
  hasReservedThisTurn: boolean;
}

/**
 * 单个商店栏公开视图
 */
export interface MarketLane {
  lane: Lane;
  /** 每栏 2 个槽位 */
  slots: (PublicCardRef | null)[];
}

/**
 * 公开对局视图 — 双方均可见。
 * 禁止包含 InternalMatchState 中的私有信息。
 */
export interface PublicMatchView {
  roomId: string;
  turnNumber: number;
  activePlayer: PlayerSide;
  players: [PublicPlayerSummary, PublicPlayerSummary];
  /** 三栏商店 */
  market: MarketLane[];
  /** 固定补给牌堆 ID 列表（无限牌堆，仅展示哪些堆存在） */
  fixedSupplies: string[];
  started: boolean;
  ended: boolean;
  winner: PlayerSide | null;
}

/**
 * 私有玩家视图 — 仅发给对应玩家自己。
 * 包含手牌信息，不可广播。
 */
export interface PrivatePlayerView {
  side: PlayerSide;
  hand: PublicCardRef[];
}
