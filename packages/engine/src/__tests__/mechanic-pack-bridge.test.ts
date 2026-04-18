import { describe, expect, it } from "vitest";
import { reduce } from "../reduce";
import type { CardDef } from "../effects";
import type { CardInstance, InternalMatchState, InternalPlayerState, VenueState } from "../types";
import type { EngineConfig } from "../reduce";
import { CMD } from "@dev-camcard/protocol";

let idSeq = 0;
const genId = () => `t-${idSeq++}`;
const random = () => 0;

function card(cardId: string, instanceId: string): CardInstance {
  return { cardId, instanceId };
}

function venue(instanceId: string): VenueState {
  return {
    instanceId,
    cardId: "white_counseling_room",
    owner: 0,
    isGuard: true,
    durability: 5,
    maxDurability: 5,
    activationsLeft: 1,
    activationsPerTurn: 1,
  };
}

function makePlayer(side: 0 | 1, overrides: Partial<InternalPlayerState> = {}): InternalPlayerState {
  return {
    side,
    name: `P${side}`,
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
    reservedCardTurn: null,
    hasReservedThisTurn: false,
    activeFlags: [],
    pendingDiscardCount: 0,
    ...overrides,
  };
}

const CARD_DEFS: Record<string, CardDef> = {
  red_morning_run_checklist: {
    id: "red_morning_run_checklist",
    type: "action",
    abilities: [
      { trigger: "onPlay", effects: [{ op: "gainAttack", amount: 1 }] },
      {
        trigger: "onPlay",
        condition: { type: "hasScheduledCard" },
        effects: [{ op: "gainAttack", amount: 2 }],
      },
    ],
  },
  blue_after_class_makeup_log: {
    id: "blue_after_class_makeup_log",
    type: "action",
    abilities: [
      { trigger: "onPlay", effects: [{ op: "draw", count: 1 }] },
      {
        trigger: "onPlay",
        condition: { type: "hasReservedCard" },
        effects: [{ op: "gainResource", amount: 1 }],
      },
    ],
  },
  white_student_council_meeting: {
    id: "white_student_council_meeting",
    type: "action",
    abilities: [
      { trigger: "onPlay", effects: [{ op: "gainBlock", amount: 1 }] },
      {
        trigger: "onPlay",
        condition: { type: "hasVenue" },
        effects: [{ op: "queueDelayedDiscard", count: 1, target: "opponent" }],
      },
    ],
  },
  blue_topic_defense: {
    id: "blue_topic_defense",
    type: "action",
    abilities: [
      { trigger: "onPlay", effects: [{ op: "draw", count: 2 }] },
      {
        trigger: "onPlay",
        condition: { type: "hasScheduledCard" },
        effects: [{ op: "gainFaceUpCard", maxCost: 3, destination: "deckTop" }],
      },
    ],
  },
  blue_course_grab_plugin: {
    id: "blue_course_grab_plugin",
    type: "action",
    abilities: [
      {
        trigger: "onPlay",
        effects: [
          { op: "gainResource", amount: 1 },
          { op: "setFlag", flag: "nextBoughtCardToDeckTop" },
        ],
      },
    ],
  },
  cheap_gain_target: {
    id: "cheap_gain_target",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "gainAttack", amount: 1 }] }],
  },
  reserve_target: {
    id: "reserve_target",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "gainResource", amount: 1 }] }],
  },
  filler: {
    id: "filler",
    type: "action",
    abilities: [{ trigger: "onPlay", effects: [{ op: "gainResource", amount: 1 }] }],
  },
};

const COSTS: Record<string, number> = {
  cheap_gain_target: 2,
  reserve_target: 4,
};

const CONFIG: EngineConfig = {
  ruleset: {
    id: "core-v1",
    hp: 32,
    handSize: 5,
    firstPlayerOpeningHand: 4,
    secondPlayerOpeningHand: 5,
    scheduleSlots: 2,
    reserveSlots: 1,
    marketLanesCount: 3,
    marketSlotsPerLane: 2,
    starterDeck: [],
    fixedSupplies: [],
  },
  getCardCost: (id) => COSTS[id] ?? 0,
  getCardDef: (id) => CARD_DEFS[id],
};

function makeState(p0?: Partial<InternalPlayerState>, p1?: Partial<InternalPlayerState>): InternalMatchState {
  return {
    roomId: "r-12-pack",
    rulesetId: "core-v1",
    turnNumber: 2,
    activePlayer: 0,
    players: [makePlayer(0, p0), makePlayer(1, p1)],
    market: [
      { lane: "activity", slots: [null, null], deck: [] },
      { lane: "course", slots: [null, null], deck: [] },
      { lane: "daily", slots: [null, null], deck: [] },
    ],
    fixedSupplies: [],
    readyPlayers: [true, true],
    started: true,
    ended: false,
    winner: null,
    pendingChoice: null,
  };
}

describe("机制牌接通（安排/预约/场馆/条件/flag）", () => {
  it("red_morning_run_checklist：有日程牌时额外 +2 攻击", () => {
    const run = card("red_morning_run_checklist", "run-1");
    const scheduled = card("filler", "scheduled-1");

    const state = makeState({ hand: [run], scheduleSlots: [scheduled, null] });
    const result = reduce(state, 0, { type: CMD.PLAY_CARD, instanceId: "run-1" }, CONFIG, random, genId);

    expect(result.players[0].attackPool).toBe(3);
  });

  it("blue_after_class_makeup_log：有预约牌时多拿 1 资源", () => {
    const cardInHand = card("blue_after_class_makeup_log", "blue-1");
    const reserved = card("reserve_target", "reserved-1");

    const state = makeState({ hand: [cardInHand], reservedCard: reserved, deck: [card("filler", "draw-1")] });
    const result = reduce(state, 0, { type: CMD.PLAY_CARD, instanceId: "blue-1" }, CONFIG, random, genId);

    expect(result.players[0].resourcePool).toBe(1);
    expect(result.players[0].hand.some((c) => c.instanceId === "draw-1")).toBe(true);
  });

  it("white_student_council_meeting：有场馆时给对手挂 1 层延迟弃牌", () => {
    const meeting = card("white_student_council_meeting", "w-1");
    const state = makeState({ hand: [meeting], venues: [venue("v-1")] });

    const result = reduce(state, 0, { type: CMD.PLAY_CARD, instanceId: "w-1" }, CONFIG, random, genId);

    expect(result.players[0].block).toBe(1);
    expect(result.players[1].pendingDiscardCount).toBe(1);
  });

  it("blue_topic_defense：有日程牌时触发 gainFaceUpCard，并可把选中牌放到牌库顶", () => {
    const defense = card("blue_topic_defense", "topic-1");
    const scheduled = card("filler", "scheduled-2");
    const gainTarget = card("cheap_gain_target", "shop-1");

    const state = makeState({ hand: [defense], scheduleSlots: [scheduled, null] });
    state.market[1].slots[0] = gainTarget;

    const withPending = reduce(
      state,
      0,
      { type: CMD.PLAY_CARD, instanceId: "topic-1" },
      CONFIG,
      random,
      genId
    );

    expect(withPending.pendingChoice?.type).toBe("gainFaceUpCardDecision");

    const resolved = reduce(
      withPending,
      0,
      { type: CMD.SUBMIT_CHOICE, selectedInstanceIds: ["shop-1"] },
      CONFIG,
      random,
      genId
    );

    expect(resolved.players[0].deck[0]?.cardId).toBe("cheap_gain_target");
    expect(resolved.market[1].slots[0]).toBeNull();
  });

  it("blue_course_grab_plugin：setFlag 对 BUY_RESERVED_CARD 同样生效（买到牌库顶）", () => {
    const flagCard = card("blue_course_grab_plugin", "flag-1");
    const reserved = card("reserve_target", "res-1");

    const state = makeState({
      hand: [flagCard],
      resourcePool: 10,
      reservedCard: reserved,
      reservedCardTurn: 1,
      deck: [card("filler", "deck-old")],
    });

    const afterPlay = reduce(state, 0, { type: CMD.PLAY_CARD, instanceId: "flag-1" }, CONFIG, random, genId);
    expect(afterPlay.players[0].activeFlags).toContain("nextBoughtCardToDeckTop");

    const afterBuyReserved = reduce(afterPlay, 0, { type: CMD.BUY_RESERVED_CARD }, CONFIG, random, genId);

    expect(afterBuyReserved.players[0].deck[0]?.cardId).toBe("reserve_target");
    expect(afterBuyReserved.players[0].discard.some((c) => c.cardId === "reserve_target")).toBe(false);
    expect(afterBuyReserved.players[0].activeFlags).not.toContain("nextBoughtCardToDeckTop");
  });
});
