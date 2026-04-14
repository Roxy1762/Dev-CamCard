import type { Lane } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState, MarketLaneState } from "./types";

/**
 * RulesetConfig — 引擎初始化所需的规则集参数。
 * 对应 data/rulesets/*.json（经 AJV 校验后注入）。
 */
export interface RulesetConfig {
  id: string;
  hp: number;
  handSize: number;
  firstPlayerOpeningHand: number;
  secondPlayerOpeningHand: number;
  scheduleSlots: number;
  reserveSlots: number;
  marketLanesCount: number;
  marketSlotsPerLane: number;
  starterDeck: Array<{ cardId: string; count: number }>;
  fixedSupplies: string[];
}

const LANE_ORDER: Lane[] = ["course", "activity", "daily"];

/**
 * createMatchState — 根据规则集与玩家信息构造初始内部对局状态（纯函数）。
 *
 * 注意：此时 started=false，牌堆已建立但尚未洗牌或发牌。
 * 洗牌与发开局手牌由 reduce(READY) 完成（待双方均 READY 后触发）。
 *
 * @param roomId      Colyseus 房间 ID
 * @param ruleset     规则集配置
 * @param playerNames 两位玩家的显示名称
 * @param genId       UUID 生成函数，可注入以便测试
 */
export function createMatchState(
  roomId: string,
  ruleset: RulesetConfig,
  playerNames: [string, string],
  genId: () => string = () => crypto.randomUUID()
): InternalMatchState {
  const market: MarketLaneState[] = LANE_ORDER
    .slice(0, ruleset.marketLanesCount)
    .map((lane) => ({
      lane,
      slots: Array<CardInstance | null>(ruleset.marketSlotsPerLane).fill(null),
    }));

  const players: [InternalPlayerState, InternalPlayerState] = [
    makePlayer(0, playerNames[0], ruleset, genId),
    makePlayer(1, playerNames[1], ruleset, genId),
  ];

  return {
    roomId,
    rulesetId: ruleset.id,
    turnNumber: 1,
    activePlayer: 0,
    players,
    market,
    fixedSupplies: ruleset.fixedSupplies,
    readyPlayers: [false, false],
    started: false,
    ended: false,
    winner: null,
  };
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function makePlayer(
  side: 0 | 1,
  name: string,
  ruleset: RulesetConfig,
  genId: () => string
): InternalPlayerState {
  const deck: CardInstance[] = ruleset.starterDeck.flatMap(({ cardId, count }) =>
    Array.from({ length: count }, () => ({ instanceId: genId(), cardId }))
  );

  return {
    side,
    name,
    hp: ruleset.hp,
    block: 0,
    resourcePool: 0,
    attackPool: 0,
    deck,
    hand: [],
    discard: [],
    played: [],
    venues: [],
    scheduleSlots: Array<CardInstance | null>(ruleset.scheduleSlots).fill(null),
    reservedCard: null,
  };
}
