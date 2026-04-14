import type { ClientCommand, PlayerSide } from "@dev-camcard/protocol";
import { CMD } from "@dev-camcard/protocol";
import type { InternalMatchState, InternalPlayerState } from "./types";
import type { RulesetConfig } from "./init";
import type { CardDef } from "./effects";
import { applyEffects } from "./effects";
import { draw, shuffle } from "./deck";
import { endTurn } from "./turn";
import { buyFromMarket, buyFixedSupply } from "./market";

/**
 * EngineConfig — reduce 调用时注入的引擎配置。
 */
export interface EngineConfig {
  ruleset: RulesetConfig;
  /** 按 cardId 查询购买费用，用于 BUY 命令 */
  getCardCost: (cardId: string) => number;
  /** 按 cardId 查询卡牌效果定义，用于 PLAY_CARD */
  getCardDef: (cardId: string) => CardDef | undefined;
}

/**
 * reduce — 规则引擎主入口（纯函数）。
 *
 * 接收当前内部状态 + 发令席位 + 客户端命令，返回新状态。
 * 非法操作抛出 Error（由调用方捕获后回复错误消息）。
 *
 * @param state    当前内部对局状态
 * @param side     发出命令的玩家席位
 * @param command  客户端命令（discriminated union）
 * @param config   引擎配置
 * @param random   可注入随机函数（测试用）
 * @param genId    可注入 UUID 生成函数（测试用）
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

    case CMD.PLAY_CARD:
      assertActive(state, side);
      assertStarted(state);
      return handlePlayCard(state, side, command.instanceId, config, random);

    case CMD.ASSIGN_ATTACK:
      assertActive(state, side);
      assertStarted(state);
      return handleAssignAttack(state, side, command.assignments);

    case CMD.END_TURN:
      assertActive(state, side);
      assertStarted(state);
      return endTurn(state, config.ruleset.handSize, random);

    case CMD.BUY_MARKET_CARD: {
      assertActive(state, side);
      assertStarted(state);
      const slot = state.market
        .flatMap((lane) => lane.slots)
        .find((s) => s?.instanceId === command.instanceId);
      if (!slot) {
        throw new Error(`商店中未找到卡牌实例: ${command.instanceId}`);
      }
      const cost = config.getCardCost(slot.cardId);
      return buyFromMarket(state, side, command.instanceId, cost);
    }

    case CMD.BUY_FIXED_SUPPLY: {
      assertActive(state, side);
      assertStarted(state);
      const cost = config.getCardCost(command.cardId);
      return buyFixedSupply(state, side, command.cardId, cost, genId);
    }

    case CMD.CONCEDE:
      return {
        ...state,
        ended: true,
        winner: (side === 0 ? 1 : 0) as PlayerSide,
      };

    default:
      // 未实现的命令（ACTIVATE_VENUE 等）暂时为 no-op
      return state;
  }
}

// ── PLAY_CARD ─────────────────────────────────────────────────────────────────

function handlePlayCard(
  state: InternalMatchState,
  side: PlayerSide,
  instanceId: string,
  config: EngineConfig,
  random: () => number
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

  // 将卡牌从手牌移至 played 区
  const newHand = player.hand.filter((_, i) => i !== cardIdx);
  let updatedPlayer: InternalPlayerState = {
    ...player,
    hand: newHand,
    played: [...player.played, card],
  };

  // 应用所有 onPlay 效果
  for (const ability of cardDef.abilities) {
    if (ability.trigger === "onPlay") {
      updatedPlayer = applyEffects(
        updatedPlayer,
        ability.effects,
        random,
        config.ruleset.hp
      );
    }
  }

  const players = [state.players[0], state.players[1]] as [
    InternalPlayerState,
    InternalPlayerState,
  ];
  players[side] = updatedPlayer;

  return { ...state, players };
}

// ── ASSIGN_ATTACK ─────────────────────────────────────────────────────────────

function handleAssignAttack(
  state: InternalMatchState,
  side: PlayerSide,
  assignments: import("@dev-camcard/protocol").AttackAssignment[]
): InternalMatchState {
  let s = state;

  for (const assignment of assignments) {
    // 本轮只支持攻击玩家，跳过场馆
    if (assignment.target !== "player") continue;

    const attacker = s.players[side];
    if (attacker.attackPool < assignment.amount) {
      throw new Error(
        `攻击力不足：需要 ${assignment.amount}，当前持有 ${attacker.attackPool}`
      );
    }

    const targetSide = assignment.targetSide;
    const target = s.players[targetSide];

    // 伤害结算：先扣 block，再扣 hp（game-rules.md）
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

    const players = [s.players[0], s.players[1]] as [
      InternalPlayerState,
      InternalPlayerState,
    ];
    players[targetSide] = updatedTarget;
    players[side] = updatedAttacker;

    s = { ...s, players };

    // hp <= 0 → 立刻决出胜者并结束对局
    if (updatedTarget.hp <= 0) {
      s = { ...s, ended: true, winner: side };
      break;
    }
  }

  return s;
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

function handleReady(
  state: InternalMatchState,
  side: PlayerSide,
  ruleset: RulesetConfig,
  random: () => number
): InternalMatchState {
  // 幂等：重复 READY 不改变状态
  if (state.readyPlayers[side]) {
    return state;
  }

  const newReady: [boolean, boolean] = [state.readyPlayers[0], state.readyPlayers[1]];
  newReady[side] = true;

  const nextState: InternalMatchState = { ...state, readyPlayers: newReady };

  // 双方均 READY → 开局
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
