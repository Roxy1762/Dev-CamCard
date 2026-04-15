import type { PlayerSide } from "@dev-camcard/protocol";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "./types";

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
