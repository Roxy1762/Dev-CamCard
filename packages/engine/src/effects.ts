import type { PlayerSide } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "./types";
import { draw, shuffle } from "./deck";

// ── Effect 类型定义 ────────────────────────────────────────────────────────────

/**
 * CardEffect — 卡牌效果的 discriminated union。
 *
 * 支持：
 *  gainResource / gainAttack / gainBlock / heal / draw / drawThenDiscard
 *  createPressure / scry / setFlag / gainFaceUpCard（后两个为 MVP 占位）
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
  /** 预习：查看牌堆顶 N 张并随机重排（MVP：随机洗牌，无交互选择） */
  | { op: "scry"; count: number }
  /** 设置玩家标志位（用于条件效果，如 nextBoughtCardToDeckTop） */
  | { op: "setFlag"; flag: string }
  /** 直接获取一张特定牌入手（MVP：no-op 占位，需确定来源） */
  | { op: "gainFaceUpCard"; cardId: string }
  /**
   * 让目标玩家在下回合开始时弃 count 张手牌。
   * 多次叠加累加到 pendingDiscardCount，beginTurn 时统一结算。
   * target 默认为 "opponent"（对手）。
   */
  | { op: "queueDelayedDiscard"; count: number; target?: "opponent" | "self" };

// ── Condition 类型定义 ────────────────────────────────────────────────────────

/**
 * CardCondition — 技能触发条件，条件不满足时整个技能跳过。
 *
 * 基于 InternalPlayerState 中可直接读取的字段判断。
 * 在 `played` 已包含当前牌时评估（即：played.length=1 表示"本回合第一张行动牌"）。
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
 *
 * 只保留引擎需要的字段；完整卡面文案、费用等由 server 层管理。
 * 场馆专用字段（isGuard / durability / activationsPerTurn）仅在 type="venue" 时有意义。
 */
export interface CardDef {
  id: string;
  type: "action" | "venue";
  abilities: CardAbility[];
  /** 场馆：是否为值守场馆（存在时对手必须优先攻击） */
  isGuard?: boolean;
  /** 场馆：最大耐久值 */
  durability?: number;
  /** 场馆：每回合最多启动次数（默认 1） */
  activationsPerTurn?: number;
  /** 压力牌标记：不可打出，回合结束弃置（对应 status_pressure） */
  isPressure?: boolean;
}

// ── Condition checker ────────────────────────────────────────────────────────

/**
 * checkCondition — 根据当前玩家状态判断条件是否满足。
 *
 * 注意：在打出行动牌后调用时，played 已包含当前牌。
 */
export function checkCondition(
  player: InternalPlayerState,
  cond: CardCondition
): boolean {
  switch (cond.type) {
    case "firstActionThisTurn":
      // played 包含刚打的这张，长度为 1 表示本回合第一张
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
      return true; // 未知条件默认通过（防御性）
  }
}

// ── Effect interpreter（单玩家级别）────────────────────────────────────────────

/**
 * applyEffects — 将一组效果依次应用到单个玩家（纯函数）。
 *
 * 只处理自我效果（gainResource / gainAttack / gainBlock / heal / draw /
 * drawThenDiscard / scry / setFlag / gainFaceUpCard）。
 *
 * createPressure 涉及双方状态，由调用方（reduce.ts）通过 applyStateEffects 处理。
 *
 * @param player  当前玩家状态
 * @param effects 待应用的效果列表（createPressure 会被跳过）
 * @param random  随机数函数（用于 draw / scry 效果）
 * @param maxHp   生命值上限（用于 heal 封顶）
 * @returns       更新后的玩家状态
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
      // 先摸 count 张，再从手牌头部弃 count 张（最早入手的先弃）
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
      // 预习：查看牌堆顶 count 张，MVP 实现为随机重洗这 count 张
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
      // createPressure 由 applyStateEffects 处理，单玩家级别跳过
      return player;

    default:
      // 未知 op — no-op，防御性处理
      return player;
  }
}

// ── State-level effect interpreter（支持双方） ────────────────────────────────

/**
 * applyStateEffects — 将一组效果应用到对局状态（纯函数）。
 *
 * 在单玩家效果之外，额外处理：
 *  - createPressure：向对手（或自己）手牌加入 status_pressure 实例
 *
 * @param state      当前对局状态
 * @param activeSide 效果来源方（打出牌的玩家）
 * @param effects    效果列表
 * @param random     随机数函数
 * @param maxHp      生命值上限
 * @param genId      UUID 生成函数（用于创建压力牌实例）
 */
export function applyStateEffects(
  state: InternalMatchState,
  activeSide: PlayerSide,
  effects: CardEffect[],
  random: () => number,
  maxHp: number,
  genId: () => string
): InternalMatchState {
  // 区分自我效果和状态级效果（需要访问双方玩家的效果）
  const selfEffects: CardEffect[] = [];
  const pressureEffects: Array<{ op: "createPressure"; count: number; target?: "opponent" | "self" }> = [];
  const delayedDiscardEffects: Array<{ op: "queueDelayedDiscard"; count: number; target?: "opponent" | "self" }> = [];

  for (const effect of effects) {
    if (effect.op === "createPressure") {
      pressureEffects.push(effect as { op: "createPressure"; count: number; target?: "opponent" | "self" });
    } else if (effect.op === "queueDelayedDiscard") {
      delayedDiscardEffects.push(effect as { op: "queueDelayedDiscard"; count: number; target?: "opponent" | "self" });
    } else {
      selfEffects.push(effect);
    }
  }

  // 1. 应用自我效果
  let s = state;
  if (selfEffects.length > 0) {
    const updatedSelf = applyEffects(s.players[activeSide], selfEffects, random, maxHp);
    const players = cloneStatePlayers(s);
    players[activeSide] = updatedSelf;
    s = { ...s, players };
  }

  // 2. 处理压力效果
  for (const pe of pressureEffects) {
    const targetSide: PlayerSide =
      pe.target === "self" ? activeSide : (activeSide === 0 ? 1 : 0);
    const pressureCards: CardInstance[] = Array.from({ length: pe.count }, () => ({
      instanceId: genId(),
      cardId: "status_pressure",
    }));
    const targetPlayer = s.players[targetSide];
    const updatedTarget = {
      ...targetPlayer,
      hand: [...targetPlayer.hand, ...pressureCards],
    };
    const players = cloneStatePlayers(s);
    players[targetSide] = updatedTarget;
    s = { ...s, players };
  }

  // 3. 处理延迟弃牌效果
  for (const dd of delayedDiscardEffects) {
    const targetSide: PlayerSide =
      dd.target === "self" ? activeSide : (activeSide === 0 ? 1 : 0);
    const targetPlayer = s.players[targetSide];
    const updatedTarget = {
      ...targetPlayer,
      pendingDiscardCount: targetPlayer.pendingDiscardCount + dd.count,
    };
    const players = cloneStatePlayers(s);
    players[targetSide] = updatedTarget;
    s = { ...s, players };
  }

  return s;
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function cloneStatePlayers(
  state: InternalMatchState
): [InternalPlayerState, InternalPlayerState] {
  return [state.players[0], state.players[1]];
}
