/**
 * BoardViewModel.ts
 *
 * 牌桌视图模型（ViewModel）层。
 *
 * 目的：
 *  - 将 PublicMatchView + PrivatePlayerView 合并为渲染层所需的统一视图结构
 *  - 在此处集中推导衍生状态（isMyTurn / mySide / oppSide 等）
 *  - 支持本地化卡牌名称注入（cardNames）
 *  - RoomScene 消费 BoardViewModel，而非直接散乱读取原始视图
 *
 * 设计原则：
 *  - 纯函数：buildBoardViewModel 无副作用，可单独测试
 *  - 不依赖 Phaser，可在 Node.js / Vitest 环境中运行
 *  - 本地化名称通过 Map<cardId, localizedName> 注入，缺失时降级为 cardId
 *
 * 使用方式（RoomScene）：
 *   const vm = buildBoardViewModel(this.view, this.privateView, this.cardNames);
 *   // 用 vm.isMyTurn / vm.me.hp / vm.hand 等替代直接读取 view.*
 */

import type {
  PublicMatchView,
  PrivatePlayerView,
  PublicCardRef,
  PublicVenueView,
  MarketLane,
  PendingChoiceView,
  PublicPlayerSummary,
} from "@dev-camcard/protocol";

// ── 子视图类型 ─────────────────────────────────────────────────────────────────

/** 单名玩家的牌桌视图（我方或对方） */
export interface PlayerViewModel {
  side: 0 | 1;
  name: string;
  hp: number;
  block: number;
  deckSize: number;
  handSize: number;
  discardSize: number;
  resourcePool: number;
  attackPool: number;
  venues: PublicVenueView[];
  scheduleSlots: (PublicCardRef | null)[];
  reservedCard: PublicCardRef | null;
  hasReservedThisTurn: boolean;
  pendingDiscardCount: number;
  /** 是否是当前行动方 */
  isActive: boolean;
}

/** 牌桌完整视图模型 */
export interface BoardViewModel {
  // ── 对局元信息 ──────────────────────────────────────────────────
  roomId: string;
  turnNumber: number;
  started: boolean;
  ended: boolean;
  winner: 0 | 1 | null;

  // ── 视角信息（由 PrivatePlayerView.side 推导） ──────────────────
  mySide: 0 | 1;
  oppSide: 0 | 1;
  /** 是否是我方回合（started && !ended && activePlayer === mySide） */
  isMyTurn: boolean;

  // ── 玩家视图 ────────────────────────────────────────────────────
  me: PlayerViewModel;
  opp: PlayerViewModel;

  // ── 私有区域（仅我方可见） ──────────────────────────────────────
  hand: PublicCardRef[];
  discard: PublicCardRef[];
  pendingChoice: PendingChoiceView | null;

  // ── 公开区域 ────────────────────────────────────────────────────
  pendingChoiceSide: 0 | 1 | null;
  market: MarketLane[];
  fixedSupplies: string[];

  // ── 本地化辅助 ──────────────────────────────────────────────────
  /**
   * 获取卡牌展示名称。
   * 若 cardNames 注入了对应 locale 文本，返回本地化名称；
   * 否则降级返回 cardId（安全，不抛错）。
   */
  getCardName(cardId: string): string;

  // ── 卡牌可操作性查询 ────────────────────────────────────────────
  /**
   * 该 cardId 是否为状态/压力等不可主动打出的牌。
   * 用于让 UI 把这类牌渲染成灰色不可点击块，避免玩家盲点击触发服务端拒绝错误。
   * 当前根据 cardId 前缀 "status_" 识别 —— 与引擎 createPressure 写入的
   * `cardId: "status_pressure"`、以及 data/cards/rules/status.json 的命名约定一致。
   */
  isStatusCard(cardId: string): boolean;
  /** 等价于 isStatusCard，专门标记压力牌（保留独立 API 以便将来细分）。 */
  isPressureCard(cardId: string): boolean;
}

// ── 构建函数 ───────────────────────────────────────────────────────────────────

function buildPlayerViewModel(
  summary: PublicPlayerSummary,
  activePlayer: 0 | 1
): PlayerViewModel {
  return {
    side: summary.side as 0 | 1,
    name: summary.name,
    hp: summary.hp,
    block: summary.block,
    deckSize: summary.deckSize,
    handSize: summary.handSize,
    discardSize: summary.discardSize,
    resourcePool: summary.resourcePool,
    attackPool: summary.attackPool,
    venues: summary.venues,
    scheduleSlots: summary.scheduleSlots,
    reservedCard: summary.reservedCard,
    hasReservedThisTurn: summary.hasReservedThisTurn,
    pendingDiscardCount: summary.pendingDiscardCount,
    isActive: summary.side === activePlayer,
  };
}

/**
 * buildBoardViewModel — 将原始视图合并为渲染层所需的统一视图模型。
 *
 * @param pub        来自 server 的公开视图（双方均可见）
 * @param priv       来自 server 的私有视图（仅己方可见）
 * @param cardNames  可选：cardId → 本地化名称 的映射（来自 content-loader）
 */
export function buildBoardViewModel(
  pub: PublicMatchView,
  priv: PrivatePlayerView,
  cardNames?: ReadonlyMap<string, string>
): BoardViewModel {
  const mySide = priv.side as 0 | 1;
  const oppSide = (mySide === 0 ? 1 : 0) as 0 | 1;
  const activePlayer = pub.activePlayer as 0 | 1;
  const isMyTurn = pub.started && !pub.ended && activePlayer === mySide;

  return {
    roomId: pub.roomId,
    turnNumber: pub.turnNumber,
    started: pub.started,
    ended: pub.ended,
    winner: pub.winner as 0 | 1 | null,

    mySide,
    oppSide,
    isMyTurn,

    me: buildPlayerViewModel(pub.players[mySide], activePlayer),
    opp: buildPlayerViewModel(pub.players[oppSide], activePlayer),

    hand: priv.hand,
    discard: priv.discard,
    pendingChoice: priv.pendingChoice,

    pendingChoiceSide: pub.pendingChoiceSide as 0 | 1 | null,
    market: pub.market,
    fixedSupplies: pub.fixedSupplies,

    getCardName: (cardId: string) => cardNames?.get(cardId) ?? cardId,
    isStatusCard,
    isPressureCard,
  };
}

// ── 状态卡判定 ────────────────────────────────────────────────────────────────

/**
 * 状态卡命名约定：cardId 以 "status_" 开头。
 * 与引擎 effects.ts 写入压力牌时使用的 "status_pressure" 一致，
 * 也覆盖了 data/cards/rules/status.json 的所有条目。
 */
export function isStatusCard(cardId: string): boolean {
  return cardId.startsWith("status_");
}

/** 当前实现等同于 isStatusCard；后续若拆分状态牌再细化。 */
export function isPressureCard(cardId: string): boolean {
  return cardId === "status_pressure";
}
