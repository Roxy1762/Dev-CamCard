import { describe, it, expect } from "vitest";
import { reduce } from "../reduce";
import { createMatchState } from "../init";
import type { EngineConfig } from "../reduce";
import type { RulesetConfig } from "../init";
import type { CardDef } from "../effects";
import type { CardInstance, InternalMatchState, InternalPlayerState } from "../types";

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

const RULESET: RulesetConfig = {
  id: "core-v1",
  hp: 32,
  handSize: 5,
  firstPlayerOpeningHand: 4,
  secondPlayerOpeningHand: 5,
  scheduleSlots: 2,
  reserveSlots: 1,
  marketLanesCount: 3,
  marketSlotsPerLane: 2,
  starterDeck: [
    { cardId: "starter_allowance", count: 7 },
    { cardId: "starter_quarrel", count: 3 },
    { cardId: "starter_draft_paper", count: 1 },
    { cardId: "starter_punctuality", count: 1 },
  ],
  fixedSupplies: ["supply_errand_runner", "supply_milk_bread"],
};

const CARD_COSTS: Record<string, number> = {
  starter_allowance: 0,
  starter_quarrel: 0,
  supply_errand_runner: 3,
  supply_milk_bread: 2,
  market_card_1: 4,
};

/** 测试用卡牌效果定义（对应 data/cards/starter.json + fixed-supplies.json） */
const CARD_DEFS: Record<string, CardDef> = {
  starter_allowance: {
    id: "starter_allowance",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "gainResource", amount: 2 }] }],
  },
  starter_quarrel: {
    id: "starter_quarrel",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "gainAttack", amount: 1 }] }],
  },
  starter_draft_paper: {
    id: "starter_draft_paper",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "draw", count: 1 }] }],
  },
  starter_punctuality: {
    id: "starter_punctuality",
    type: "action",
    abilities: [
      {
        trigger: "onPlay",
        effects: [
          { op: "gainResource", amount: 1 },
          { op: "gainBlock", amount: 1 },
        ],
      },
    ],
  },
  supply_errand_runner: {
    id: "supply_errand_runner",
    type: "action",
    abilities: [
      {
        trigger: "onPlay",
        effects: [
          { op: "gainResource", amount: 1 },
          { op: "draw", count: 1 },
        ],
      },
    ],
  },
  supply_milk_bread: {
    id: "supply_milk_bread",
    type: "action",
    abilities: [
      {
        trigger: "onPlay",
        effects: [
          { op: "gainResource", amount: 2 },
          { op: "heal", amount: 1 },
        ],
      },
    ],
  },
  // 用于测试 drawThenDiscard
  test_draw_then_discard: {
    id: "test_draw_then_discard",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "drawThenDiscard", count: 1 }] }],
  },
};

const CONFIG: EngineConfig = {
  ruleset: RULESET,
  getCardCost: (id) => CARD_COSTS[id] ?? 0,
  getCardDef: (id) => CARD_DEFS[id],
};

const deterministicRandom = () => 0;

let idCounter = 0;
const genId = () => `id-${idCounter++}`;

function freshState(): InternalMatchState {
  idCounter = 0;
  return createMatchState("room-test", RULESET, ["Alice", "Bob"], genId);
}

function makePlayer(side: 0 | 1, overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side,
    name: `玩家${side}`,
    hp: 32,
    block: 0,
    resourcePool: 0,
    attackPool: 0,
    deck: [],
    hand: [],
    discard: [],
    played: [],
    venues: [],
    scheduleSlots: [null, null],
    reservedCard: null,
    ...overrides,
  };
}

/** 进入已开局状态（双方 READY 完成） */
function startedState(): InternalMatchState {
  const state = freshState();
  const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
  return reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);
}

// ── READY ─────────────────────────────────────────────────────────────────────

describe("reduce: READY", () => {
  it("第一个 READY 不开局", () => {
    const state = freshState();
    const result = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    expect(result.started).toBe(false);
    expect(result.readyPlayers[0]).toBe(true);
    expect(result.readyPlayers[1]).toBe(false);
  });

  it("双方 READY 后开局并发开局手牌", () => {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);

    expect(s2.started).toBe(true);
    expect(s2.players[0].hand).toHaveLength(RULESET.firstPlayerOpeningHand);
    expect(s2.players[1].hand).toHaveLength(RULESET.secondPlayerOpeningHand);
  });

  it("READY 幂等：重复发送不改变状态", () => {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    expect(s1).toEqual(s2);
  });

  it("开局后牌堆卡数 = 12 - 开局手牌数", () => {
    const state = freshState();
    const s1 = reduce(state, 0, { type: "READY" }, CONFIG, deterministicRandom, genId);
    const s2 = reduce(s1, 1, { type: "READY" }, CONFIG, deterministicRandom, genId);

    const totalCards = 12;
    expect(s2.players[0].deck).toHaveLength(totalCards - RULESET.firstPlayerOpeningHand);
    expect(s2.players[1].deck).toHaveLength(totalCards - RULESET.secondPlayerOpeningHand);
  });

  it("开局后先手回合为 side=0", () => {
    const s = startedState();
    expect(s.activePlayer).toBe(0);
  });
});

// ── END_TURN ──────────────────────────────────────────────────────────────────

describe("reduce: END_TURN", () => {
  it("切换行动方", () => {
    const state = startedState();
    const result = reduce(state, 0, { type: "END_TURN" }, CONFIG, deterministicRandom, genId);
    expect(result.activePlayer).toBe(1);
  });

  it("非行动方调用时抛出错误", () => {
    const state = startedState();
    expect(() =>
      reduce(state, 1, { type: "END_TURN" }, CONFIG, deterministicRandom, genId)
    ).toThrow();
  });

  it("尚未开局时调用抛出错误", () => {
    const state = freshState();
    expect(() =>
      reduce(state, 0, { type: "END_TURN" }, CONFIG, deterministicRandom, genId)
    ).toThrow();
  });

  it("side 1 结束后回合数 +1", () => {
    const state = startedState();
    expect(state.turnNumber).toBe(1);
    const s2 = reduce(state, 0, { type: "END_TURN" }, CONFIG, deterministicRandom, genId);
    expect(s2.turnNumber).toBe(1);
    const s3 = reduce(s2, 1, { type: "END_TURN" }, CONFIG, deterministicRandom, genId);
    expect(s3.turnNumber).toBe(2);
  });
});

// ── BUY_MARKET_CARD ───────────────────────────────────────────────────────────

describe("reduce: BUY_MARKET_CARD", () => {
  function stateWithMarketCard(): InternalMatchState {
    const marketCard: CardInstance = { instanceId: "market-inst-1", cardId: "market_card_1" };
    const s2 = startedState();
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...s2.players[0], resourcePool: 10 },
      s2.players[1],
    ];
    const market = [
      { lane: "course" as const, slots: [marketCard, null] },
      { lane: "activity" as const, slots: [null, null] },
      { lane: "daily" as const, slots: [null, null] },
    ];
    return { ...s2, players, market };
  }

  it("从商店槽移除卡牌，加入弃牌堆，扣除资源", () => {
    const state = stateWithMarketCard();
    const result = reduce(
      state,
      0,
      { type: "BUY_MARKET_CARD", instanceId: "market-inst-1" },
      CONFIG,
      deterministicRandom,
      genId
    );

    expect(result.market[0].slots[0]).toBeNull();
    expect(result.players[0].discard.some((c) => c.instanceId === "market-inst-1")).toBe(true);
    expect(result.players[0].resourcePool).toBe(6); // 10 - 4
  });

  it("商店中不存在时抛出错误", () => {
    const state = stateWithMarketCard();
    expect(() =>
      reduce(state, 0, { type: "BUY_MARKET_CARD", instanceId: "nonexistent" }, CONFIG)
    ).toThrow();
  });

  it("非行动方调用时抛出错误", () => {
    const state = stateWithMarketCard();
    expect(() =>
      reduce(state, 1, { type: "BUY_MARKET_CARD", instanceId: "market-inst-1" }, CONFIG)
    ).toThrow();
  });
});

// ── BUY_FIXED_SUPPLY ──────────────────────────────────────────────────────────

describe("reduce: BUY_FIXED_SUPPLY", () => {
  function stateWithResources(): InternalMatchState {
    const s2 = startedState();
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...s2.players[0], resourcePool: 10 },
      s2.players[1],
    ];
    return { ...s2, players };
  }

  it("生成新实例并加入弃牌堆，扣除资源", () => {
    const state = stateWithResources();
    const result = reduce(
      state,
      0,
      { type: "BUY_FIXED_SUPPLY", cardId: "supply_errand_runner" },
      CONFIG,
      deterministicRandom,
      genId
    );

    expect(result.players[0].discard).toHaveLength(1);
    expect(result.players[0].discard[0].cardId).toBe("supply_errand_runner");
    expect(result.players[0].resourcePool).toBe(7); // 10 - 3
  });

  it("cardId 不在 fixedSupplies 时抛出错误", () => {
    const state = stateWithResources();
    expect(() =>
      reduce(state, 0, { type: "BUY_FIXED_SUPPLY", cardId: "invalid_card" }, CONFIG)
    ).toThrow();
  });

  it("非行动方调用时抛出错误", () => {
    const state = stateWithResources();
    expect(() =>
      reduce(state, 1, { type: "BUY_FIXED_SUPPLY", cardId: "supply_errand_runner" }, CONFIG)
    ).toThrow();
  });
});

// ── CONCEDE ───────────────────────────────────────────────────────────────────

describe("reduce: CONCEDE", () => {
  it("side 0 投降 → winner = 1", () => {
    const state = freshState();
    const result = reduce(state, 0, { type: "CONCEDE" }, CONFIG);
    expect(result.ended).toBe(true);
    expect(result.winner).toBe(1);
  });

  it("side 1 投降 → winner = 0", () => {
    const state = freshState();
    const result = reduce(state, 1, { type: "CONCEDE" }, CONFIG);
    expect(result.ended).toBe(true);
    expect(result.winner).toBe(0);
  });
});

// ── PLAY_CARD ─────────────────────────────────────────────────────────────────

describe("reduce: PLAY_CARD", () => {
  /** 构造一个 side=0 手牌含指定卡牌的已开局状态 */
  function stateWithCardInHand(
    cardId: string,
    instanceId = "test-card-inst"
  ): InternalMatchState {
    const base = startedState();
    const card: CardInstance = { instanceId, cardId };
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...base.players[0], hand: [card], deck: [], resourcePool: 0, attackPool: 0, block: 0 },
      base.players[1],
    ];
    return { ...base, players };
  }

  it("零花钱：打出后获得 2 资源，卡牌移至 played 区", () => {
    const state = stateWithCardInHand("starter_allowance");
    const result = reduce(
      state,
      0,
      { type: "PLAY_CARD", instanceId: "test-card-inst" },
      CONFIG,
      deterministicRandom
    );

    expect(result.players[0].resourcePool).toBe(2);
    expect(result.players[0].hand).toHaveLength(0);
    expect(result.players[0].played).toHaveLength(1);
    expect(result.players[0].played[0].instanceId).toBe("test-card-inst");
  });

  it("争执（小摩擦）：打出后获得 1 攻击", () => {
    const state = stateWithCardInHand("starter_quarrel");
    const result = reduce(
      state,
      0,
      { type: "PLAY_CARD", instanceId: "test-card-inst" },
      CONFIG,
      deterministicRandom
    );

    expect(result.players[0].attackPool).toBe(1);
    expect(result.players[0].hand).toHaveLength(0);
  });

  it("守时习惯：打出后获得 1 资源 + 1 防备", () => {
    const state = stateWithCardInHand("starter_punctuality");
    const result = reduce(
      state,
      0,
      { type: "PLAY_CARD", instanceId: "test-card-inst" },
      CONFIG,
      deterministicRandom
    );

    expect(result.players[0].resourcePool).toBe(1);
    expect(result.players[0].block).toBe(1);
  });

  it("草稿纸：打出后摸 1 张牌（hand 从 0 变 1，played 有 1 张）", () => {
    const base = startedState();
    const draftPaper: CardInstance = { instanceId: "draft-inst", cardId: "starter_draft_paper" };
    // 给 side=0 额外的牌堆用于摸牌
    const deckCard: CardInstance = { instanceId: "deck-card-1", cardId: "starter_allowance" };
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...base.players[0], hand: [draftPaper], deck: [deckCard] },
      base.players[1],
    ];
    const state = { ...base, players };

    const result = reduce(
      state,
      0,
      { type: "PLAY_CARD", instanceId: "draft-inst" },
      CONFIG,
      deterministicRandom
    );

    // played 含草稿纸，hand 摸到 deckCard
    expect(result.players[0].played).toHaveLength(1);
    expect(result.players[0].hand).toHaveLength(1);
    expect(result.players[0].hand[0].instanceId).toBe("deck-card-1");
  });

  it("drawThenDiscard：摸 1 再弃 1，手牌数量不变", () => {
    const base = startedState();
    const testCard: CardInstance = { instanceId: "dtd-inst", cardId: "test_draw_then_discard" };
    const handCard: CardInstance = { instanceId: "hand-card-1", cardId: "starter_allowance" };
    const deckCard: CardInstance = { instanceId: "deck-card-1", cardId: "starter_quarrel" };
    const players: [InternalPlayerState, InternalPlayerState] = [
      // hand 含 testCard + handCard（共 2 张），deck 含 deckCard
      {
        ...base.players[0],
        hand: [testCard, handCard],
        deck: [deckCard],
      },
      base.players[1],
    ];
    const state = { ...base, players };

    const result = reduce(
      state,
      0,
      { type: "PLAY_CARD", instanceId: "dtd-inst" },
      CONFIG,
      deterministicRandom
    );

    // testCard 被打出 → played
    // 摸 1 张（deckCard 入 hand），再弃 1 张（handCard 弃置）
    expect(result.players[0].played).toHaveLength(1);
    // hand: handCard 被弃，deckCard 加入 → hand 剩 1 张（deckCard）
    expect(result.players[0].hand).toHaveLength(1);
    expect(result.players[0].hand[0].instanceId).toBe("deck-card-1");
    // discard 含 handCard
    expect(result.players[0].discard.some((c) => c.instanceId === "hand-card-1")).toBe(true);
  });

  it("手牌中不存在 instanceId 时抛出错误", () => {
    const state = startedState();
    expect(() =>
      reduce(state, 0, { type: "PLAY_CARD", instanceId: "nonexistent" }, CONFIG)
    ).toThrow();
  });

  it("非行动方打牌时抛出错误", () => {
    const state = stateWithCardInHand("starter_allowance");
    expect(() =>
      reduce(state, 1, { type: "PLAY_CARD", instanceId: "test-card-inst" }, CONFIG)
    ).toThrow();
  });
});

// ── ASSIGN_ATTACK ─────────────────────────────────────────────────────────────

describe("reduce: ASSIGN_ATTACK", () => {
  /** side=0 有 attackPool，side=1 有 block，便于测试 */
  function stateForAttack(
    attackPool: number,
    targetBlock: number,
    targetHp = 32
  ): InternalMatchState {
    const base = startedState();
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...base.players[0], attackPool },
      { ...base.players[1], block: targetBlock, hp: targetHp },
    ];
    return { ...base, players };
  }

  it("有 block 时先扣 block 再扣 hp", () => {
    const state = stateForAttack(5, 3); // attack=5, block=3
    const result = reduce(
      state,
      0,
      {
        type: "ASSIGN_ATTACK",
        assignments: [{ amount: 5, target: "player", targetSide: 1 }],
      },
      CONFIG
    );

    // block 3 吸收 3，剩余 2 扣 hp
    expect(result.players[1].block).toBe(0);
    expect(result.players[1].hp).toBe(30); // 32 - 2
    expect(result.players[0].attackPool).toBe(0);
  });

  it("block 完全吸收伤害时 hp 不变", () => {
    const state = stateForAttack(3, 5); // attack=3, block=5
    const result = reduce(
      state,
      0,
      {
        type: "ASSIGN_ATTACK",
        assignments: [{ amount: 3, target: "player", targetSide: 1 }],
      },
      CONFIG
    );

    expect(result.players[1].block).toBe(2); // 5 - 3
    expect(result.players[1].hp).toBe(32); // 未受伤
  });

  it("hp 归 0 时 ended=true 并决出 winner", () => {
    const state = stateForAttack(35, 0, 1); // attack=35, block=0, hp=1
    const result = reduce(
      state,
      0,
      {
        type: "ASSIGN_ATTACK",
        assignments: [{ amount: 35, target: "player", targetSide: 1 }],
      },
      CONFIG
    );

    expect(result.players[1].hp).toBeLessThanOrEqual(0);
    expect(result.ended).toBe(true);
    expect(result.winner).toBe(0);
  });

  it("攻击力不足时抛出错误", () => {
    const state = stateForAttack(2, 0); // attack=2
    expect(() =>
      reduce(state, 0, {
        type: "ASSIGN_ATTACK",
        assignments: [{ amount: 5, target: "player", targetSide: 1 }],
      }, CONFIG)
    ).toThrow();
  });

  it("非行动方调用时抛出错误", () => {
    const state = stateForAttack(5, 0);
    expect(() =>
      reduce(state, 1, {
        type: "ASSIGN_ATTACK",
        assignments: [{ amount: 3, target: "player", targetSide: 0 }],
      }, CONFIG)
    ).toThrow();
  });

  it("完整最小战斗流程：打牌获攻击 → 攻击对手 → 胜负判定", () => {
    // 给 side=0 一张争执在手牌
    const base = startedState();
    const quarrel: CardInstance = { instanceId: "q-inst", cardId: "starter_quarrel" };
    const players: [InternalPlayerState, InternalPlayerState] = [
      { ...base.players[0], hand: [quarrel], attackPool: 0 },
      { ...base.players[1], block: 0, hp: 1 }, // 只剩 1 hp
    ];
    let state = { ...base, players };

    // 打出争执 → attackPool = 1
    state = reduce(state, 0, { type: "PLAY_CARD", instanceId: "q-inst" }, CONFIG, deterministicRandom);
    expect(state.players[0].attackPool).toBe(1);

    // 攻击对手（hp=1, block=0） → 应该死亡
    state = reduce(
      state,
      0,
      {
        type: "ASSIGN_ATTACK",
        assignments: [{ amount: 1, target: "player", targetSide: 1 }],
      },
      CONFIG
    );

    expect(state.ended).toBe(true);
    expect(state.winner).toBe(0);
  });
});
