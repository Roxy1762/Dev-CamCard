/**
 * locale.test.ts — clientLocale 最小验证测试
 *
 * 覆盖：
 *  1. zh-CN locale 命中文案 — 返回中文名称
 *  2. en-US locale 命中文案 — 返回英文名称
 *  3. locale 缺失的 cardId 时正确回退（Map 中无此 key）
 *  4. buildCardNames 返回 Map 类型
 *  5. ViewModel getCardName 消费真实内容层名字（闭环测试）
 */
import { describe, it, expect } from "vitest";
import { buildCardNames, buildCardTexts, DEFAULT_LOCALE } from "../content/clientLocale";
import type { PublicMatchView, PrivatePlayerView } from "@dev-camcard/protocol";
import { buildBoardViewModel } from "../viewmodel/BoardViewModel";

// ── 1. zh-CN locale 命中文案 ──────────────────────────────────────────────────

describe("buildCardNames — zh-CN", () => {
  const names = buildCardNames("zh-CN");

  it("返回 Map 实例", () => {
    expect(names).toBeInstanceOf(Map);
  });

  it("starter_allowance → 零花钱", () => {
    expect(names.get("starter_allowance")).toBe("零花钱");
  });

  it("starter_quarrel → 争执", () => {
    expect(names.get("starter_quarrel")).toBe("争执");
  });

  it("supply_milk_bread → 牛奶面包", () => {
    expect(names.get("supply_milk_bread")).toBe("牛奶面包");
  });

  it("status_pressure → 压力", () => {
    expect(names.get("status_pressure")).toBe("压力");
  });
});

// ── 2. en-US locale 命中文案 ──────────────────────────────────────────────────

describe("buildCardNames — en-US", () => {
  const names = buildCardNames("en-US");

  it("starter_allowance — en-US 有占位名称", () => {
    // en-US 文案有内容时不为空；若为占位则 Map 有该 key
    const name = names.get("starter_allowance");
    expect(typeof name).toBe("string");
    expect(name!.length).toBeGreaterThan(0);
  });
});

// ── 3. 缺失 cardId 时正确回退 ─────────────────────────────────────────────────

describe("buildCardNames — 缺失 cardId 回退", () => {
  it("Map 中不存在 unknown_card_xyz", () => {
    const names = buildCardNames("zh-CN");
    expect(names.has("unknown_card_xyz")).toBe(false);
  });

  it("DEFAULT_LOCALE 为 zh-CN", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });
});

// ── 4. ViewModel 闭环：getCardName 消费真实内容层名字 ─────────────────────────

describe("ViewModel 消费真实内容层名字", () => {
  function makePlayer(side: 0 | 1) {
    return {
      side,
      name: `玩家${side + 1}`,
      hp: 30, block: 0, deckSize: 10, handSize: 5,
      discardSize: 0, resourcePool: 0, attackPool: 0,
      venues: [], scheduleSlots: [null, null],
      reservedCard: null, hasReservedThisTurn: false, pendingDiscardCount: 0,
    };
  }
  const pub: PublicMatchView = {
    roomId: "r", turnNumber: 1, activePlayer: 0,
    players: [makePlayer(0), makePlayer(1)],
    market: [], fixedSupplies: [],
    started: true, ended: false, winner: null, pendingChoiceSide: null,
  };
  const priv: PrivatePlayerView = {
    side: 0, hand: [], discard: [], pendingChoice: null,
  };

  it("getCardName 使用真实 locale 文案 — 已命中", () => {
    const cardNames = buildCardNames("zh-CN");
    const vm = buildBoardViewModel(pub, priv, cardNames);
    expect(vm.getCardName("starter_allowance")).toBe("零花钱");
  });

  it("getCardName 未知 cardId 降级返回 cardId", () => {
    const cardNames = buildCardNames("zh-CN");
    const vm = buildBoardViewModel(pub, priv, cardNames);
    expect(vm.getCardName("no_such_card")).toBe("no_such_card");
  });
});

// ── 5. buildCardTexts 提供完整文案，供商店预览消费 ────────────────────────────

describe("buildCardTexts — 商店预览数据源", () => {
  const texts = buildCardTexts("zh-CN");

  it("返回 Map 类型", () => {
    expect(texts).toBeInstanceOf(Map);
  });

  it("starter_allowance.body 命中规则文案", () => {
    const entry = texts.get("starter_allowance");
    expect(entry).toBeTruthy();
    expect(entry!.body.length).toBeGreaterThan(0);
  });

  it("status_pressure.reminder 透传", () => {
    const entry = texts.get("status_pressure");
    expect(entry?.reminder).toBeTruthy();
  });

  it("ViewModel.getCardText 命中时返回完整文案，未命中时降级 null", () => {
    const pub: PublicMatchView = {
      roomId: "r", turnNumber: 1, activePlayer: 0,
      players: [
        { side: 0, name: "p1", hp: 30, block: 0, deckSize: 10, handSize: 5,
          discardSize: 0, resourcePool: 0, attackPool: 0, venues: [],
          scheduleSlots: [null, null], reservedCard: null,
          hasReservedThisTurn: false, pendingDiscardCount: 0 },
        { side: 1, name: "p2", hp: 30, block: 0, deckSize: 10, handSize: 5,
          discardSize: 0, resourcePool: 0, attackPool: 0, venues: [],
          scheduleSlots: [null, null], reservedCard: null,
          hasReservedThisTurn: false, pendingDiscardCount: 0 },
      ],
      market: [], fixedSupplies: [],
      started: true, ended: false, winner: null, pendingChoiceSide: null,
    };
    const priv: PrivatePlayerView = { side: 0, hand: [], discard: [], pendingChoice: null };
    const vm = buildBoardViewModel(pub, priv, undefined, texts);
    expect(vm.getCardText("starter_allowance")?.name).toBe("零花钱");
    expect(vm.getCardText("no_such_card")).toBeNull();
  });
});
