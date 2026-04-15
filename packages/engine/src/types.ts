import type { PlayerSide, Lane } from "@dev-camcard/protocol";

/**
 * 卡牌运行时实例 — 区分同一 cardId 的多张复印
 */
export interface CardInstance {
  /** 运行时唯一 ID（UUID）*/
  instanceId: string;
  /** 卡牌定义 ID，对应 card-catalog.md */
  cardId: string;
}

/**
 * 场馆运行时状态
 */
export interface VenueState {
  instanceId: string;
  cardId: string;
  owner: PlayerSide;
  isGuard: boolean;
  /** 当前剩余耐久（受到攻击时减少；回合结束未被摧毁时重置为 maxDurability） */
  durability: number;
  /** 最大耐久值（打出时从 CardDef 读取，不变） */
  maxDurability: number;
  /** 本回合剩余可启动次数（进场当回合为 0） */
  activationsLeft: number;
  /** 每回合最多启动次数 */
  activationsPerTurn: number;
}

/**
 * 单个玩家的完整内部状态
 *
 * 牌区说明：
 *  deck    — 牌堆（面朝下，顺序为顶→底）
 *  hand    — 手牌（当前可用）
 *  discard — 弃牌堆（面朝上）
 *  played  — 本回合已打出的行动牌（回合结束时移入弃牌堆）
 */
export interface InternalPlayerState {
  side: PlayerSide;
  name: string;
  hp: number;
  block: number;
  resourcePool: number;
  attackPool: number;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  /** 本回合已打出的行动牌，回合结束时弃置 */
  played: CardInstance[];
  venues: VenueState[];
  /** 日程槽（最多 2，null = 空） */
  scheduleSlots: (CardInstance | null)[];
  /** 预约位（最多 1） */
  reservedCard: CardInstance | null;
  /** 记录预约发生时的回合数（用于阻止同回合购买） */
  reservedCardTurn: number | null;
  /** 本回合是否已执行过预约（每回合只能预约 1 次） */
  hasReservedThisTurn: boolean;
  /** 活动标志位（用于 setFlag 效果，如 nextBoughtCardToDeckTop） */
  activeFlags: string[];
  /**
   * 延迟弃牌计数：下回合开始时必须弃置的手牌数量。
   * 由 queueDelayedDiscard 效果积累，在 beginTurn 中结算后归零。
   */
  pendingDiscardCount: number;
}

/**
 * 单个商店栏的内部状态
 */
export interface MarketLaneState {
  lane: Lane;
  /** 当前公开的槽位（最多 marketSlotsPerLane 张） */
  slots: (CardInstance | null)[];
  /** 该栏剩余的隐藏牌堆，买走后从此补位；deck[0] 为栈顶 */
  deck: CardInstance[];
}

/**
 * 内部对局状态 — 仅服务端持有，禁止直接发送给客户端。
 *
 * 服务端通过 toPublicMatchView / toPrivatePlayerView 投影后再发送。
 * 参考 docs/technical-decisions.md：状态分层约定。
 */
export interface InternalMatchState {
  roomId: string;
  rulesetId: string;
  turnNumber: number;
  activePlayer: PlayerSide;
  players: [InternalPlayerState, InternalPlayerState];
  market: MarketLaneState[];
  /** 固定补给牌堆 cardId 列表（无限数量） */
  fixedSupplies: string[];
  /** 每位玩家是否已发送 READY 命令 */
  readyPlayers: [boolean, boolean];
  started: boolean;
  ended: boolean;
  winner: PlayerSide | null;
}
