/**
 * cardMeta.test.ts — 客户端卡牌价格 / 稀有度元数据投影测试
 *
 * 覆盖：
 *  1. 市场牌价格命中规则 JSON 的 cost 字段
 *  2. starter / 固定补给价格命中
 *  3. 稀有度三档映射
 *  4. 未知 cardId 安全降级（cost/rarity → undefined）
 *  5. "显示价 == 服务端扣费价" 的口径一致性（与 rules JSON 同源）
 */
import { describe, it, expect } from "vitest";
import { getCardCost, getCardRarity, getCardMeta } from "../content/cardMeta";

describe("getCardCost — 价格命中规则数据", () => {
  it("市场牌：red_pre_match_warmup → 3", () => {
    expect(getCardCost("red_pre_match_warmup")).toBe(3);
  });

  it("市场稀有牌：green_makerspace → 5", () => {
    expect(getCardCost("green_makerspace")).toBe(5);
  });

  it("starter 牌价格为 0：starter_allowance → 0", () => {
    expect(getCardCost("starter_allowance")).toBe(0);
  });

  it("固定补给：supply_milk_bread → 2 / supply_print_materials → 4", () => {
    expect(getCardCost("supply_milk_bread")).toBe(2);
    expect(getCardCost("supply_print_materials")).toBe(4);
  });

  it("未知 cardId 返回 undefined（不误显为 0 费）", () => {
    expect(getCardCost("__not_a_real_card__")).toBeUndefined();
  });
});

describe("getCardRarity — 稀有度三档", () => {
  it("common", () => {
    expect(getCardRarity("red_pre_match_warmup")).toBe("common");
  });
  it("uncommon", () => {
    expect(getCardRarity("red_extra_training_plan")).toBe("uncommon");
  });
  it("rare", () => {
    expect(getCardRarity("green_makerspace")).toBe("rare");
  });
  it("未知 cardId 返回 undefined", () => {
    expect(getCardRarity("__nope__")).toBeUndefined();
  });
});

describe("getCardMeta — 聚合元数据", () => {
  it("返回 cost / rarity / type", () => {
    expect(getCardMeta("white_duty_student")).toEqual({
      cost: 3,
      rarity: "common",
      type: "venue",
    });
  });

  it("缓存稳定：多次调用返回同一份数据", () => {
    expect(getCardMeta("green_makerspace")).toEqual(getCardMeta("green_makerspace"));
  });
});
