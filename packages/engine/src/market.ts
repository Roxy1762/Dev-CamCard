import type { PlayerSide } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "./types";

// ── reserveFromMarket ─────────────────────────────────────────────────────────

/**
 * reserveFromMarket — 将公开市场中的一张牌放入预约位（纯函数）。
 *
 * 规则（game-rules.md / non-negotiables.md）：
 *  - 每回合最多预约 1 次（hasReservedThisTurn 检查）
 *  - 预约位一次只能放 1 张（reservedCard 非空时拒绝）
 *  - 需支付 1 资源
 *  - 只能预约公开市场槽（不能预约牌堆隐藏牌）
 *  - 预约后对应栏立即从牌堆补位
 *  - 记录预约回合（reservedCardTurn），用于阻止同回合购买
 *
 * @throws 不符合规则时抛出 Error
 */
export function reserveFromMarket(
  state: InternalMatchState,
  buyerSide: PlayerSide,
  instanceId: string,
  turnNumber: number
): InternalMatchState {
  const buyer = state.players[buyerSide];

  if (buyer.hasReservedThisTurn) {
    throw new Error("本回合已执行过预约，每回合只能预约 1 次");
  }

  if (buyer.reservedCard !== null) {
    throw new Error("预约位已有牌，请先购买后再预约");
  }

  if (buyer.resourcePool < 1) {
    throw new Error(`资源不足：预约需要消耗 1 资源，当前持有 ${buyer.resourcePool}`);
  }

  // 从公开槽找到目标牌，同时从该栏牌堆补位
  let reservedCard: CardInstance | null = null;
  const market = state.market.map((lane) => {
    const slotIdx = lane.slots.findIndex((s) => s?.instanceId === instanceId);
    if (slotIdx === -1) return lane;

    reservedCard = lane.slots[slotIdx]!;

    // 补位：从该栏牌堆顶取一张（若有）
    const [refill, ...remainingDeck] = lane.deck;
    const newSlots = lane.slots.map((s, i) =>
      i === slotIdx ? (refill ?? null) : s
    );
    return { ...lane, slots: newSlots, deck: remainingDeck };
  });

  if (!reservedCard) {
    throw new Error(`公开市场中未找到卡牌实例: ${instanceId}`);
  }

  const updatedBuyer: InternalPlayerState = {
    ...buyer,
    resourcePool: buyer.resourcePool - 1,
    reservedCard,
    reservedCardTurn: turnNumber,
    hasReservedThisTurn: true,
  };

  const players = [state.players[0], state.players[1]] as [InternalMatchState["players"][0], InternalMatchState["players"][1]];
  players[buyerSide] = updatedBuyer;
  return { ...state, market, players };
}

// ── buyReservedCard ───────────────────────────────────────────────────────────

/**
 * buyReservedCard — 购买己方预约位的牌（纯函数）。
 *
 * 规则：
 *  - 必须有预约牌
 *  - 不能在预约的同一回合购买（reservedCardTurn < currentTurn）
 *  - 费用为原价 -1（最低 0）
 *  - 购买后牌进入弃牌堆，预约位清空
 *
 * @param cost  已经 -1 后的实际费用（调用方负责计算）
 * @throws 不符合规则时抛出 Error
 */
export function buyReservedCard(
  state: InternalMatchState,
  buyerSide: PlayerSide,
  cost: number
): InternalMatchState {
  const buyer = state.players[buyerSide];

  if (buyer.reservedCard === null) {
    throw new Error("预约位为空，没有可购买的预约牌");
  }

  if (
    buyer.reservedCardTurn !== null &&
    buyer.reservedCardTurn >= state.turnNumber
  ) {
    throw new Error("不能在预约的同一回合购买预约牌，请等到下一回合");
  }

  if (buyer.resourcePool < cost) {
    throw new Error(
      `资源不足：购买预约牌需要 ${cost}，当前持有 ${buyer.resourcePool}`
    );
  }

  const boughtCard = buyer.reservedCard;

  const updatedBuyer: InternalPlayerState = {
    ...buyer,
    resourcePool: buyer.resourcePool - cost,
    reservedCard: null,
    reservedCardTurn: null,
    discard: [...buyer.discard, boughtCard],
  };

  const players = [state.players[0], state.players[1]] as [InternalMatchState["players"][0], InternalMatchState["players"][1]];
  players[buyerSide] = updatedBuyer;
  return { ...state, players };
}

/**
 * buyFromMarket — 从公开市场购买一张卡牌（纯函数）。
 *
 * 规则：
 *  - 消耗 cost 资源
 *  - 将卡牌从商店槽移除，若该栏牌堆（deck）仍有牌则自动补位
 *  - 卡牌加入买家弃牌堆（而非手牌）
 *
 * @throws 资源不足 / 卡牌不在商店时抛出 Error
 */
export function buyFromMarket(
  state: InternalMatchState,
  buyerSide: PlayerSide,
  instanceId: string,
  cost: number
): InternalMatchState {
  const buyer = state.players[buyerSide];

  if (buyer.resourcePool < cost) {
    throw new Error(
      `资源不足：购买需要 ${cost}，当前持有 ${buyer.resourcePool}`
    );
  }

  // 从商店中找到并移除目标卡牌，同时从该栏牌堆补位
  let boughtCard: CardInstance | null = null;
  const market = state.market.map((lane) => {
    const slotIdx = lane.slots.findIndex((s) => s?.instanceId === instanceId);
    if (slotIdx === -1) return lane;

    boughtCard = lane.slots[slotIdx]!;

    // 从该栏牌堆顶补一张（若有）
    const [refill, ...remainingDeck] = lane.deck;
    const newSlots = lane.slots.map((s, i) =>
      i === slotIdx ? (refill ?? null) : s
    );

    return { ...lane, slots: newSlots, deck: remainingDeck };
  });

  if (!boughtCard) {
    throw new Error(`商店中未找到卡牌实例: ${instanceId}`);
  }

  const updatedBuyer: InternalPlayerState = {
    ...buyer,
    resourcePool: buyer.resourcePool - cost,
    discard: [...buyer.discard, boughtCard],
  };

  const players = [
    state.players[0],
    state.players[1],
  ] as [InternalMatchState["players"][0], InternalMatchState["players"][1]];
  players[buyerSide] = updatedBuyer;

  return { ...state, market, players };
}

/**
 * buyFixedSupply — 从固定补给牌堆购买（无限数量，每次生成新实例）（纯函数）。
 *
 * @param genId  UUID 生成函数，可注入以便测试
 * @throws 补给中无此卡牌 / 资源不足时抛出 Error
 */
export function buyFixedSupply(
  state: InternalMatchState,
  buyerSide: PlayerSide,
  cardId: string,
  cost: number,
  genId: () => string = () => crypto.randomUUID()
): InternalMatchState {
  if (!state.fixedSupplies.includes(cardId)) {
    throw new Error(`固定补给中不存在: ${cardId}`);
  }

  const buyer = state.players[buyerSide];

  if (buyer.resourcePool < cost) {
    throw new Error(
      `资源不足：购买需要 ${cost}，当前持有 ${buyer.resourcePool}`
    );
  }

  const newCard: CardInstance = { instanceId: genId(), cardId };

  const updatedBuyer: InternalPlayerState = {
    ...buyer,
    resourcePool: buyer.resourcePool - cost,
    discard: [...buyer.discard, newCard],
  };

  const players = [
    state.players[0],
    state.players[1],
  ] as [InternalMatchState["players"][0], InternalMatchState["players"][1]];
  players[buyerSide] = updatedBuyer;

  return { ...state, players };
}
