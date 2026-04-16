/**
 * content-loader.ts
 *
 * 运行时内容加载工具：读取 v2 分层数据格式（规则 + 文案分离），
 * 并可合并为兼容旧引擎接口的完整卡牌定义。
 *
 * 设计原则：
 *  - engine 只依赖规则真源（CardRuleData），不依赖本地化文案
 *  - client 通过 locale 参数按需加载文案，合并得到 MergedCardDef
 *  - locale 缺失时安全降级：name 以 id 占位，body 为空字符串
 *
 * 使用方式（server / engine）：
 *   const rules = loadCardRuleFile(DATA_ROOT, "cards/rules/starter.json");
 *
 * 使用方式（client，按 locale 加载）：
 *   const text = loadCardTextFile(DATA_ROOT, "zh-CN", "cards/text/zh-CN/starter.json");
 *   const merged = rules.map(r => mergeCardDef(r, text));
 */

import * as fs from "fs";
import * as path from "path";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 卡牌效果（规则层，不含文案） */
export interface CardEffect {
  op: string;
  [key: string]: unknown;
}

/** 卡牌能力（规则层） */
export interface CardAbility {
  trigger: string;
  effects: CardEffect[];
  /** condition 对象格式（如 { type: "firstActionThisTurn" }）或 undefined */
  condition?: unknown;
}

/**
 * CardRuleData — v2 规则真源。
 *
 * 字段含义：
 *  - schemaVersion: 2（v2 分层格式）
 *  - contentVersion: 内容版本，每次改动效果/数值时递增
 *  - artKey: 美术资源键名（默认等于 id）
 */
export interface CardRuleData {
  id: string;
  schemaVersion: 2;
  contentVersion: number;
  cost: number;
  rarity: "common" | "uncommon" | "rare" | "signature";
  lane: "course" | "activity" | "daily";
  type: "action" | "venue";
  isGuard?: boolean;
  durability?: number;
  activationsPerTurn?: number;
  starter?: boolean;
  fixedSupply?: boolean;
  isPressure?: boolean;
  tags: string[];
  artKey?: string;
  abilities: CardAbility[];
}

/** 单张卡牌的本地化文案条目 */
export interface CardTextEntry {
  name: string;
  body: string;
  reminder?: string | null;
}

/**
 * CardTextFile — 一个 locale 的文案文件（data/cards/text/<locale>/*.json）。
 */
export interface CardTextFile {
  schemaVersion: number;
  locale: string;
  cards: Record<string, CardTextEntry>;
}

/**
 * MergedCardDef — 规则数据 + 文案合并结果。
 *
 * 这是面向客户端展示层的完整卡牌定义，也是旧版 flat JSON 格式的等价物。
 * engine 不应依赖此类型，应直接使用 CardRuleData。
 */
export interface MergedCardDef extends CardRuleData {
  name: string;
  text: {
    body: string;
    reminder?: string;
  };
}

/** SetManifest — data/sets/*.json */
export interface SetManifest {
  schemaVersion: number;
  id: string;
  contentVersion: number;
  name?: string;
  description?: string;
  cardIds: string[];
}

/** ContentPackManifest — data/content-packs/*.json */
export interface ContentPackManifest {
  schemaVersion: number;
  id: string;
  contentVersion: number;
  name?: string;
  description?: string;
  author?: string;
  includes: {
    sets?: string[];
    rulesets?: string[];
  };
}

// ── 低层 I/O ──────────────────────────────────────────────────────────────────

function readJson<T>(fullPath: string): T {
  const raw = fs.readFileSync(fullPath, "utf-8");
  return JSON.parse(raw) as T;
}

// ── 加载函数 ──────────────────────────────────────────────────────────────────

/**
 * 加载 v2 规则数据文件（data/cards/rules/*.json）。
 * 返回 CardRuleData 数组，不含任何本地化文案。
 */
export function loadCardRuleFile(dataRoot: string, relativePath: string): CardRuleData[] {
  const fullPath = path.join(dataRoot, relativePath);
  return readJson<CardRuleData[]>(fullPath);
}

/**
 * 加载文案文件（data/cards/text/<locale>/*.json）。
 * 文件不存在时返回 null（安全降级）。
 */
export function loadCardTextFile(
  dataRoot: string,
  relativePath: string
): CardTextFile | null {
  const fullPath = path.join(dataRoot, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return readJson<CardTextFile>(fullPath);
}

/**
 * 加载 Set 清单（data/sets/*.json）。
 */
export function loadSetManifest(dataRoot: string, relativePath: string): SetManifest {
  const fullPath = path.join(dataRoot, relativePath);
  return readJson<SetManifest>(fullPath);
}

/**
 * 加载 ContentPack 清单（data/content-packs/*.json）。
 */
export function loadContentPackManifest(
  dataRoot: string,
  relativePath: string
): ContentPackManifest {
  const fullPath = path.join(dataRoot, relativePath);
  return readJson<ContentPackManifest>(fullPath);
}

// ── 合并与降级 ─────────────────────────────────────────────────────────────────

/**
 * 从规则数据 + 文案文件合并出面向展示层的完整卡牌定义。
 *
 * 降级策略（locale-safe fallback）：
 *  - 文案文件为 null，或文件中无对应 cardId 条目时：
 *    name 降级为 cardId，text.body 降级为空字符串
 *
 * engine 不应调用此函数，直接使用 CardRuleData 即可。
 */
export function mergeCardDef(
  rule: CardRuleData,
  textFile: CardTextFile | null
): MergedCardDef {
  const entry = textFile?.cards[rule.id];
  if (entry) {
    return {
      ...rule,
      name: entry.name,
      text: {
        body: entry.body,
        ...(entry.reminder != null ? { reminder: entry.reminder } : {}),
      },
    };
  }
  // 安全降级：name = id，body = ""
  return {
    ...rule,
    name: rule.id,
    text: { body: "" },
  };
}

/**
 * 获取单张卡牌的文案条目，locale 缺失时安全降级。
 */
export function getCardText(
  textFile: CardTextFile | null,
  cardId: string
): CardTextEntry {
  return textFile?.cards[cardId] ?? { name: cardId, body: "" };
}

// ── 批量加载工具 ───────────────────────────────────────────────────────────────

/**
 * 按 locale 加载并合并一批规则文件。
 *
 * 示例（server 侧加载引擎所需规则，不需要 locale）：
 *   const rules = loadRuleBatch(DATA_ROOT, ["cards/rules/starter.json", ...]);
 *
 * 示例（client 侧加载含文案的完整定义）：
 *   const merged = loadMergedBatch(DATA_ROOT, "zh-CN", [
 *     { rules: "cards/rules/starter.json", text: "cards/text/zh-CN/starter.json" },
 *     ...
 *   ]);
 */
export function loadRuleBatch(dataRoot: string, relPaths: string[]): CardRuleData[] {
  return relPaths.flatMap((p) => loadCardRuleFile(dataRoot, p));
}

export function loadMergedBatch(
  dataRoot: string,
  batches: Array<{ rules: string; text: string }>
): MergedCardDef[] {
  return batches.flatMap(({ rules: rPath, text: tPath }) => {
    const rules = loadCardRuleFile(dataRoot, rPath);
    const textFile = loadCardTextFile(dataRoot, tPath);
    return rules.map((r) => mergeCardDef(r, textFile));
  });
}
