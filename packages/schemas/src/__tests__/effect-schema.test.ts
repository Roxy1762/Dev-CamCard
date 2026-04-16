import { describe, it, expect } from "vitest";
import { checkCardRule } from "../validators";

// ── 聚焦测试：effect schema 按 op 收口 ──
// 只验证本轮目标：
//  1) 合法 effect 数据通过
//  2) 非法多余字段被拒绝（additionalProperties: false）
//  3) drawThenDiscard 字段约束正确（drawCount/discardCount，拒绝旧 count）
//  4) 修正后数据仍能加载（data/cards/rules/*.json 仍能通过校验）

// ── 测试脚手架 ────────────────────────────────────────────────────────────────

function makeCard(effects: unknown[]): unknown {
  return {
    id: "test_card",
    schemaVersion: 2,
    contentVersion: 1,
    cost: 0,
    rarity: "common",
    lane: "course",
    type: "action",
    tags: [],
    abilities: [{ trigger: "onPlay", effects }],
  };
}

describe("effect schema（按 op 收口）", () => {
  it("1) 合法 effect 列表通过（覆盖多类型）", () => {
    const good = makeCard([
      { op: "gainResource", amount: 2 },
      { op: "draw", count: 1 },
      { op: "drawThenDiscard", drawCount: 2, discardCount: 1 },
      { op: "scry", count: 3, interactive: true },
      { op: "createPressure", count: 1, target: "opponent" },
      { op: "queueDelayedDiscard", count: 2, target: "self" },
      { op: "trashFromHandOrDiscard", count: 1, zone: "either" },
      { op: "gainFaceUpCard", maxCost: 4, destination: "deckTop" },
      { op: "setFlag", flag: "nextBoughtCardToDeckTop" },
      {
        op: "chooseTarget",
        targetType: "opponentVenue",
        onChosen: [{ op: "damageVenue", amount: 2 }],
      },
    ]);
    const r = checkCardRule(good);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("2) 非法多余字段被 additionalProperties:false 拒绝", () => {
    const bad = makeCard([
      { op: "gainResource", amount: 2, bogus: "no" },
    ]);
    expect(checkCardRule(bad).valid).toBe(false);
  });

  it("3a) drawThenDiscard 要求 drawCount + discardCount（旧 count 被拒）", () => {
    const legacy = makeCard([{ op: "drawThenDiscard", count: 1 }]);
    expect(checkCardRule(legacy).valid).toBe(false);

    const fixed = makeCard([
      { op: "drawThenDiscard", drawCount: 1, discardCount: 1 },
    ]);
    expect(checkCardRule(fixed).valid).toBe(true);
  });

  it("3b) chooseTarget.onChosen 中非 TargetedEffect 被拒绝（不能放 gainResource 等）", () => {
    const bad = makeCard([
      {
        op: "chooseTarget",
        targetType: "opponentPlayer",
        onChosen: [{ op: "gainResource", amount: 2 }],
      },
    ]);
    expect(checkCardRule(bad).valid).toBe(false);
  });

  it("3c) setFlag.flag 必填、为非空字符串", () => {
    const missingFlag = makeCard([{ op: "setFlag" }]);
    expect(checkCardRule(missingFlag).valid).toBe(false);

    const emptyFlag = makeCard([{ op: "setFlag", flag: "" }]);
    expect(checkCardRule(emptyFlag).valid).toBe(false);

    const good = makeCard([{ op: "setFlag", flag: "fooBar" }]);
    expect(checkCardRule(good).valid).toBe(true);
  });

  it("4) 现网 data/cards/rules/market-core.json 在收紧 schema 下仍通过", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const REPO_ROOT = path.resolve(__dirname, "../../../../");
    const raw = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "data/cards/rules/market-core.json"), "utf-8")
    ) as unknown[];
    for (const card of raw) {
      const r = checkCardRule(card);
      if (!r.valid) {
        const c = card as { id?: string };
        throw new Error(`${c.id} 校验失败:\n${r.errors.join("\n")}`);
      }
    }
  });
});
