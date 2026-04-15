import type { Lane } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState, MarketLaneState } from "./types";
import { shuffle } from "./deck";

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
 * createMarketState — 为三栏市场构造初始公开槽位 + 隐藏牌堆（纯函数）。
 *
 * 每栏：
 *  - 所有该栏卡牌先用 genId 生成实例，再用 random 洗牌
 *  - 前 slotsPerLane 张放入 slots（公开）
 *  - 剩余张放入 deck（隐藏，deck[0] 为栈顶，即下一张补位牌）
 *
 * @param laneDefinitions  每栏的 cardId 列表（顺序不重要，会被洗牌）
 * @param slotsPerLane     每栏公开槽位数量
 * @param genId            UUID 生成函数，可注入以便测试
 * @param random           随机函数，可注入以便测试
 */
export function createMarketState(
  laneDefinitions: Array<{ lane: Lane; cardIds: string[] }>,
  slotsPerLane: number,
  genId: () => string = () => crypto.randomUUID(),
  random: () => number = Math.random
): MarketLaneState[] {
  return laneDefinitions.map(({ lane, cardIds }) => {
    const instances: CardInstance[] = cardIds.map((cardId) => ({
      instanceId: genId(),
      cardId,
    }));

    const shuffled = shuffle(instances, random);

    const slots: (CardInstance | null)[] = Array(slotsPerLane).fill(null);
    for (let i = 0; i < Math.min(shuffled.length, slotsPerLane); i++) {
      slots[i] = shuffled[i];
    }

    const deck: CardInstance[] = shuffled.slice(slotsPerLane);

    return { lane, slots, deck };
  });
}

/**
 * createMatchState — 根据规则集与玩家信息构造初始内部对局状态（纯函数）。
 *
 * 注意：此时 started=false，牌堆已建立但尚未洗牌或发牌。
 * 洗牌与发开局手牌由 reduce(READY) 完成（待双方均 READY 后触发）。
 * 市场槽位通过 createMarketState 单独初始化（server 调用后合并进此状态）。
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
      deck: [],
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
    reservedCardTurn: null,
    hasReservedThisTurn: false,
    activeFlags: [],
    pendingDiscardCount: 0,
  };
}
