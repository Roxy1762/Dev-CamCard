/**
 * schema.test.ts — 最小卡牌 JSON 数据合法性验证。
 *
 * 不引入 AJV（AJV 校验留待后续实现），
 * 此处对 data/cards/*.json 做结构性断言：
 *  - id: string
 *  - version: number
 *  - cost: number (>= 0)
 *  - type: "action" | "venue"
 *  - abilities: array
 *  - tags: array
 *
 * 同时验证白色体系新增牌数据的正确性。
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// 从项目根相对定位 data 目录
const DATA_ROOT = path.resolve(__dirname, "../../../../data/cards");

function loadCards(filename: string): unknown[] {
  const fullPath = path.join(DATA_ROOT, filename);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as unknown[];
}

// ── 通用 schema 检查 ──────────────────────────────────────────────────────────

function assertCardShape(card: unknown, context: string): void {
  const c = card as Record<string, unknown>;

  expect(typeof c.id, `${context}.id 必须是字符串`).toBe("string");
  expect((c.id as string).length > 0, `${context}.id 不能为空`).toBe(true);

  expect(typeof c.version, `${context}.version 必须是数字`).toBe("number");

  expect(typeof c.cost, `${context}.cost 必须是数字`).toBe("number");
  expect((c.cost as number) >= 0, `${context}.cost 不能为负`).toBe(true);

  expect(
    c.type === "action" || c.type === "venue",
    `${context}.type 必须是 "action" 或 "venue"`
  ).toBe(true);

  expect(Array.isArray(c.abilities), `${context}.abilities 必须是数组`).toBe(true);
  expect(Array.isArray(c.tags), `${context}.tags 必须是数组`).toBe(true);

  // abilities 内每项检查 trigger + effects
  for (const ability of c.abilities as unknown[]) {
    const a = ability as Record<string, unknown>;
    expect(
      ["onPlay", "onScheduleResolve", "onActivate"].includes(a.trigger as string),
      `${context} ability.trigger 无效: ${a.trigger}`
    ).toBe(true);
    expect(Array.isArray(a.effects), `${context} ability.effects 必须是数组`).toBe(true);
  }
}

// ── 文件级别测试 ──────────────────────────────────────────────────────────────

describe("card schema: starter.json", () => {
  const cards = loadCards("starter.json");
  it("至少有 4 条记录", () => expect(cards.length).toBeGreaterThanOrEqual(4));
  it.each(cards)("$id 合法", (card) => assertCardShape(card, (card as { id: string }).id));
});

describe("card schema: fixed-supplies.json", () => {
  const cards = loadCards("fixed-supplies.json");
  it("至少有 3 条记录", () => expect(cards.length).toBeGreaterThanOrEqual(3));
  it.each(cards)("$id 合法", (card) => assertCardShape(card, (card as { id: string }).id));
});

describe("card schema: market-core.json", () => {
  const cards = loadCards("market-core.json");
  it("至少有 11 条记录（原 7 + 新增 4）", () => expect(cards.length).toBeGreaterThanOrEqual(11));
  it.each(cards)("$id 合法", (card) => assertCardShape(card, (card as { id: string }).id));

  // 验证白色体系新增牌存在
  const ids = (cards as Array<{ id: string }>).map((c) => c.id);
  it("包含 white_discipline_warning", () => expect(ids).toContain("white_discipline_warning"));
  it("包含 white_dorm_inspection", () => expect(ids).toContain("white_dorm_inspection"));
  it("包含 white_student_affairs_talk", () => expect(ids).toContain("white_student_affairs_talk"));
  it("包含 neutral_finals_week", () => expect(ids).toContain("neutral_finals_week"));
  it("包含 white_discipline_week（原有）", () => expect(ids).toContain("white_discipline_week"));
});

describe("card schema: status.json", () => {
  const cards = loadCards("status.json");
  it("包含 status_pressure", () => {
    const ids = (cards as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("status_pressure");
  });
  it("status_pressure 有 isPressure=true 标记", () => {
    const sp = (cards as Array<{ id: string; isPressure?: boolean }>).find(
      (c) => c.id === "status_pressure"
    );
    expect(sp?.isPressure).toBe(true);
  });
});

// ── 白色体系牌效果验证 ─────────────────────────────────────────────────────────

describe("white card abilities", () => {
  const cards = loadCards("market-core.json") as Array<{
    id: string;
    abilities: Array<{
      trigger: string;
      effects: Array<{ op: string; count?: number; target?: string; amount?: number }>;
    }>;
  }>;

  function findCard(id: string) {
    const c = cards.find((c) => c.id === id);
    expect(c, `应存在卡牌 ${id}`).toBeDefined();
    return c!;
  }

  it("white_discipline_warning: createPressure(opponent,1) + gainBlock(2)", () => {
    const c = findCard("white_discipline_warning");
    const effects = c.abilities[0].effects;
    expect(effects).toContainEqual({ op: "createPressure", count: 1, target: "opponent" });
    expect(effects).toContainEqual({ op: "gainBlock", amount: 2 });
  });

  it("white_dorm_inspection: createPressure(opponent,2) + gainBlock(1)", () => {
    const c = findCard("white_dorm_inspection");
    const effects = c.abilities[0].effects;
    expect(effects).toContainEqual({ op: "createPressure", count: 2, target: "opponent" });
    expect(effects).toContainEqual({ op: "gainBlock", amount: 1 });
  });

  it("white_student_affairs_talk: createPressure(opponent,3) + gainBlock(3)", () => {
    const c = findCard("white_student_affairs_talk");
    const effects = c.abilities[0].effects;
    expect(effects).toContainEqual({ op: "createPressure", count: 3, target: "opponent" });
    expect(effects).toContainEqual({ op: "gainBlock", amount: 3 });
  });

  it("neutral_finals_week: createPressure(opponent,2) + createPressure(self,1)", () => {
    const c = findCard("neutral_finals_week");
    const effects = c.abilities[0].effects;
    expect(effects).toContainEqual({ op: "createPressure", count: 2, target: "opponent" });
    expect(effects).toContainEqual({ op: "createPressure", count: 1, target: "self" });
  });
});
