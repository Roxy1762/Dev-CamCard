/**
 * content-system.test.ts
 *
 * 验证 v2 内容系统：
 *  1. v2 CardRule schema 校验
 *  2. CardText schema 校验
 *  3. Set / ContentPack schema 校验
 *  4. 所有新 data/cards/rules/*.json 校验通过
 *  5. 所有新 data/cards/text/**\/*.json 校验通过
 *  6. data/sets/core-v1.json 校验通过
 *  7. data/content-packs/base.json 校验通过
 *  8. content-loader 合并 + 降级逻辑
 *  9. 现有 card id 可继续加载（保持不变）
 */
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import {
  checkCardRule,
  checkCardText,
  checkSetManifest,
  checkContentPack,
} from "../validators";
import {
  loadCardRuleFile,
  loadCardTextFile,
  loadSetManifest,
  loadContentPackManifest,
  mergeCardDef,
  getCardText,
  loadRuleBatch,
  loadMergedBatch,
  type CardRuleData,
  type CardTextFile,
} from "../content-loader";

const REPO_ROOT = path.resolve(__dirname, "../../../../");
const DATA_ROOT = REPO_ROOT;
const CONTENT_FILES = [
  "starter.json",
  "fixed-supplies.json",
  "status.json",
  "market-core.json",
] as const;
const RULE_PATHS = CONTENT_FILES.map((f) => `data/cards/rules/${f}`);
const EN_TEXT_PATHS = CONTENT_FILES.map((f) => `data/cards/text/en-US/${f}`);

function loadJson(relPath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf-8"));
}

// ── 1. v2 CardRule schema 单元测试 ────────────────────────────────────────────

describe("v2 CardRule schema", () => {
  it("有效 action 卡通过", () => {
    const rule: CardRuleData = {
      id: "test_card",
      schemaVersion: 2,
      contentVersion: 1,
      cost: 2,
      rarity: "common",
      lane: "course",
      type: "action",
      tags: [],
      abilities: [
        { trigger: "onPlay", effects: [{ op: "gainResource", amount: 2 }] },
      ],
    };
    const r = checkCardRule(rule);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("有效 venue（含 isGuard）通过", () => {
    const rule: CardRuleData = {
      id: "test_venue",
      schemaVersion: 2,
      contentVersion: 1,
      cost: 3,
      rarity: "uncommon",
      lane: "activity",
      type: "venue",
      isGuard: true,
      durability: 4,
      activationsPerTurn: 1,
      tags: ["sport"],
      abilities: [
        { trigger: "onActivate", effects: [{ op: "gainBlock", amount: 1 }] },
      ],
    };
    expect(checkCardRule(rule).valid).toBe(true);
  });

  it("schemaVersion < 2 被拒绝", () => {
    const bad = { id: "x", schemaVersion: 1, contentVersion: 1, cost: 0, rarity: "common", lane: "course", type: "action", tags: [], abilities: [] };
    expect(checkCardRule(bad).valid).toBe(false);
  });

  it("含 name 字段（v1 混合格式）被 additionalProperties 拒绝", () => {
    const bad = { id: "x", schemaVersion: 2, contentVersion: 1, cost: 0, rarity: "common", lane: "course", type: "action", tags: [], abilities: [], name: "测试" };
    expect(checkCardRule(bad).valid).toBe(false);
  });

  it("含 text 字段（v1 混合格式）被 additionalProperties 拒绝", () => {
    const bad = { id: "x", schemaVersion: 2, contentVersion: 1, cost: 0, rarity: "common", lane: "course", type: "action", tags: [], abilities: [], text: { body: "x" } };
    expect(checkCardRule(bad).valid).toBe(false);
  });

  it("非白名单 op 被拒绝", () => {
    const bad = { id: "x", schemaVersion: 2, contentVersion: 1, cost: 0, rarity: "common", lane: "course", type: "action", tags: [], abilities: [{ trigger: "onPlay", effects: [{ op: "evilHack" }] }] };
    expect(checkCardRule(bad).valid).toBe(false);
  });
});

// ── 2. CardText schema 单元测试 ───────────────────────────────────────────────

describe("CardText schema", () => {
  it("有效文案文件通过", () => {
    const textFile: CardTextFile = {
      schemaVersion: 1,
      locale: "zh-CN",
      cards: {
        test_card: { name: "测试卡", body: "获得 2 资源。" },
      },
    };
    expect(checkCardText(textFile).valid).toBe(true);
  });

  it("locale 格式错误被拒绝", () => {
    const bad = { schemaVersion: 1, locale: "ZH", cards: {} };
    expect(checkCardText(bad).valid).toBe(false);
  });

  it("缺少 name 字段时失败", () => {
    const bad = { schemaVersion: 1, locale: "zh-CN", cards: { x: { body: "test" } } };
    expect(checkCardText(bad).valid).toBe(false);
  });

  it("reminder 允许 null", () => {
    const good = { schemaVersion: 1, locale: "zh-CN", cards: { x: { name: "X", body: "test", reminder: null } } };
    expect(checkCardText(good).valid).toBe(true);
  });
});

// ── 3. Set / ContentPack schema 单元测试 ─────────────────────────────────────

describe("SetManifest schema", () => {
  it("有效 set 通过", () => {
    const s = { schemaVersion: 1, id: "test-set", contentVersion: 1, cardIds: ["card_a"] };
    expect(checkSetManifest(s).valid).toBe(true);
  });

  it("空 cardIds 被拒绝", () => {
    const bad = { schemaVersion: 1, id: "test-set", contentVersion: 1, cardIds: [] };
    expect(checkSetManifest(bad).valid).toBe(false);
  });
});

describe("ContentPack schema", () => {
  it("有效 content pack 通过", () => {
    const cp = { schemaVersion: 1, id: "my-pack", contentVersion: 1, includes: { sets: ["core-v1"] } };
    expect(checkContentPack(cp).valid).toBe(true);
  });

  it("缺少 includes 被拒绝", () => {
    const bad = { schemaVersion: 1, id: "my-pack", contentVersion: 1 };
    expect(checkContentPack(bad).valid).toBe(false);
  });
});

// ── 4. data/cards/rules/*.json 全部通过 ───────────────────────────────────────

describe("data/cards/rules/ 文件校验", () => {
  const ruleFiles = [
    "data/cards/rules/starter.json",
    "data/cards/rules/fixed-supplies.json",
    "data/cards/rules/status.json",
    "data/cards/rules/market-core.json",
  ];

  for (const file of ruleFiles) {
    it(`${file} 全部通过 v2 CardRule schema`, () => {
      const cards = loadJson(file) as unknown[];
      expect(Array.isArray(cards)).toBe(true);
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        const result = checkCardRule(card);
        if (!result.valid) {
          const c = card as { id?: string };
          throw new Error(`${file} [${c.id ?? "?"}] 校验失败:\n${result.errors.join("\n")}`);
        }
        expect(result.valid).toBe(true);
      }
    });
  }
});

// ── 5. data/cards/text/**/*.json 全部通过 ─────────────────────────────────────

describe("data/cards/text/ 文件校验", () => {
  const textFiles = [
    "data/cards/text/zh-CN/starter.json",
    "data/cards/text/zh-CN/fixed-supplies.json",
    "data/cards/text/zh-CN/status.json",
    "data/cards/text/zh-CN/market-core.json",
    "data/cards/text/en-US/starter.json",
    "data/cards/text/en-US/fixed-supplies.json",
    "data/cards/text/en-US/status.json",
    "data/cards/text/en-US/market-core.json",
  ];

  for (const file of textFiles) {
    it(`${file} 通过 CardText schema`, () => {
      const content = loadJson(file);
      const result = checkCardText(content);
      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    });
  }
});

// ── 6. data/sets/ 通过 ───────────────────────────────────────────────────────

describe("data/sets/ 文件校验", () => {
  it("data/sets/core-v1.json 通过", () => {
    const s = loadJson("data/sets/core-v1.json");
    const r = checkSetManifest(s);
    expect(r.errors).toHaveLength(0);
    expect(r.valid).toBe(true);
  });

  it("core-v1 包含全部 38 张卡牌（starter+supply+status+market）", () => {
    const s = loadJson("data/sets/core-v1.json") as { cardIds: string[] };
    expect(s.cardIds.length).toBe(38);
    expect(s.cardIds).toContain("green_used_book_recycle");
    expect(s.cardIds).toContain("blue_draft_simulation");
    expect(s.cardIds).toContain("green_anniversary_sponsor");
    expect(s.cardIds).toContain("red_cheer_combo");
    expect(s.cardIds).toContain("green_find_sponsorship");
    expect(s.cardIds).toContain("green_planning_meeting");
    expect(s.cardIds).toContain("neutral_campus_broadcast");
  });
});

describe("market-core 新增能力牌最小校验", () => {
  function loadMarketRules() {
    return loadCardRuleFile(DATA_ROOT, "data/cards/rules/market-core.json");
  }

  it("green_find_sponsorship 使用 gainFaceUpCard（maxCost=3，discard）", () => {
    const rules = loadMarketRules();
    const card = rules.find((c) => c.id === "green_find_sponsorship");
    expect(card).toBeDefined();
    const onPlay = card!.abilities.find((a) => a.trigger === "onPlay");
    expect(onPlay?.effects).toContainEqual({
      op: "gainFaceUpCard",
      maxCost: 3,
      destination: "discard",
    });
  });

  it("green_planning_meeting 使用 gainFaceUpCard（maxCost=2，deckTop）", () => {
    const rules = loadMarketRules();
    const card = rules.find((c) => c.id === "green_planning_meeting");
    expect(card).toBeDefined();
    const onPlay = card!.abilities.find((a) => a.trigger === "onPlay");
    expect(onPlay?.effects).toContainEqual({
      op: "gainFaceUpCard",
      maxCost: 2,
      destination: "deckTop",
    });
  });

  it("neutral_campus_broadcast 使用 chooseTarget(opponentPlayer + dealDamage)", () => {
    const rules = loadMarketRules();
    const card = rules.find((c) => c.id === "neutral_campus_broadcast");
    expect(card).toBeDefined();
    const onPlay = card!.abilities.find((a) => a.trigger === "onPlay");
    expect(onPlay?.effects).toContainEqual({
      op: "chooseTarget",
      targetType: "opponentPlayer",
      onChosen: [{ op: "dealDamage", amount: 2 }],
    });
  });

  it("red_finals_day 使用 chooseTarget(opponentVenue + damageVenue)", () => {
    const rules = loadMarketRules();
    const card = rules.find((c) => c.id === "red_finals_day");
    expect(card).toBeDefined();
    const onPlay = card!.abilities.find((a) => a.trigger === "onPlay");
    expect(onPlay?.effects).toContainEqual({
      op: "chooseTarget",
      targetType: "opponentVenue",
      onChosen: [{ op: "damageVenue", amount: 3 }],
    });
  });
});

// ── 7. data/content-packs/ 通过 ──────────────────────────────────────────────

describe("data/content-packs/ 文件校验", () => {
  it("data/content-packs/base.json 通过", () => {
    const cp = loadJson("data/content-packs/base.json");
    const r = checkContentPack(cp);
    expect(r.errors).toHaveLength(0);
    expect(r.valid).toBe(true);
  });
});

// ── 8. content-loader 合并与降级 ──────────────────────────────────────────────

describe("content-loader", () => {
  it("loadCardRuleFile 正确加载规则数组", () => {
    const rules = loadCardRuleFile(DATA_ROOT, "data/cards/rules/starter.json");
    expect(rules).toHaveLength(4);
    expect(rules[0].schemaVersion).toBe(2);
    expect(typeof rules[0].abilities).toBe("object");
    // 确认无 name/text 字段
    expect((rules[0] as unknown as { name?: string }).name).toBeUndefined();
    expect((rules[0] as unknown as { text?: unknown }).text).toBeUndefined();
  });

  it("loadCardTextFile 正确加载 zh-CN 文案", () => {
    const tf = loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/starter.json");
    expect(tf).not.toBeNull();
    expect(tf!.locale).toBe("zh-CN");
    expect(tf!.cards["starter_allowance"].name).toBe("零花钱");
  });

  it("loadCardTextFile 文件不存在时返回 null", () => {
    const tf = loadCardTextFile(DATA_ROOT, "data/cards/text/xx-XX/nonexistent.json");
    expect(tf).toBeNull();
  });

  it("mergeCardDef 正确合并规则 + 文案", () => {
    const rules = loadCardRuleFile(DATA_ROOT, "data/cards/rules/starter.json");
    const tf = loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/starter.json");
    const merged = mergeCardDef(rules[0], tf);
    expect(merged.name).toBe("零花钱");
    expect(merged.text.body).toBe("获得 2 资源。");
    expect(merged.cost).toBe(0);
    expect(merged.schemaVersion).toBe(2);
  });

  it("mergeCardDef 文案缺失时安全降级（name=id, body=''）", () => {
    const rules = loadCardRuleFile(DATA_ROOT, "data/cards/rules/starter.json");
    const merged = mergeCardDef(rules[0], null);
    expect(merged.name).toBe(rules[0].id);
    expect(merged.text.body).toBe("");
  });

  it("mergeCardDef 文案文件无对应 id 时安全降级", () => {
    const rule: CardRuleData = { id: "unknown_card", schemaVersion: 2, contentVersion: 1, cost: 0, rarity: "common", lane: "course", type: "action", tags: [], abilities: [] };
    const tf: CardTextFile = { schemaVersion: 1, locale: "zh-CN", cards: {} };
    const merged = mergeCardDef(rule, tf);
    expect(merged.name).toBe("unknown_card");
    expect(merged.text.body).toBe("");
  });

  it("getCardText 存在时返回文案", () => {
    const tf = loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/starter.json");
    const entry = getCardText(tf, "starter_quarrel");
    expect(entry.name).toBe("争执");
  });

  it("getCardText 不存在时返回降级值", () => {
    const entry = getCardText(null, "some_card");
    expect(entry.name).toBe("some_card");
    expect(entry.body).toBe("");
  });

  it("loadRuleBatch 批量加载并拍平", () => {
    const rules = loadRuleBatch(DATA_ROOT, [
      "data/cards/rules/starter.json",
      "data/cards/rules/fixed-supplies.json",
    ]);
    expect(rules.length).toBe(7); // 4 starter + 3 supply
  });

  it("loadMergedBatch 批量合并", () => {
    const merged = loadMergedBatch(DATA_ROOT, [
      { rules: "data/cards/rules/starter.json", text: "data/cards/text/zh-CN/starter.json" },
    ]);
    expect(merged.length).toBe(4);
    expect(merged.every((m) => typeof m.name === "string" && m.name.length > 0)).toBe(true);
  });

  it("loadMergedBatch 在 locale 文件缺失时使用降级文案", () => {
    const merged = loadMergedBatch(DATA_ROOT, [
      { rules: "data/cards/rules/starter.json", text: "data/cards/text/fr-FR/starter.json" },
    ]);
    expect(merged.length).toBe(4);
    expect(merged[0].name).toBe(merged[0].id);
    expect(merged[0].text.body).toBe("");
  });

  it("loadSetManifest 正确加载", () => {
    const s = loadSetManifest(DATA_ROOT, "data/sets/core-v1.json");
    expect(s.id).toBe("core-v1");
    expect(s.cardIds.length).toBeGreaterThan(0);
  });

  it("loadContentPackManifest 正确加载", () => {
    const cp = loadContentPackManifest(DATA_ROOT, "data/content-packs/base.json");
    expect(cp.id).toBe("base");
    expect(cp.includes.sets).toContain("core-v1");
  });
});

// ── 9. 现有 card id 可继续加载（card-catalog.md 中的 id 不变）────────────────

describe("card id 稳定性（card-catalog.md）", () => {
  const EXPECTED_IDS = [
    // starter
    "starter_allowance", "starter_quarrel", "starter_draft_paper", "starter_punctuality",
    // supply
    "supply_errand_runner", "supply_milk_bread", "supply_print_materials",
    // status
    "status_pressure",
    // market
    "red_pre_match_warmup", "red_extra_training_plan",
    "blue_all_night_study",
    "white_duty_student", "white_discipline_week",
    "white_discipline_warning", "white_dorm_inspection", "white_student_affairs_talk",
    "green_makerspace",
    "neutral_class_representative_notice", "neutral_finals_week",
  ];

  it("所有预期 id 均可在 rules 目录中找到", () => {
    const allRules = loadRuleBatch(DATA_ROOT, [
      "data/cards/rules/starter.json",
      "data/cards/rules/fixed-supplies.json",
      "data/cards/rules/status.json",
      "data/cards/rules/market-core.json",
    ]);
    const foundIds = new Set(allRules.map((r) => r.id));
    for (const id of EXPECTED_IDS) {
      expect(foundIds.has(id), `id "${id}" 应存在于 rules 目录`).toBe(true);
    }
  });

  it("所有预期 id 均有 zh-CN 文案", () => {
    const allText: CardTextFile = {
      schemaVersion: 1,
      locale: "zh-CN",
      cards: {
        ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/starter.json")!.cards,
        ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/fixed-supplies.json")!.cards,
        ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/status.json")!.cards,
        ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/market-core.json")!.cards,
      },
    };
    for (const id of EXPECTED_IDS) {
      expect(allText.cards[id], `id "${id}" 应有 zh-CN 文案`).toBeDefined();
      expect(allText.cards[id].name.length).toBeGreaterThan(0);
    }
  });

  it("rules 目录 id 与 zh-CN 文案目录 id 完全匹配", () => {
    const allRules = loadRuleBatch(DATA_ROOT, RULE_PATHS);
    const allText: Record<string, unknown> = {
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/starter.json")!.cards,
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/fixed-supplies.json")!.cards,
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/status.json")!.cards,
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/zh-CN/market-core.json")!.cards,
    };
    for (const rule of allRules) {
      expect(allText[rule.id], `规则 id "${rule.id}" 缺少 zh-CN 文案`).toBeDefined();
    }
  });

  it("rules 目录 id 与 en-US 文案目录 id 完全匹配（便于最小英文占位）", () => {
    const allRules = loadRuleBatch(DATA_ROOT, RULE_PATHS);
    const allText: Record<string, unknown> = {
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/en-US/starter.json")!.cards,
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/en-US/fixed-supplies.json")!.cards,
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/en-US/status.json")!.cards,
      ...loadCardTextFile(DATA_ROOT, "data/cards/text/en-US/market-core.json")!.cards,
    };
    for (const rule of allRules) {
      expect(allText[rule.id], `规则 id "${rule.id}" 缺少 en-US 文案`).toBeDefined();
    }
  });

  it("en-US 文案 name/body 不为空（最小英文占位可用）", () => {
    for (const relPath of EN_TEXT_PATHS) {
      const tf = loadCardTextFile(DATA_ROOT, relPath)!;
      for (const [id, text] of Object.entries(tf.cards)) {
        expect(text.name.trim().length, `${relPath} -> ${id} name 不能为空`).toBeGreaterThan(0);
        expect(text.body.trim().length, `${relPath} -> ${id} body 不能为空`).toBeGreaterThan(0);
      }
    }
  });

  it("rules 目录所有卡牌均显式声明 artKey，且默认与 id 一致", () => {
    const allRules = loadRuleBatch(DATA_ROOT, RULE_PATHS);
    for (const rule of allRules) {
      expect(typeof rule.artKey).toBe("string");
      expect(rule.artKey!.length).toBeGreaterThan(0);
      expect(rule.artKey).toBe(rule.id);
    }
  });

  it("loadMergedBatch 缺失 locale 文件时回退到 id / 空 body", () => {
    const missingLocaleBatches = CONTENT_FILES.map((f) => ({
      rules: `data/cards/rules/${f}`,
      text: `data/cards/text/xx-XX/${f}`,
    }));
    const merged = loadMergedBatch(DATA_ROOT, missingLocaleBatches);
    expect(merged.length).toBeGreaterThan(0);
    for (const card of merged) {
      expect(card.name).toBe(card.id);
      expect(card.text.body).toBe("");
    }
  });
});
