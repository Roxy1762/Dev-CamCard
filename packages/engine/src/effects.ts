import type { PlayerSide } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "./types";
import { draw, shuffle } from "./deck";

/** 费用查询函数，用于 gainFaceUpCard 候选筛选 */
export type GetCardCost = (cardId: string) => number;

// ── Effect 类型定义 ────────────────────────────────────────────────────────────

/**
 * CardEffect — 卡牌效果的 discriminated union。
 *
 * 分层说明：
 *  【直接效果】   gainResource / gainAttack / gainBlock / heal / draw / drawThenDiscard
 *                setFlag / gainFaceUpCard — 立即应用，无需等待
 *  【双方效果】   createPressure / queueDelayedDiscard — 涉及对手状态，由 applyStateEffects 处理
 *  【选择效果】   trashFromHandOrDiscard / scry(interactive) — 需要玩家响应，产生 PendingChoice
 *  【延迟效果】   queueDelayedDiscard — 记录到 pendingDiscardCount，下回合开始时结算
 */
export type CardEffect =
  | { op: "gainResource"; amount: number }
  | { op: "gainAttack"; amount: number }
  | { op: "gainBlock"; amount: number }
  | { op: "heal"; amount: number }
  | { op: "draw"; count: number }
  | { op: "drawThenDiscard"; count: number }
  /** 给指定目标（默认对手）产生压力牌（status_pressure）到其手牌 */
  | { op: "createPressure"; count: number; target?: "opponent" | "self" }
  /**
   * 预习：查看牌堆顶 N 张。
   *  interactive = false（默认）：随机重洗 N 张（MVP 非交互行为）
   *  interactive = true：等待玩家选择弃掉 0~maxDiscard 张，余下原序放回
   */
  | { op: "scry"; count: number; interactive?: boolean }
  /** 设置玩家标志位（用于条件效果，如 nextBoughtCardToDeckTop） */
  | { op: "setFlag"; flag: string }
  /**
   * 从公开市场获取一张费用 ≤ maxCost 的牌（玩家选择）。
   *  destination = "discard"  → 进入弃牌堆（默认）
   *  destination = "deckTop"  → 放到牌堆顶
   * 若市场无满足条件的牌，效果跳过。
   */
  | { op: "gainFaceUpCard"; maxCost: number; destination?: "discard" | "deckTop" }
  /**
   * 让目标玩家在下回合开始时弃 count 张手牌。
   * 多次叠加累加到 pendingDiscardCount，beginTurn 时统一结算。
   * target 默认为 "opponent"（对手）。
   */
  | { op: "queueDelayedDiscard"; count: number; target?: "opponent" | "self" }
  /**
   * 从手牌或弃牌堆中永久报废（移出游戏）count 张牌，需要玩家选择。
   *  zone = "hand"   ：只能选手牌
   *  zone = "discard"：只能选弃牌堆
   *  zone = "either" （默认）：手牌与弃牌堆均可选
   */
  | { op: "trashFromHandOrDiscard"; count: number; zone?: "hand" | "discard" | "either" }
  /**
   * 选择目标（对手玩家 / 对手场馆 / 己方场馆），然后对选中目标应用 onChosen 效果。
   * 若当前无合法候选（如对手没有场馆），效果跳过。
   */
  | {
      op: "chooseTarget";
      targetType: "opponentPlayer" | "opponentVenue" | "selfVenue";
      onChosen: TargetedEffect[];
    };

// ── 目标选择辅助类型 ──────────────────────────────────────────────────────────

/**
 * TargetedEffect — 应用于选中目标的效果（chooseTarget 专用）。
 *  damageVenue  ：减少场馆耐久（≤0 时摧毁）
 *  dealDamage   ：直接扣玩家 HP（非战斗伤害，不经过防备）
 */
export type TargetedEffect =
  | { op: "damageVenue"; amount: number }
  | { op: "dealDamage"; amount: number };

/**
 * TargetCandidate — 可供玩家选择的目标描述。
 * 在 SUBMIT_CHOICE 中以 instanceId 提交：
 *  - 玩家目标：提交 "player:0" 或 "player:1"
 *  - 场馆目标：提交场馆 instanceId
 */
export type TargetCandidate =
  | { kind: "player"; side: PlayerSide }
  | { kind: "venue"; instanceId: string; cardId: string; ownerSide: PlayerSide };

// ── PendingChoice 类型定义 ────────────────────────────────────────────────────

/**
 * PendingChoice — 当前等待某玩家响应的选择请求。
 *
 * 当一个效果需要玩家做出选择时（trashFromHandOrDiscard / 交互式 scry），
 * 引擎暂停结算，将此对象写入 InternalMatchState.pendingChoice，
 * 等待 SUBMIT_CHOICE 命令恢复结算。
 *
 * 设计约定：
 *  - forSide  ：需要做出选择的玩家（MVP 中恒等于 activeSide）
 *  - activeSide：效果来源方，继续结算 remainingEffects 时使用
 *  - remainingEffects：选择完成后仍需应用的效果列表
 *
 * 未来扩展：
 *  - chooseTarget    ：选择场馆 / 对方 / 己方（预留）
 *  - yesNo           ：是否确认某个可选效果（预留）
 */
export type PendingChoice =
  | {
      type: "chooseCardsFromHand";
      forSide: PlayerSide;
      activeSide: PlayerSide;
      minCount: number;
      maxCount: number;
      remainingEffects: CardEffect[];
    }
  | {
      type: "chooseCardsFromDiscard";
      forSide: PlayerSide;
      activeSide: PlayerSide;
      minCount: number;
      maxCount: number;
      remainingEffects: CardEffect[];
    }
  | {
      type: "chooseCardsFromHandOrDiscard";
      forSide: PlayerSide;
      activeSide: PlayerSide;
      minCount: number;
      maxCount: number;
      remainingEffects: CardEffect[];
    }
  | {
      type: "scryDecision";
      forSide: PlayerSide;
      activeSide: PlayerSide;
      /** 被翻开的牌（来自牌堆顶，顺序为原牌堆顶→下） */
      revealedCards: CardInstance[];
      /** 翻开牌之下的牌堆（原序保留，不参与选择） */
      deckBelow: CardInstance[];
      /** 本次最多可弃掉几张（当前 MVP = 1） */
      maxDiscard: number;
      remainingEffects: CardEffect[];
    }
  | {
      type: "gainFaceUpCardDecision";
      forSide: PlayerSide;
      activeSide: PlayerSide;
      /** 市场中满足费用上限的候选牌（玩家选 1 张，或 0 张跳过） */
      candidates: CardInstance[];
      /** 获取后牌进入的区域 */
      destination: "discard" | "deckTop";
      remainingEffects: CardEffect[];
    }
  | {
      type: "chooseTarget";
      forSide: PlayerSide;
      activeSide: PlayerSide;
      targetType: "opponentPlayer" | "opponentVenue" | "selfVenue";
      /** 当前可选的目标列表 */
      candidates: TargetCandidate[];
      /** 选中目标后对其应用的效果 */
      onChosen: TargetedEffect[];
      remainingEffects: CardEffect[];
    };

// ── Condition 类型定义 ────────────────────────────────────────────────────────

/**
 * CardCondition — 技能触发条件，条件不满足时整个技能跳过。
 */
export type CardCondition =
  /** 本回合第一张行动牌 (played 中只有刚打的这张) */
  | { type: "firstActionThisTurn" }
  /** 本回合已打出至少 N 张行动牌（含当前） */
  | { type: "actionsPlayedAtLeast"; count: number }
  /** 己方至少有 1 座场馆 */
  | { type: "hasVenue" }
  /** 任意日程槽有牌 */
  | { type: "hasScheduledCard" }
  /** 预约位有牌 */
  | { type: "hasReservedCard" };

export interface CardAbility {
  /**
   * 触发时机：
   *  - onPlay           打出时
   *  - onScheduleResolve 安排牌在下回合开始结算时
   *  - onActivate       场馆启动时
   */
  trigger: "onPlay" | "onScheduleResolve" | "onActivate";
  effects: CardEffect[];
  /** 可选条件：条件不满足时整个技能跳过 */
  condition?: CardCondition;
}

/**
 * CardDef — 卡牌效果定义（从 data/cards/*.json 加载后注入引擎）。
 */
export interface CardDef {
  id: string;
  type: "action" | "venue";
  abilities: CardAbility[];
  isGuard?: boolean;
  durability?: number;
  activationsPerTurn?: number;
  isPressure?: boolean;
}

// ── Condition checker ────────────────────────────────────────────────────────

export function checkCondition(
  player: InternalPlayerState,
  cond: CardCondition
): boolean {
  switch (cond.type) {
    case "firstActionThisTurn":
      return player.played.length === 1;

    case "actionsPlayedAtLeast":
      return player.played.length >= cond.count;

    case "hasVenue":
      return player.venues.length > 0;

    case "hasScheduledCard":
      return player.scheduleSlots.some((s) => s !== null);

    case "hasReservedCard":
      return player.reservedCard !== null;

    default:
      return true;
  }
}

// ── Effect interpreter（单玩家级别）────────────────────────────────────────────

/**
 * applyEffects — 将一组【直接效果】依次应用到单个玩家（纯函数）。
 *
 * 只处理自我效果（gainResource / gainAttack / gainBlock / heal / draw /
 * drawThenDiscard / scry(非交互) / setFlag / gainFaceUpCard）。
 *
 * createPressure / queueDelayedDiscard / trashFromHandOrDiscard / scry(interactive)
 * 涉及双方状态或需要选择，由调用方通过 applyStateEffects 处理。
 */
export function applyEffects(
  player: InternalPlayerState,
  effects: CardEffect[],
  random: () => number = Math.random,
  maxHp = 32
): InternalPlayerState {
  let p = player;
  for (const effect of effects) {
    p = applySingleEffect(p, effect, random, maxHp);
  }
  return p;
}

function applySingleEffect(
  player: InternalPlayerState,
  effect: CardEffect,
  random: () => number,
  maxHp: number
): InternalPlayerState {
  switch (effect.op) {
    case "gainResource":
      return { ...player, resourcePool: player.resourcePool + effect.amount };

    case "gainAttack":
      return { ...player, attackPool: player.attackPool + effect.amount };

    case "gainBlock":
      return { ...player, block: player.block + effect.amount };

    case "heal":
      return { ...player, hp: Math.min(player.hp + effect.amount, maxHp) };

    case "draw":
      return draw(player, effect.count, random);

    case "drawThenDiscard": {
      const afterDraw = draw(player, effect.count, random);
      const discardCount = Math.min(effect.count, afterDraw.hand.length);
      const toDiscard = afterDraw.hand.slice(0, discardCount);
      const remaining = afterDraw.hand.slice(discardCount);
      return {
        ...afterDraw,
        hand: remaining,
        discard: [...afterDraw.discard, ...toDiscard],
      };
    }

    case "scry": {
      // 非交互模式：随机重洗牌堆顶 N 张（MVP 行为）
      if (effect.interactive) return player; // 交互式由 applyStateEffects 处理，单玩家级别跳过
      const count = Math.min(effect.count, player.deck.length);
      if (count === 0) return player;
      const topCards = player.deck.slice(0, count);
      const restDeck = player.deck.slice(count);
      const shuffledTop = shuffle(topCards, random);
      return { ...player, deck: [...shuffledTop, ...restDeck] };
    }

    case "setFlag": {
      if (player.activeFlags.includes(effect.flag)) return player;
      return { ...player, activeFlags: [...player.activeFlags, effect.flag] };
    }

    case "gainFaceUpCard":
      // MVP 占位：gainFaceUpCard 需要明确牌源，暂时为 no-op
      return player;

    case "createPressure":
    case "queueDelayedDiscard":
    case "trashFromHandOrDiscard":
      // 这些效果由 applyStateEffects 处理，单玩家级别跳过
      return player;

    default:
      return player;
  }
}

// ── State-level effect interpreter（支持双方 + 选择效果）─────────────────────

/**
 * applyStateEffects — 将一组效果顺序应用到对局状态（纯函数）。
 *
 * 效果分层处理：
 *  1. 直接效果（gainResource 等）：立即应用到 activeSide 玩家
 *  2. 双方效果（createPressure / queueDelayedDiscard）：立即应用，可影响对方
 *  3. 选择效果（trashFromHandOrDiscard / scry interactive）：
 *     停止当前批次处理，将后续效果存入 PendingChoice，等待 SUBMIT_CHOICE 解决
 *
 * @returns 若遇到选择效果，返回带有 pendingChoice 的状态；否则 pendingChoice 不变
 */
export function applyStateEffects(
  state: InternalMatchState,
  activeSide: PlayerSide,
  effects: CardEffect[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  let s = state;

  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];

    // 遇到选择效果：先应用此前所有效果（已在循环中完成），然后挂起
    if (isChoiceEffect(effect)) {
      const remainingEffects = effects.slice(i + 1);
      return createPendingChoiceForEffect(s, activeSide, effect, remainingEffects, getCardCost);
    }

    s = applySingleStateEffect(s, activeSide, effect, random, maxHp, genId);
  }

  return s;
}

/**
 * resolveChoice — 处理玩家对 pendingChoice 的响应（纯函数）。
 *
 * @param state          当前对局状态（必须有 pendingChoice）
 * @param side           提交选择的玩家席位
 * @param selectedIds    玩家选中的实例 ID 列表
 * @param random         随机数函数
 * @param maxHp          生命值上限
 * @param genId          UUID 生成函数
 */
export function resolveChoice(
  state: InternalMatchState,
  side: PlayerSide,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  const choice = state.pendingChoice;
  if (!choice) throw new Error("当前没有待处理的选择");
  if (choice.forSide !== side) {
    throw new Error(`非选择方（side=${side}）不能提交选择，当前等待 side=${choice.forSide}`);
  }

  switch (choice.type) {
    case "chooseCardsFromHand":
      return resolveTrashChoiceFromHand(state, side, choice, selectedIds, random, maxHp, genId, getCardCost);

    case "chooseCardsFromDiscard":
      return resolveTrashChoiceFromDiscard(state, side, choice, selectedIds, random, maxHp, genId, getCardCost);

    case "chooseCardsFromHandOrDiscard":
      return resolveTrashChoiceFromHandOrDiscard(state, side, choice, selectedIds, random, maxHp, genId, getCardCost);

    case "scryDecision":
      return resolveScryChoice(state, side, choice, selectedIds, random, maxHp, genId, getCardCost);

    case "gainFaceUpCardDecision":
      return resolveGainFaceUpCardChoice(state, side, choice, selectedIds, random, maxHp, genId, getCardCost);

    case "chooseTarget":
      return resolveChooseTargetChoice(state, side, choice, selectedIds, random, maxHp, genId, getCardCost);
  }
}

// ── Choice effect resolution ──────────────────────────────────────────────────

function resolveTrashChoiceFromHand(
  state: InternalMatchState,
  side: PlayerSide,
  choice: Extract<PendingChoice, { type: "chooseCardsFromHand" }>,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  const player = state.players[side];

  // 验证选择数量
  validateCount(selectedIds.length, choice.minCount, choice.maxCount, player.hand.length);

  // 验证所有选中的牌都在手牌中
  for (const id of selectedIds) {
    if (!player.hand.some((c) => c.instanceId === id)) {
      throw new Error(`实例 ${id} 不在手牌中`);
    }
  }

  // 从手牌中移除（报废）
  const selectedSet = new Set(selectedIds);
  const updatedPlayer: InternalPlayerState = {
    ...player,
    hand: player.hand.filter((c) => !selectedSet.has(c.instanceId)),
  };

  let s = mergePlayer(state, side, updatedPlayer);
  s = { ...s, pendingChoice: null };

  // 继续结算剩余效果
  return applyStateEffects(s, choice.activeSide, choice.remainingEffects, random, maxHp, genId, getCardCost);
}

function resolveTrashChoiceFromDiscard(
  state: InternalMatchState,
  side: PlayerSide,
  choice: Extract<PendingChoice, { type: "chooseCardsFromDiscard" }>,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  const player = state.players[side];

  validateCount(selectedIds.length, choice.minCount, choice.maxCount, player.discard.length);

  for (const id of selectedIds) {
    if (!player.discard.some((c) => c.instanceId === id)) {
      throw new Error(`实例 ${id} 不在弃牌堆中`);
    }
  }

  const selectedSet = new Set(selectedIds);
  const updatedPlayer: InternalPlayerState = {
    ...player,
    discard: player.discard.filter((c) => !selectedSet.has(c.instanceId)),
  };

  let s = mergePlayer(state, side, updatedPlayer);
  s = { ...s, pendingChoice: null };

  return applyStateEffects(s, choice.activeSide, choice.remainingEffects, random, maxHp, genId, getCardCost);
}

function resolveTrashChoiceFromHandOrDiscard(
  state: InternalMatchState,
  side: PlayerSide,
  choice: Extract<PendingChoice, { type: "chooseCardsFromHandOrDiscard" }>,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  const player = state.players[side];
  const totalAvailable = player.hand.length + player.discard.length;

  validateCount(selectedIds.length, choice.minCount, choice.maxCount, totalAvailable);

  // 验证所有选中的牌都在手牌或弃牌堆中
  for (const id of selectedIds) {
    const inHand = player.hand.some((c) => c.instanceId === id);
    const inDiscard = player.discard.some((c) => c.instanceId === id);
    if (!inHand && !inDiscard) {
      throw new Error(`实例 ${id} 不在手牌或弃牌堆中`);
    }
  }

  const selectedSet = new Set(selectedIds);
  const updatedPlayer: InternalPlayerState = {
    ...player,
    hand: player.hand.filter((c) => !selectedSet.has(c.instanceId)),
    discard: player.discard.filter((c) => !selectedSet.has(c.instanceId)),
  };

  let s = mergePlayer(state, side, updatedPlayer);
  s = { ...s, pendingChoice: null };

  return applyStateEffects(s, choice.activeSide, choice.remainingEffects, random, maxHp, genId, getCardCost);
}

function resolveScryChoice(
  state: InternalMatchState,
  side: PlayerSide,
  choice: Extract<PendingChoice, { type: "scryDecision" }>,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  // selectedIds = 玩家选择【弃掉】的牌（来自 revealedCards）
  if (selectedIds.length > choice.maxDiscard) {
    throw new Error(
      `最多可弃 ${choice.maxDiscard} 张，实际提交 ${selectedIds.length} 张`
    );
  }

  // 验证所有选中的牌都在 revealedCards 中
  const revealedSet = new Map(
    choice.revealedCards.map((c) => [c.instanceId, c])
  );
  for (const id of selectedIds) {
    if (!revealedSet.has(id)) {
      throw new Error(`实例 ${id} 不在预习牌中`);
    }
  }

  const discardedSet = new Set(selectedIds);

  // 未弃掉的牌按原序放回牌堆顶
  const kept = choice.revealedCards.filter((c) => !discardedSet.has(c.instanceId));
  // 弃掉的牌进入弃牌堆
  const discarded = choice.revealedCards.filter((c) => discardedSet.has(c.instanceId));

  const player = state.players[side];
  const updatedPlayer: InternalPlayerState = {
    ...player,
    deck: [...kept, ...choice.deckBelow],
    discard: [...player.discard, ...discarded],
  };

  let s = mergePlayer(state, side, updatedPlayer);
  s = { ...s, pendingChoice: null };

  return applyStateEffects(s, choice.activeSide, choice.remainingEffects, random, maxHp, genId, getCardCost);
}

// ── gainFaceUpCardDecision 解决 ───────────────────────────────────────────────

function resolveGainFaceUpCardChoice(
  state: InternalMatchState,
  side: PlayerSide,
  choice: Extract<PendingChoice, { type: "gainFaceUpCardDecision" }>,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  // 可以选 0 张（跳过）或恰好 1 张
  if (selectedIds.length > 1) {
    throw new Error(`gainFaceUpCard 最多选 1 张，实际提交 ${selectedIds.length} 张`);
  }

  let s = { ...state, pendingChoice: null } as InternalMatchState;

  if (selectedIds.length === 1) {
    const chosenId = selectedIds[0];

    // 验证所选牌在候选列表中
    if (!choice.candidates.some((c) => c.instanceId === chosenId)) {
      throw new Error(`实例 ${chosenId} 不在可选市场牌中`);
    }

    // 从市场槽中移除并补位
    let gainedCard: CardInstance | null = null;
    const market = s.market.map((lane) => {
      const slotIdx = lane.slots.findIndex((sl) => sl?.instanceId === chosenId);
      if (slotIdx === -1) return lane;

      gainedCard = lane.slots[slotIdx]!;
      const [refill, ...remainingDeck] = lane.deck;
      const newSlots = lane.slots.map((sl, i) =>
        i === slotIdx ? (refill ?? null) : sl
      );
      return { ...lane, slots: newSlots, deck: remainingDeck };
    });

    if (!gainedCard) {
      throw new Error(`市场中未找到实例: ${chosenId}`);
    }

    s = { ...s, market };

    // 加入玩家对应区域
    const player = s.players[side];
    const updatedPlayer: InternalPlayerState =
      choice.destination === "deckTop"
        ? { ...player, deck: [gainedCard, ...player.deck] }
        : { ...player, discard: [...player.discard, gainedCard] };

    s = mergePlayer(s, side, updatedPlayer);
  }

  return applyStateEffects(s, choice.activeSide, choice.remainingEffects, random, maxHp, genId, getCardCost);
}

// ── chooseTarget 解决 ─────────────────────────────────────────────────────────

function resolveChooseTargetChoice(
  state: InternalMatchState,
  side: PlayerSide,
  choice: Extract<PendingChoice, { type: "chooseTarget" }>,
  selectedIds: string[],
  random: () => number,
  maxHp: number,
  genId: () => string,
  getCardCost?: GetCardCost
): InternalMatchState {
  if (selectedIds.length !== 1) {
    throw new Error(`chooseTarget 需要恰好选 1 个目标，实际提交 ${selectedIds.length}`);
  }

  const selectedId = selectedIds[0];

  // 验证目标在候选列表中
  const candidate = choice.candidates.find((c) => {
    if (c.kind === "player") return `player:${c.side}` === selectedId;
    return c.instanceId === selectedId;
  });
  if (!candidate) {
    throw new Error(`目标 ${selectedId} 不在合法候选列表中`);
  }

  let s = { ...state, pendingChoice: null } as InternalMatchState;

  // 对目标应用效果
  s = applyTargetedEffects(s, candidate, choice.onChosen, maxHp);

  return applyStateEffects(s, choice.activeSide, choice.remainingEffects, random, maxHp, genId, getCardCost);
}

/** 将 TargetedEffect 列表应用到指定目标 */
function applyTargetedEffects(
  state: InternalMatchState,
  target: TargetCandidate,
  effects: TargetedEffect[],
  maxHp: number
): InternalMatchState {
  let s = state;
  for (const effect of effects) {
    if (target.kind === "player") {
      if (effect.op === "dealDamage") {
        const player = s.players[target.side];
        const updatedPlayer: InternalPlayerState = {
          ...player,
          hp: Math.max(0, player.hp - effect.amount),
        };
        s = mergePlayer(s, target.side, updatedPlayer);
        // 检查胜负
        if (updatedPlayer.hp === 0) {
          const winner: PlayerSide = target.side === 0 ? 1 : 0;
          s = { ...s, ended: true, winner };
        }
      }
    } else {
      // venue target
      if (effect.op === "damageVenue") {
        s = damageVenueInState(s, target.instanceId, effect.amount);
      }
    }
  }
  return s;
}

/** 减少场馆耐久；耐久 ≤ 0 时摧毁场馆 */
function damageVenueInState(
  state: InternalMatchState,
  venueInstanceId: string,
  amount: number
): InternalMatchState {
  for (let i = 0; i <= 1; i++) {
    const playerSide = i as PlayerSide;
    const player = state.players[playerSide];
    const venueIdx = player.venues.findIndex((v) => v.instanceId === venueInstanceId);
    if (venueIdx === -1) continue;

    const venue = player.venues[venueIdx];
    const newDurability = venue.durability - amount;

    const updatedVenues =
      newDurability <= 0
        ? player.venues.filter((_, vi) => vi !== venueIdx)
        : player.venues.map((v, vi) =>
            vi === venueIdx ? { ...v, durability: newDurability } : v
          );

    const updatedPlayer: InternalPlayerState = { ...player, venues: updatedVenues };
    return mergePlayer(state, playerSide, updatedPlayer);
  }
  throw new Error(`场馆实例未找到: ${venueInstanceId}`);
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

/** 判断某效果是否需要玩家选择 */
function isChoiceEffect(effect: CardEffect): boolean {
  if (effect.op === "trashFromHandOrDiscard") return true;
  if (effect.op === "scry" && effect.interactive === true) return true;
  if (effect.op === "gainFaceUpCard") return true;
  if (effect.op === "chooseTarget") return true;
  return false;
}

/** 为一个选择效果创建 PendingChoice 并写入状态 */
function createPendingChoiceForEffect(
  state: InternalMatchState,
  activeSide: PlayerSide,
  effect: CardEffect,
  remainingEffects: CardEffect[],
  getCardCost?: GetCardCost
): InternalMatchState {
  if (effect.op === "trashFromHandOrDiscard") {
    const zone = effect.zone ?? "either";
    let choiceType: PendingChoice["type"];
    if (zone === "hand") choiceType = "chooseCardsFromHand";
    else if (zone === "discard") choiceType = "chooseCardsFromDiscard";
    else choiceType = "chooseCardsFromHandOrDiscard";

    const pendingChoice: PendingChoice = {
      type: choiceType,
      forSide: activeSide,
      activeSide,
      minCount: 0,
      maxCount: effect.count,
      remainingEffects,
    } as PendingChoice;
    return { ...state, pendingChoice };
  }

  if (effect.op === "scry" && effect.interactive) {
    const player = state.players[activeSide];
    const count = Math.min(effect.count, player.deck.length);
    const revealedCards = player.deck.slice(0, count);
    const deckBelow = player.deck.slice(count);

    // 翻牌后从牌堆移除（放入 revealedCards 等待玩家决策）
    const updatedPlayer: InternalPlayerState = {
      ...player,
      deck: deckBelow,
    };
    const s = mergePlayer(state, activeSide, updatedPlayer);

    const pendingChoice: PendingChoice = {
      type: "scryDecision",
      forSide: activeSide,
      activeSide,
      revealedCards,
      deckBelow,
      maxDiscard: 1, // MVP：最多弃 1 张
      remainingEffects,
    };
    return { ...s, pendingChoice };
  }

  if (effect.op === "gainFaceUpCard") {
    const candidates: CardInstance[] = [];
    if (getCardCost) {
      for (const lane of state.market) {
        for (const slot of lane.slots) {
          if (slot && getCardCost(slot.cardId) <= effect.maxCost) {
            candidates.push(slot);
          }
        }
      }
    }
    // 无候选直接跳过
    if (candidates.length === 0) {
      return { ...state };
    }
    const pendingChoice: PendingChoice = {
      type: "gainFaceUpCardDecision",
      forSide: activeSide,
      activeSide,
      candidates,
      destination: effect.destination ?? "discard",
      remainingEffects,
    };
    return { ...state, pendingChoice };
  }

  if (effect.op === "chooseTarget") {
    const oppSide: PlayerSide = activeSide === 0 ? 1 : 0;
    const candidates: TargetCandidate[] = [];

    if (effect.targetType === "opponentPlayer") {
      candidates.push({ kind: "player", side: oppSide });
    } else if (effect.targetType === "opponentVenue") {
      for (const v of state.players[oppSide].venues) {
        candidates.push({ kind: "venue", instanceId: v.instanceId, cardId: v.cardId, ownerSide: oppSide });
      }
    } else if (effect.targetType === "selfVenue") {
      for (const v of state.players[activeSide].venues) {
        candidates.push({ kind: "venue", instanceId: v.instanceId, cardId: v.cardId, ownerSide: activeSide });
      }
    }

    // 无候选（如对手没有场馆）直接跳过
    if (candidates.length === 0) {
      return { ...state };
    }

    const pendingChoice: PendingChoice = {
      type: "chooseTarget",
      forSide: activeSide,
      activeSide,
      targetType: effect.targetType,
      candidates,
      onChosen: effect.onChosen,
      remainingEffects,
    };
    return { ...state, pendingChoice };
  }

  // 不应到达这里
  return state;
}

/** 应用单个状态级效果（不含选择效果） */
function applySingleStateEffect(
  state: InternalMatchState,
  activeSide: PlayerSide,
  effect: CardEffect,
  random: () => number,
  maxHp: number,
  genId: () => string
): InternalMatchState {
  // 双方效果：createPressure
  if (effect.op === "createPressure") {
    const targetSide: PlayerSide =
      effect.target === "self" ? activeSide : (activeSide === 0 ? 1 : 0);
    const pressureCards: CardInstance[] = Array.from({ length: effect.count }, () => ({
      instanceId: genId(),
      cardId: "status_pressure",
    }));
    const targetPlayer = state.players[targetSide];
    const updatedTarget: InternalPlayerState = {
      ...targetPlayer,
      hand: [...targetPlayer.hand, ...pressureCards],
    };
    return mergePlayer(state, targetSide, updatedTarget);
  }

  // 延迟弃牌效果
  if (effect.op === "queueDelayedDiscard") {
    const targetSide: PlayerSide =
      effect.target === "self" ? activeSide : (activeSide === 0 ? 1 : 0);
    const targetPlayer = state.players[targetSide];
    const updatedTarget: InternalPlayerState = {
      ...targetPlayer,
      pendingDiscardCount: targetPlayer.pendingDiscardCount + effect.count,
    };
    return mergePlayer(state, targetSide, updatedTarget);
  }

  // 自我效果：通过 applyEffects 应用
  const updatedSelf = applySingleEffect(
    state.players[activeSide],
    effect,
    random,
    maxHp
  );
  return mergePlayer(state, activeSide, updatedSelf);
}

function mergePlayer(
  state: InternalMatchState,
  side: PlayerSide,
  updatedPlayer: InternalPlayerState
): InternalMatchState {
  const players: [InternalPlayerState, InternalPlayerState] = [
    state.players[0],
    state.players[1],
  ];
  players[side] = updatedPlayer;
  return { ...state, players };
}

/**
 * 验证选择数量合法性（上限受实际可选牌数约束）
 */
function validateCount(
  selected: number,
  min: number,
  max: number,
  available: number
): void {
  const effectiveMin = Math.min(min, available);
  const effectiveMax = Math.min(max, available);
  if (selected < effectiveMin || selected > effectiveMax) {
    throw new Error(
      `选择数量不合法：最少 ${effectiveMin}，最多 ${effectiveMax}，实际 ${selected}`
    );
  }
}

// ── 向后兼容导出（原 applyStateEffects 内部使用的辅助，现改为 applySingleStateEffect）──

/**
 * @internal 内部使用，保留以便未来扩展
 */
function cloneStatePlayers(
  state: InternalMatchState
): [InternalPlayerState, InternalPlayerState] {
  return [state.players[0], state.players[1]];
}

// 导出 cloneStatePlayers 供测试和其他模块使用（如有需要）
export { cloneStatePlayers };
