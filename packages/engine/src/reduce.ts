import type { ClientCommand, PlayerSide, AttackAssignment } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState, VenueState } from "./types";
import type { RulesetConfig } from "./init";
import type { CardDef } from "./effects";
import { applyEffects, applyStateEffects, checkCondition, resolveChoice } from "./effects";
import { draw, shuffle } from "./deck";
import { endTurn } from "./turn";
import { buyFromMarket, buyFixedSupply, reserveFromMarket, buyReservedCard } from "./market";

/**
 * EngineConfig — reduce 调用时注入的引擎配置。
 */
export interface EngineConfig {
  ruleset: RulesetConfig;
  /** 按 cardId 查询购买费用，用于 BUY 命令 */
  getCardCost: (cardId: string) => number;
  /** 按 cardId 查询卡牌效果定义，用于 PLAY_CARD / ACTIVATE_VENUE 等 */
  getCardDef: (cardId: string) => CardDef | undefined;
}

/**
 * reduce — 规则引擎主入口（纯函数）。
 *
 * 接收当前内部状态 + 发令席位 + 客户端命令，返回新状态。
 * 非法操作抛出 Error（由调用方捕获后回复错误消息）。
 *
 * 当 state.pendingChoice 非 null 时，除 SUBMIT_CHOICE / CONCEDE 外所有命令均被拒绝。
 */
export function reduce(
  state: InternalMatchState,
  side: PlayerSide,
  command: ClientCommand,
  config: EngineConfig,
  random: () => number = Math.random,
  genId: () => string = () => crypto.randomUUID()
): InternalMatchState {
  switch (command.type) {
    case CMD.READY:
      return handleReady(state, side, config.ruleset, random);

    case CMD.CONCEDE:
      return {
        ...state,
        ended: true,
        winner: (side === 0 ? 1 : 0) as PlayerSide,
      };

    case CMD.SUBMIT_CHOICE:
      assertStarted(state);
      return resolveChoice(
        state,
        side,
        command.selectedInstanceIds,
        random,
        config.ruleset.hp,
        genId,
        config.getCardCost
      );

    // ── 以下所有命令在有 pendingChoice 时一律拒绝 ──────────────────────────────

    case CMD.PLAY_CARD:
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      return handlePlayCard(state, side, command.instanceId, config, random, genId);

    case CMD.PUT_CARD_TO_SCHEDULE:
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      return handlePutCardToSchedule(
        state,
        side,
        command.instanceId,
        command.slotIndex,
        config,
        random,
        genId
      );

    case CMD.ACTIVATE_VENUE:
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      return handleActivateVenue(state, side, command.instanceId, config, random, genId);

    case CMD.RESERVE_MARKET_CARD:
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      return reserveFromMarket(state, side, command.instanceId, state.turnNumber);

    case CMD.BUY_RESERVED_CARD: {
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      const player = state.players[side];
      if (!player.reservedCard) {
        throw new Error("预约位为空，没有可购买的预约牌");
      }
      const baseCost = config.getCardCost(player.reservedCard.cardId);
      const cost = Math.max(0, baseCost - 1);
      return buyReservedCard(state, side, cost);
    }

    case CMD.ASSIGN_ATTACK:
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      return handleAssignAttack(state, side, command.assignments);

    case CMD.END_TURN:
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      return endTurn(state, config.ruleset.handSize, random, {
        hp: config.ruleset.hp,
        getCardDef: config.getCardDef,
        genId,
      });

    case CMD.BUY_MARKET_CARD: {
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      const slot = state.market
        .flatMap((lane) => lane.slots)
        .find((s) => s?.instanceId === command.instanceId);
      if (!slot) {
        throw new Error(`商店中未找到卡牌实例: ${command.instanceId}`);
      }
      const cost = config.getCardCost(slot.cardId);
      let newState = buyFromMarket(state, side, command.instanceId, cost);
      newState = applyBuyFlag(newState, side);
      return newState;
    }

    case CMD.BUY_FIXED_SUPPLY: {
      assertActive(state, side);
      assertStarted(state);
      assertNoPendingChoice(state);
      const cost = config.getCardCost(command.cardId);
      let newState = buyFixedSupply(state, side, command.cardId, cost, genId);
      newState = applyBuyFlag(newState, side);
      return newState;
    }

    default:
      return state;
  }
}

// ── PLAY_CARD ─────────────────────────────────────────────────────────────────

function handlePlayCard(
  state: InternalMatchState,
  side: PlayerSide,
  instanceId: string,
  config: EngineConfig,
  random: () => number,
  genId: () => string
): InternalMatchState {
  const player = state.players[side];
  const cardIdx = player.hand.findIndex((c) => c.instanceId === instanceId);

  if (cardIdx === -1) {
    throw new Error(`手牌中未找到卡牌实例: ${instanceId}`);
  }

  const card = player.hand[cardIdx];
  const cardDef = config.getCardDef(card.cardId);

  if (!cardDef) {
    throw new Error(`未找到卡牌定义: ${card.cardId}`);
  }

  if (cardDef.isPressure) {
    throw new Error(`压力牌不可打出: ${card.cardId}`);
  }

  const newHand = player.hand.filter((_, i) => i !== cardIdx);

  // ── 场馆牌：进入场馆区 ─────────────────────────────────────────────────────
  if (cardDef.type === "venue") {
    const maxDur = cardDef.durability ?? 1;
    const venue: VenueState = {
      instanceId: card.instanceId,
      cardId: card.cardId,
      owner: side,
      isGuard: cardDef.isGuard ?? false,
      durability: maxDur,
      maxDurability: maxDur,
      activationsLeft: 0,
      activationsPerTurn: cardDef.activationsPerTurn ?? 1,
    };

    const updatedPlayer: InternalPlayerState = {
      ...player,
      hand: newHand,
      venues: [...player.venues, venue],
    };

    const players = clonePlayers(state);
    players[side] = updatedPlayer;
    return { ...state, players };
  }

  // ── 行动牌：移至 played 区，执行 onPlay 效果 ──────────────────────────────
  let updatedPlayer: InternalPlayerState = {
    ...player,
    hand: newHand,
    played: [...player.played, card],
  };

  let s = state;
  for (const ability of cardDef.abilities) {
    if (ability.trigger !== "onPlay") continue;

    if (ability.condition && !checkCondition(updatedPlayer, ability.condition)) {
      continue;
    }

    const players = clonePlayers(s);
    players[side] = updatedPlayer;
    s = { ...s, players };
    s = applyStateEffects(s, side, ability.effects, random, config.ruleset.hp, genId, config.getCardCost);
    updatedPlayer = s.players[side];

    // 若本 ability 产生了 pendingChoice，停止处理后续 ability
    if (s.pendingChoice) break;
  }

  const finalPlayers = clonePlayers(s);
  finalPlayers[side] = updatedPlayer;
  return { ...s, players: finalPlayers };
}

// ── PUT_CARD_TO_SCHEDULE ──────────────────────────────────────────────────────

function handlePutCardToSchedule(
  state: InternalMatchState,
  side: PlayerSide,
  instanceId: string,
  slotIndex: number,
  config: EngineConfig,
  random: () => number,
  genId: () => string
): InternalMatchState {
  const player = state.players[side];

  if (slotIndex < 0 || slotIndex >= player.scheduleSlots.length) {
    throw new Error(`无效日程槽索引: ${slotIndex}`);
  }
  if (player.scheduleSlots[slotIndex] !== null) {
    throw new Error(`日程槽 ${slotIndex} 已被占用`);
  }

  const cardIdx = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (cardIdx === -1) {
    throw new Error(`手牌中未找到卡牌实例: ${instanceId}`);
  }

  const card = player.hand[cardIdx];
  const cardDef = config.getCardDef(card.cardId);
  if (!cardDef) {
    throw new Error(`未找到卡牌定义: ${card.cardId}`);
  }
  if (cardDef.type !== "action") {
    throw new Error(`仅行动牌可安排: ${card.cardId}`);
  }
  if (cardDef.isPressure) {
    throw new Error(`压力牌不可安排: ${card.cardId}`);
  }
  if (!cardDef.abilities.some((a) => a.trigger === "onScheduleResolve")) {
    throw new Error(`该牌没有可安排的延迟效果: ${card.cardId}`);
  }

  const newHand = player.hand.filter((_, i) => i !== cardIdx);
  const newSlots = player.scheduleSlots.map((s, i) => (i === slotIndex ? card : s)) as (CardInstance | null)[];
  let updatedPlayer: InternalPlayerState = { ...player, hand: newHand, scheduleSlots: newSlots };

  // 安排语义：先打出（执行 onPlay），再把牌置于日程槽等待下回合结算 onScheduleResolve
  let s = state;
  for (const ability of cardDef.abilities) {
    if (ability.trigger !== "onPlay") continue;
    if (ability.condition && !checkCondition(updatedPlayer, ability.condition)) continue;

    const players = clonePlayers(s);
    players[side] = updatedPlayer;
    s = { ...s, players };
    s = applyStateEffects(s, side, ability.effects, random, config.ruleset.hp, genId, config.getCardCost);
    updatedPlayer = s.players[side];
    if (s.pendingChoice) break;
  }

  const finalPlayers = clonePlayers(s);
  finalPlayers[side] = updatedPlayer;
  return { ...s, players: finalPlayers };
}

// ── ACTIVATE_VENUE ────────────────────────────────────────────────────────────

function handleActivateVenue(
  state: InternalMatchState,
  side: PlayerSide,
  instanceId: string,
  config: EngineConfig,
  random: () => number,
  genId: () => string
): InternalMatchState {
  const player = state.players[side];

  const venueIdx = player.venues.findIndex((v) => v.instanceId === instanceId);
  if (venueIdx === -1) {
    throw new Error(`场馆未找到: ${instanceId}`);
  }

  const venue = player.venues[venueIdx];
  if (venue.activationsLeft <= 0) {
    throw new Error(`场馆本回合无法再次启动（activationsLeft=${venue.activationsLeft}）`);
  }

  const newVenues = player.venues.map((v, i) =>
    i === venueIdx ? { ...v, activationsLeft: v.activationsLeft - 1 } : v
  );
  let updatedPlayer: InternalPlayerState = { ...player, venues: newVenues };

  const cardDef = config.getCardDef(venue.cardId);
  if (!cardDef) return state;

  let s = state;
  for (const ability of cardDef.abilities) {
    if (ability.trigger !== "onActivate") continue;

    if (ability.condition && !checkCondition(updatedPlayer, ability.condition)) {
      continue;
    }

    const players = clonePlayers(s);
    players[side] = updatedPlayer;
    s = { ...s, players };
    s = applyStateEffects(s, side, ability.effects, random, config.ruleset.hp, genId, config.getCardCost);
    updatedPlayer = s.players[side];

    if (s.pendingChoice) break;
  }

  const finalPlayers = clonePlayers(s);
  finalPlayers[side] = updatedPlayer;
  return { ...s, players: finalPlayers };
}

// ── ASSIGN_ATTACK ─────────────────────────────────────────────────────────────

function handleAssignAttack(
  state: InternalMatchState,
  side: PlayerSide,
  assignments: AttackAssignment[]
): InternalMatchState {
  if (assignments.length === 0) return state;

  const oppSide: PlayerSide = side === 0 ? 1 : 0;
  const oppPlayer = state.players[oppSide];
  const guardVenues = oppPlayer.venues.filter((v) => v.isGuard);

  if (guardVenues.length > 0) {
    for (const assign of assignments) {
      if (assign.targetSide !== oppSide) continue;
      if (assign.target === "player") {
        throw new Error("对方有值守场馆，必须先摧毁值守场馆才能攻击玩家");
      }
      if (assign.target === "venue") {
        const targeted = oppPlayer.venues.find(
          (v) => v.instanceId === assign.venueInstanceId
        );
        if (!targeted || !targeted.isGuard) {
          throw new Error("对方有值守场馆，必须优先攻击值守场馆");
        }
      }
    }
  }

  let s = state;
  for (const assignment of assignments) {
    s = processAssignment(s, side, assignment);
    if (s.ended) break;
  }

  return s;
}

function processAssignment(
  state: InternalMatchState,
  side: PlayerSide,
  assignment: AttackAssignment
): InternalMatchState {
  const attacker = state.players[side];

  if (attacker.attackPool < assignment.amount) {
    throw new Error(
      `攻击力不足：需要 ${assignment.amount}，当前持有 ${attacker.attackPool}`
    );
  }

  if (assignment.target === "player") {
    const targetSide = assignment.targetSide;
    const target = state.players[targetSide];

    const blockAbsorbed = Math.min(target.block, assignment.amount);
    const hpDamage = assignment.amount - blockAbsorbed;

    const updatedTarget: InternalPlayerState = {
      ...target,
      block: target.block - blockAbsorbed,
      hp: target.hp - hpDamage,
    };
    const updatedAttacker: InternalPlayerState = {
      ...attacker,
      attackPool: attacker.attackPool - assignment.amount,
    };

    const players = clonePlayers(state);
    players[targetSide] = updatedTarget;
    players[side] = updatedAttacker;

    let s: InternalMatchState = { ...state, players };

    if (updatedTarget.hp <= 0) {
      s = { ...s, ended: true, winner: side };
    }
    return s;
  }

  if (assignment.target === "venue") {
    const targetSide = assignment.targetSide;
    const target = state.players[targetSide];

    if (!assignment.venueInstanceId) {
      throw new Error("攻击场馆时必须提供 venueInstanceId");
    }

    const venueIdx = target.venues.findIndex(
      (v) => v.instanceId === assignment.venueInstanceId
    );
    if (venueIdx === -1) {
      throw new Error(`未找到场馆实例: ${assignment.venueInstanceId}`);
    }

    const venue = target.venues[venueIdx];
    const newDurability = venue.durability - assignment.amount;

    let updatedTarget: InternalPlayerState;
    if (newDurability <= 0) {
      const destroyedCard: CardInstance = {
        instanceId: venue.instanceId,
        cardId: venue.cardId,
      };
      updatedTarget = {
        ...target,
        venues: target.venues.filter((_, i) => i !== venueIdx),
        discard: [...target.discard, destroyedCard],
      };
    } else {
      const updatedVenues = target.venues.map((v, i) =>
        i === venueIdx ? { ...v, durability: newDurability } : v
      );
      updatedTarget = { ...target, venues: updatedVenues };
    }

    const updatedAttacker: InternalPlayerState = {
      ...attacker,
      attackPool: attacker.attackPool - assignment.amount,
    };

    const players = clonePlayers(state);
    players[targetSide] = updatedTarget;
    players[side] = updatedAttacker;

    return { ...state, players };
  }

  return state;
}

// ── READY ─────────────────────────────────────────────────────────────────────

function handleReady(
  state: InternalMatchState,
  side: PlayerSide,
  ruleset: RulesetConfig,
  random: () => number
): InternalMatchState {
  if (state.readyPlayers[side]) {
    return state;
  }

  const newReady: [boolean, boolean] = [state.readyPlayers[0], state.readyPlayers[1]];
  newReady[side] = true;

  const nextState: InternalMatchState = { ...state, readyPlayers: newReady };

  if (newReady[0] && newReady[1]) {
    return startMatch(nextState, ruleset, random);
  }

  return nextState;
}

function startMatch(
  state: InternalMatchState,
  ruleset: RulesetConfig,
  random: () => number
): InternalMatchState {
  const players = state.players.map((player, idx) => {
    const shuffledDeck = shuffle(player.deck, random);
    const openingSize =
      idx === 0 ? ruleset.firstPlayerOpeningHand : ruleset.secondPlayerOpeningHand;

    const reset: InternalPlayerState = {
      ...player,
      deck: shuffledDeck,
      hand: [],
      discard: [],
    };
    return draw(reset, openingSize, random);
  }) as [InternalPlayerState, InternalPlayerState];

  return {
    ...state,
    players,
    started: true,
    turnNumber: 1,
    activePlayer: 0,
  };
}

// ── nextBoughtCardToDeckTop 标志处理 ─────────────────────────────────────────

function applyBuyFlag(
  state: InternalMatchState,
  side: PlayerSide
): InternalMatchState {
  const player = state.players[side];
  if (!player.activeFlags.includes("nextBoughtCardToDeckTop")) {
    return state;
  }
  if (player.discard.length === 0) return state;

  const newDiscard = player.discard.slice(0, -1);
  const boughtCard = player.discard[player.discard.length - 1];
  const newDeck = [boughtCard, ...player.deck];
  const newFlags = player.activeFlags.filter((f) => f !== "nextBoughtCardToDeckTop");

  const updatedPlayer: InternalPlayerState = {
    ...player,
    discard: newDiscard,
    deck: newDeck,
    activeFlags: newFlags,
  };

  const players = clonePlayers(state);
  players[side] = updatedPlayer;
  return { ...state, players };
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function assertActive(state: InternalMatchState, side: PlayerSide): void {
  if (state.activePlayer !== side) {
    throw new Error(
      `非行动方（side=${side}）不能执行此操作，当前行动方为 side=${state.activePlayer}`
    );
  }
}

function assertStarted(state: InternalMatchState): void {
  if (!state.started) {
    throw new Error("对局尚未开始，请先发送 READY 命令");
  }
}

/**
 * assertNoPendingChoice — 若存在待处理选择，拒绝执行当前命令。
 * 仅 SUBMIT_CHOICE 和 CONCEDE 可在 pendingChoice 存在时执行。
 */
function assertNoPendingChoice(state: InternalMatchState): void {
  if (state.pendingChoice) {
    throw new Error(
      "存在待处理的选择，请先发送 SUBMIT_CHOICE 命令响应后再执行其他操作"
    );
  }
}

function clonePlayers(
  state: InternalMatchState
): [InternalPlayerState, InternalPlayerState] {
  return [state.players[0], state.players[1]];
}

// 导出供测试使用
export { clonePlayers };
