/**
 * runtime-validation.test.ts
 *
 * 验证 content-loader 运行时 AJV 校验行为：
 *  1. 合法内容加载时通过（不抛错）
 *  2. 非法内容加载时抛出清晰报错（不静默吞掉）
 *  3. Set / ContentPack / CardText 校验覆盖
 *
 * 本文件聚焦于"加载时校验"路径，
 * schema 单元测试见 content-system.test.ts / validate.test.ts。
 */
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import {
  loadCardRuleFile,
  loadCardTextFile,
  loadSetManifest,
  loadContentPackManifest,
} from "../content-loader";
import {
  assertCardRule,
  assertCardText,
  assertSetManifest,
  assertContentPack,
} from "../validators";

const REPO_ROOT = path.resolve(__dirname, "../../../../");

// ── 辅助：写临时文件 ──────────────────────────────────────────────────────────

function writeTmp(filename: string, content: unknown): string {
  const dir = os.tmpdir();
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, JSON.stringify(content), "utf-8");
  return dir; // 返回目录；调用者用 path.join(dir, filename) 当 relativePath
}

// ── 1. 合法内容加载时通过 ─────────────────────────────────────────────────────

describe("合法内容加载时通过校验", () => {
  it("loadCardRuleFile — data/cards/rules/starter.json 合法，不抛错", () => {
    expect(() =>
      loadCardRuleFile(REPO_ROOT, "data/cards/rules/starter.json")
    ).not.toThrow();
  });

  it("loadCardRuleFile — data/cards/rules/market-core.json 合法，不抛错", () => {
    expect(() =>
      loadCardRuleFile(REPO_ROOT, "data/cards/rules/market-core.json")
    ).not.toThrow();
  });

  it("loadCardTextFile — data/cards/text/zh-CN/starter.json 合法，不抛错", () => {
    expect(() =>
      loadCardTextFile(REPO_ROOT, "data/cards/text/zh-CN/starter.json")
    ).not.toThrow();
  });

  it("loadSetManifest — data/sets/core-v1.json 合法，不抛错", () => {
    expect(() =>
      loadSetManifest(REPO_ROOT, "data/sets/core-v1.json")
    ).not.toThrow();
  });

  it("loadContentPackManifest — data/content-packs/base.json 合法，不抛错", () => {
    expect(() =>
      loadContentPackManifest(REPO_ROOT, "data/content-packs/base.json")
    ).not.toThrow();
  });
});

// ── 2. 非法内容加载时抛出清晰报错 ─────────────────────────────────────────────

describe("非法内容加载时抛出清晰报错", () => {
  it("assertCardRule — 缺少 schemaVersion 字段时抛 CardRule 校验失败", () => {
    const bad = {
      id: "bad_card",
      // schemaVersion missing
      contentVersion: 1,
      cost: 0,
      rarity: "common",
      lane: "course",
      type: "action",
      tags: [],
      abilities: [],
    };
    expect(() => assertCardRule(bad)).toThrow("CardRule 校验失败");
  });

  it("assertCardRule — 非白名单 op 时抛 CardRule 校验失败", () => {
    const bad = {
      id: "x",
      schemaVersion: 2,
      contentVersion: 1,
      cost: 0,
      rarity: "common",
      lane: "course",
      type: "action",
      tags: [],
      abilities: [{ trigger: "onPlay", effects: [{ op: "evilScript" }] }],
    };
    expect(() => assertCardRule(bad)).toThrow("CardRule 校验失败");
  });

  it("loadCardRuleFile — 文件中含非法 card 时抛含路径信息的报错", () => {
    // 写一个含非法 card 的临时 rule 文件
    const badCard = [
      {
        id: "bad",
        schemaVersion: 1, // <-- 应为 >= 2
        contentVersion: 1,
        cost: 0,
        rarity: "common",
        lane: "course",
        type: "action",
        tags: [],
        abilities: [],
      },
    ];
    const tmpRelPath = "_test_bad_rules.json";
    const tmpDir = os.tmpdir();
    fs.writeFileSync(path.join(tmpDir, tmpRelPath), JSON.stringify(badCard));

    expect(() => loadCardRuleFile(tmpDir, tmpRelPath)).toThrow(tmpRelPath);
  });

  it("assertCardText — 缺少 locale 字段时抛 CardText 校验失败", () => {
    const bad = {
      schemaVersion: 1,
      // locale missing
      cards: {},
    };
    expect(() => assertCardText(bad)).toThrow("CardText 校验失败");
  });

  it("assertSetManifest — 缺少 cardIds 字段时抛 SetManifest 校验失败", () => {
    const bad = {
      schemaVersion: 1,
      id: "test-set",
      contentVersion: 1,
      // cardIds missing
    };
    expect(() => assertSetManifest(bad)).toThrow("SetManifest 校验失败");
  });

  it("assertContentPack — 缺少 includes 字段时抛 ContentPack 校验失败", () => {
    const bad = {
      schemaVersion: 1,
      id: "test-pack",
      contentVersion: 1,
      // includes missing
    };
    expect(() => assertContentPack(bad)).toThrow("ContentPack 校验失败");
  });
});
