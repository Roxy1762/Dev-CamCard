import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import {
  checkCardDef,
  checkRulesetDef,
  checkModManifest,
} from "../validators";

// 从 packages/schemas/src/__tests__/ 向上 4 层到达仓库根目录
const REPO_ROOT = path.resolve(__dirname, "../../../../");

function loadJson(relPath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relPath), "utf-8")
  );
}

// ── CardDef 校验 ──────────────────────────────────────────────────────────────

describe("CardDef 校验", () => {
  it("有效 action 卡牌能通过", () => {
    const card = {
      id: "test_card",
      version: 1,
      name: "测试卡",
      cost: 2,
      rarity: "common",
      lane: "course",
      type: "action",
      tags: [],
      text: { body: "获得 2 资源。" },
      abilities: [
        { trigger: "onPlay", effects: [{ op: "gainResource", amount: 2 }] },
      ],
    };
    const result = checkCardDef(card);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("有效 venue 卡牌（含 venueKind）能通过", () => {
    const card = {
      id: "test_venue",
      version: 1,
      name: "测试场馆",
      cost: 3,
      rarity: "advanced",
      lane: "activity",
      type: "venue",
      venueKind: "normal",
      durability: 3,
      tags: ["sports"],
      text: { body: "启动：获得 1 攻击。" },
      abilities: [
        { trigger: "onActivate", effects: [{ op: "gainAttack", amount: 1 }] },
      ],
    };
    const result = checkCardDef(card);
    expect(result.valid).toBe(true);
  });

  it("type=venue 但缺少 venueKind 时失败", () => {
    const card = {
      id: "test_venue_no_kind",
      version: 1,
      name: "场馆缺字段",
      cost: 3,
      rarity: "common",
      lane: "activity",
      type: "venue",
      // 故意缺少 venueKind
      text: { body: "测试。" },
      abilities: [],
    };
    const result = checkCardDef(card);
    expect(result.valid).toBe(false);
  });

  it("非白名单 effect opcode 被拒绝", () => {
    const card = {
      id: "test_invalid_op",
      version: 1,
      name: "非法效果",
      cost: 0,
      rarity: "common",
      lane: "course",
      type: "action",
      tags: [],
      text: { body: "非法操作。" },
      abilities: [
        {
          trigger: "onPlay",
          effects: [{ op: "deleteDatabase" }], // 非白名单 op
        },
      ],
    };
    const result = checkCardDef(card);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("op"))).toBe(true);
  });

  it("缺少必填字段 (name) 时失败", () => {
    const card = {
      id: "test_no_name",
      version: 1,
      // name 缺失
      cost: 0,
      rarity: "common",
      lane: "course",
      type: "action",
      text: { body: "无名卡。" },
    };
    const result = checkCardDef(card);
    expect(result.valid).toBe(false);
  });

  it("id 含非法字符时失败", () => {
    const card = {
      id: "UPPER_CASE",
      version: 1,
      name: "大写 ID",
      cost: 0,
      rarity: "common",
      lane: "course",
      type: "action",
      text: { body: "测试。" },
    };
    const result = checkCardDef(card);
    expect(result.valid).toBe(false);
  });
});

// ── RulesetDef 校验 ───────────────────────────────────────────────────────────

describe("RulesetDef 校验", () => {
  it("有效 ruleset 能通过", () => {
    const ruleset = {
      id: "test-ruleset",
      version: 1,
      name: "测试规则集",
      hp: 32,
      handSize: 5,
      firstPlayerOpeningHand: 4,
      secondPlayerOpeningHand: 5,
      scheduleSlots: 2,
      reserveSlots: 1,
      marketLanesCount: 3,
      marketSlotsPerLane: 2,
      starterDeck: [{ cardId: "starter_allowance", count: 7 }],
      fixedSupplies: ["supply_errand_runner"],
    };
    const result = checkRulesetDef(ruleset);
    expect(result.valid).toBe(true);
  });

  it("hp 为负数时失败", () => {
    const ruleset = {
      id: "bad-ruleset",
      version: 1,
      name: "坏规则集",
      hp: -1,
      handSize: 5,
      firstPlayerOpeningHand: 4,
      secondPlayerOpeningHand: 5,
      scheduleSlots: 2,
      reserveSlots: 1,
      marketLanesCount: 3,
      marketSlotsPerLane: 2,
      starterDeck: [{ cardId: "starter_allowance", count: 7 }],
      fixedSupplies: [],
    };
    const result = checkRulesetDef(ruleset);
    expect(result.valid).toBe(false);
  });
});

// ── ModManifest 校验 ──────────────────────────────────────────────────────────

describe("ModManifest 校验", () => {
  it("有效 mod manifest 能通过", () => {
    const manifest = {
      id: "test-mod",
      version: "1.0.0",
      name: "测试 Mod",
      description: "一个测试 mod",
      cards: ["data/cards/my-card.json"],
    };
    const result = checkModManifest(manifest);
    expect(result.valid).toBe(true);
  });
});

// ── 加载并校验真实数据文件 ────────────────────────────────────────────────────

describe("首批数据文件校验", () => {
  it("data/cards/starter.json 全部通过", () => {
    const cards = loadJson("data/cards/starter.json") as unknown[];
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(4); // card-catalog.md 定义的 4 种起始牌
    for (const card of cards) {
      const result = checkCardDef(card);
      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    }
  });

  it("data/cards/fixed-supplies.json 全部通过", () => {
    const cards = loadJson("data/cards/fixed-supplies.json") as unknown[];
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(3); // 3 个固定补给
    for (const card of cards) {
      const result = checkCardDef(card);
      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    }
  });

  it("data/cards/status.json 全部通过", () => {
    const cards = loadJson("data/cards/status.json") as unknown[];
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(1); // status_pressure
    for (const card of cards) {
      const result = checkCardDef(card);
      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    }
  });

  it("data/rulesets/core-v1.json 通过", () => {
    const ruleset = loadJson("data/rulesets/core-v1.json");
    const result = checkRulesetDef(ruleset);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("core-v1 starter deck 总数 = 12", () => {
    const ruleset = loadJson("data/rulesets/core-v1.json") as {
      starterDeck: Array<{ cardId: string; count: number }>;
    };
    const total = ruleset.starterDeck.reduce((acc, e) => acc + e.count, 0);
    expect(total).toBe(12); // game-rules.md: 起始套牌 12 张
  });

  it("所有 starter card ID 与 card-catalog.md 一致", () => {
    const EXPECTED_STARTER_IDS = [
      "starter_allowance",
      "starter_quarrel",
      "starter_draft_paper",
      "starter_punctuality",
    ];
    const cards = loadJson("data/cards/starter.json") as Array<{ id: string }>;
    const ids = cards.map((c) => c.id);
    for (const expected of EXPECTED_STARTER_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it("所有 supply card ID 与 card-catalog.md 一致", () => {
    const EXPECTED_SUPPLY_IDS = [
      "supply_errand_runner",
      "supply_milk_bread",
      "supply_print_materials",
    ];
    const cards = loadJson("data/cards/fixed-supplies.json") as Array<{
      id: string;
    }>;
    const ids = cards.map((c) => c.id);
    for (const expected of EXPECTED_SUPPLY_IDS) {
      expect(ids).toContain(expected);
    }
  });
});
