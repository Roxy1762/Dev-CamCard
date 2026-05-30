/**
 * content.ts — 服务端内容加载（模块级，仅执行一次）。
 *
 * 把"规则数据 + ruleset + 引擎配置 + 市场 lane 定义"从 GameRoom 抽出来，
 * 让对局房间（GameRoom）与只读回放端点（matchReplay / API）共用同一份内容：
 *  - 单一事实来源：避免两处各自加载导致 costMap / laneDefinitions 漂移。
 *  - 性能：JSON 解析与 AJV 校验只在进程启动时做一次，回放请求零额外 IO。
 *  - 可复现：回放重建必须用与 live 对局完全一致的 ruleset / laneDefinitions /
 *    ENGINE_CONFIG，否则 seeded RNG 起点就会偏。
 */

import * as path from "path";
import * as fs from "fs";
import { resolveMarketCopiesByRarity } from "@dev-camcard/engine";
import type { RulesetConfig, EngineConfig, CardDef } from "@dev-camcard/engine";
import type { Lane } from "@dev-camcard/protocol";
import { loadRuleBatch, assertRulesetDef, type CardRuleData } from "@dev-camcard/schemas";

// __dirname 在 dev (tsx) 和 prod (dist/) 下均指向 src 或 dist，
// 均距项目根目录 3 层（src/ -> apps/server -> 根 的反向），这里统一用 "../../../"。
export const DATA_ROOT = path.resolve(__dirname, "../../../");

// v2 规则数据：从 data/cards/rules/ 加载，不含本地化文案
export const CONTENT_SETS = [
  "data/cards/rules/starter.json",
  "data/cards/rules/fixed-supplies.json",
  "data/cards/rules/market-core.json",
  "data/cards/rules/status.json",
];

export const allRules: CardRuleData[] = loadRuleBatch(DATA_ROOT, CONTENT_SETS);

function loadJson<T>(relativePath: string): T {
  const fullPath = path.join(DATA_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as T;
}

export const RULESET_FILE = "data/rulesets/core-v1.json";
const rulesetRaw: unknown = loadJson(RULESET_FILE);
assertRulesetDef(rulesetRaw);
export const ruleset = rulesetRaw as RulesetConfig;

// cardId → cost 查找表
export const costMap = new Map<string, number>();
// cardId → CardDef 查找表
export const cardDefMap = new Map<string, CardDef>();

for (const rule of allRules) {
  costMap.set(rule.id, rule.cost);
  cardDefMap.set(rule.id, {
    id: rule.id,
    type: rule.type,
    abilities: rule.abilities as CardDef["abilities"],
    isGuard: rule.isGuard,
    durability: rule.durability,
    activationsPerTurn: rule.activationsPerTurn,
    isPressure: rule.isPressure ?? rule.tags.includes("pressure"),
  });
}

// 市场牌列表（来自 rules/market-core.json）
export const marketRules = allRules.filter(
  (r) => !r.starter && !r.fixedSupply && !r.isPressure && !r.tags.includes("pressure")
);

export const ENGINE_CONFIG: EngineConfig = {
  ruleset,
  getCardCost: (cardId) => costMap.get(cardId) ?? 0,
  getCardDef: (cardId) => cardDefMap.get(cardId),
};

/**
 * buildLaneDefinitions — 将市场牌规则按 lane 分组（已展开 rarity copies），
 * 返回引擎 createMarketState / buildReplayInitialState 所需格式。
 */
export function buildLaneDefinitions(
  rules: CardRuleData[],
  laneCount: number
): Array<{ lane: Lane; cardIds: string[] }> {
  const laneOrder: Lane[] = ["course", "activity", "daily"];
  const byLane: Record<string, string[]> = { course: [], activity: [], daily: [] };

  for (const rule of rules) {
    const lane = rule.lane;
    if (lane in byLane) {
      const copies = resolveMarketCopiesByRarity((rule as { rarity?: string }).rarity);
      for (let i = 0; i < copies; i++) {
        byLane[lane].push(rule.id);
      }
    }
  }

  return laneOrder.slice(0, laneCount).map((lane) => ({
    lane,
    cardIds: byLane[lane],
  }));
}

/**
 * 默认 lane 定义 —— 与 GameRoom.onCreate 使用的同一份。
 * 回放端点直接复用，确保初始市场布局逐字节一致。
 */
export const laneDefinitions = buildLaneDefinitions(marketRules, ruleset.marketLanesCount);

/** rulesetVersion 标识（文件名去路径去扩展名），与 MatchSnapshot 口径一致。 */
export const RULESET_VERSION = RULESET_FILE.replace("data/rulesets/", "").replace(".json", "");

/** contentSets 标识列表（仅文件名），与 MatchSnapshot 口径一致。 */
export const CONTENT_SET_NAMES = CONTENT_SETS.map((p) => p.split("/").pop()!.replace(".json", ""));
