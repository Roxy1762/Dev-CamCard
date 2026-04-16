import type { Lane, PlayerSide } from "./enums";
import type { AttackAssignment } from "./commands";

/** 目标候选的客户端视图（chooseTarget 专用） */
export type TargetCandidateView =
  | { kind: "player"; side: PlayerSide }
  | { kind: "venue"; instanceId: string; cardId: string; ownerSide: PlayerSide };

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
  /** 下回合开始时需弃置的手牌数（由 queueDelayedDiscard 效果积累） */
  pendingDiscardCount: number;
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
  /**
   * 当前是否有待处理选择（公开部分）。
   * 仅暴露等待方，不暴露选项内容（选项内容在 PrivatePlayerView.pendingChoice）。
   */
  pendingChoiceSide: PlayerSide | null;
}

// ── 待处理选择视图（私有，仅发给对应玩家）────────────────────────────────────

/**
 * PendingChoiceView — 待处理选择的客户端视图（不含引擎内部字段）。
 *
 * 对应关系：
 *  chooseCardsFromHand          → 从 PrivatePlayerView.hand 中选
 *  chooseCardsFromDiscard       → 从 PrivatePlayerView.discard 中选
 *  chooseCardsFromHandOrDiscard → 从 hand 或 discard 中选
 *  scryDecision                 → 从 revealedCards 中选要弃掉的牌
 */
export type PendingChoiceView =
  | {
      type: "chooseCardsFromHand";
      /** 最少选择张数（0 = 可以跳过） */
      minCount: number;
      /** 最多选择张数 */
      maxCount: number;
    }
  | {
      type: "chooseCardsFromDiscard";
      minCount: number;
      maxCount: number;
    }
  | {
      type: "chooseCardsFromHandOrDiscard";
      minCount: number;
      maxCount: number;
    }
  | {
      type: "scryDecision";
      /** 已翻开的牌（可见，玩家从中选择要弃掉的） */
      revealedCards: PublicCardRef[];
      /** 最多可弃几张（MVP = 1） */
      maxDiscard: number;
    }
  | {
      type: "gainFaceUpCardDecision";
      /** 可获取的市场牌候选列表（费用已满足） */
      candidates: PublicCardRef[];
      /** 获取后牌进入的区域 */
      destination: "discard" | "deckTop";
    }
  | {
      type: "chooseTarget";
      targetType: "opponentPlayer" | "opponentVenue" | "selfVenue";
      /** 可供选择的目标列表 */
      candidates: TargetCandidateView[];
    };

/**
 * 私有玩家视图 — 仅发给对应玩家自己。
 * 包含手牌、弃牌堆与待处理选择，不可广播。
 */
export interface PrivatePlayerView {
  side: PlayerSide;
  /** 当前手牌（含 instanceId） */
  hand: PublicCardRef[];
  /**
   * 己方弃牌堆（面朝上，全部可见）。
   * 在 trashFromHandOrDiscard 等需要选弃牌堆的效果时供客户端展示。
   */
  discard: PublicCardRef[];
  /**
   * 当前待处理选择（非 null 时表示需要玩家响应）。
   * 此时除 SUBMIT_CHOICE 外所有操作均被拒绝。
   */
  pendingChoice: PendingChoiceView | null;
}
