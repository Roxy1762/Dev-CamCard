/**
 * cardCatalog.ts — 把 server 用到的卡牌规则 + 文案集中加载一次，
 * 供 GameRoom 与 /api/cards 共用，避免两边各自维护一份 path 拼接。
 *
 * 端点设计：
 *  - GET /api/cards            → 全量列表（按 lane / rarity / type 分组前端自己做）
 *  - GET /api/cards/:id        → 单张卡牌完整信息（含中文名）
 *
 * 列表用于运营后台的"卡牌管理"视图；当前是只读，后续可在此基础上接入
 * "禁用某卡 / 调整 cost / 临时上线新内容" 等运营动作（写入 data/ 或 DB 覆盖层）。
 */

import * as path from "path";
import * as fs from "fs";
import {
  loadCardRuleFile,
  loadCardTextFile,
  mergeCardDef,
  type CardRuleData,
  type CardTextFile,
  type MergedCardDef,
} from "@dev-camcard/schemas";

const DATA_ROOT = path.resolve(__dirname, "../../../");

const RULE_FILES = [
  "data/cards/rules/starter.json",
  "data/cards/rules/fixed-supplies.json",
  "data/cards/rules/market-core.json",
  "data/cards/rules/status.json",
] as const;

const TEXT_LOCALES = ["zh-CN", "en-US"] as const;
type Locale = (typeof TEXT_LOCALES)[number];

function ruleSetName(relPath: string): string {
  return relPath.split("/").pop()!.replace(/\.json$/i, "");
}

function textFilePath(locale: Locale, ruleRelPath: string): string {
  // data/cards/rules/starter.json → data/cards/text/<locale>/starter.json
  const setName = ruleSetName(ruleRelPath);
  return `data/cards/text/${locale}/${setName}.json`;
}

function safeLoadText(rel: string): CardTextFile | null {
  const abs = path.join(DATA_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return loadCardTextFile(DATA_ROOT, rel);
  } catch (err) {
    console.warn(`[cardCatalog] 文案文件解析失败，将走降级文案: ${rel}`, err);
    return null;
  }
}

interface CardCatalogEntry extends MergedCardDef {
  /** 规则文件（card set）名称，便于按内容包分组。 */
  set: string;
}

let cachedRules: CardRuleData[] | null = null;
let cachedCatalog: Record<Locale, CardCatalogEntry[]> | null = null;

/** 仅规则数据，给 GameRoom 用。 */
export function loadAllRules(): CardRuleData[] {
  if (cachedRules) return cachedRules;
  cachedRules = RULE_FILES.flatMap((rel) => loadCardRuleFile(DATA_ROOT, rel));
  return cachedRules;
}

/** 含文案的合并卡牌列表。/api/cards 直接返回此结构。 */
export function loadCardCatalog(locale: Locale = "zh-CN"): CardCatalogEntry[] {
  if (!cachedCatalog) {
    cachedCatalog = {} as Record<Locale, CardCatalogEntry[]>;
  }
  if (cachedCatalog[locale]) return cachedCatalog[locale];

  const entries: CardCatalogEntry[] = [];
  for (const rel of RULE_FILES) {
    const set = ruleSetName(rel);
    const rules = loadCardRuleFile(DATA_ROOT, rel);
    const text = safeLoadText(textFilePath(locale, rel));
    for (const r of rules) {
      entries.push({ ...mergeCardDef(r, text), set });
    }
  }
  cachedCatalog[locale] = entries;
  return entries;
}

export function findCardInCatalog(id: string, locale: Locale = "zh-CN"): CardCatalogEntry | null {
  return loadCardCatalog(locale).find((c) => c.id === id) ?? null;
}

export function listSupportedLocales(): readonly Locale[] {
  return TEXT_LOCALES;
}

export function listRuleSets(): readonly string[] {
  return RULE_FILES.map(ruleSetName);
}

export function getDataRoot(): string {
  return DATA_ROOT;
}
