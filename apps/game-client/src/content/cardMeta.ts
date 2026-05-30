/**
 * cardMeta.ts
 *
 * 客户端用的 cardId → 静态元数据（cost / rarity / type）投影。
 *
 * 用途：
 *   - 商店三栏 / 固定补给 / 预约位需要直接显示卡牌价格（资源消耗），
 *     让玩家在购买前就能判断"买不买得起"，不必再靠记忆或试点击触发服务端拒绝。
 *   - rarity 用于给卡牌价签上色（common / uncommon / rare），强化稀有度直觉。
 *
 * 加载方式（与 cardConditions.ts / clientLocale.ts 同理）：
 *   - 直接静态 import 规则 JSON，由 Vite 在构建时打包，零网络往返。
 *   - 这些 JSON 已被 cardConditions.ts 引用，新增本模块不增加额外的运行时请求。
 *
 * 与服务端口径一致性：
 *   - 服务端 GameRoom 用同一批 `data/cards/rules/*.json` 的 `cost` 字段构造 costMap，
 *     并据此扣费。客户端读取同一字段，因此"显示价" == "实际扣费价"。
 *   - 预约购买有 -1 折扣（见 game-rules：买预约位为原价 -1，最低 0），
 *     这部分折扣逻辑由调用方（htmlGameView）在展示层处理，本模块只暴露原价。
 */

import starterRules from "../../../../data/cards/rules/starter.json";
import fixedRules from "../../../../data/cards/rules/fixed-supplies.json";
import marketRules from "../../../../data/cards/rules/market-core.json";
import statusRules from "../../../../data/cards/rules/status.json";

/** 卡牌稀有度（与规则 JSON 的 rarity 字段一致；未知值不纳入）。 */
export type CardRarity = "common" | "uncommon" | "rare";

const KNOWN_RARITIES: ReadonlySet<string> = new Set(["common", "uncommon", "rare"]);

export interface CardMeta {
  /** 资源消耗（原价，不含预约折扣）。 */
  cost: number;
  /** 稀有度；规则数据缺失/未知时降级为 "common"。 */
  rarity: CardRarity;
  /** 卡牌类型（action / venue 等），用于 UI 微调（如场馆角标）。 */
  type: string;
}

interface RuleCardMeta {
  id: string;
  cost?: number;
  rarity?: string;
  type?: string;
}

function normalizeRarity(raw: string | undefined): CardRarity {
  if (raw && KNOWN_RARITIES.has(raw)) return raw as CardRarity;
  // 与服务端 resolveMarketCopiesByRarity 的兼容映射保持同向：旧字段降级到三档。
  if (raw === "mid") return "uncommon";
  if (raw === "elite" || raw === "higher") return "rare";
  return "common";
}

function collect(rules: RuleCardMeta[], into: Map<string, CardMeta>): void {
  for (const card of rules) {
    if (!card.id || into.has(card.id)) continue;
    into.set(card.id, {
      cost: typeof card.cost === "number" ? card.cost : 0,
      rarity: normalizeRarity(card.rarity),
      type: typeof card.type === "string" ? card.type : "action",
    });
  }
}

let cachedMap: Map<string, CardMeta> | null = null;

function ensureMap(): Map<string, CardMeta> {
  if (cachedMap === null) {
    const acc = new Map<string, CardMeta>();
    collect(starterRules as RuleCardMeta[], acc);
    collect(fixedRules as RuleCardMeta[], acc);
    collect(marketRules as RuleCardMeta[], acc);
    collect(statusRules as RuleCardMeta[], acc);
    cachedMap = acc;
  }
  return cachedMap;
}

/** 获取卡牌完整元数据；未知 cardId 返回 undefined（调用方据此降级）。 */
export function getCardMeta(cardId: string): CardMeta | undefined {
  return ensureMap().get(cardId);
}

/**
 * 获取卡牌原价（资源消耗）。
 * 未知 cardId 返回 undefined —— 让 UI 显示 "?" 而不是误显 0（0 与 "未知" 语义不同）。
 */
export function getCardCost(cardId: string): number | undefined {
  return ensureMap().get(cardId)?.cost;
}

/** 获取卡牌稀有度；未知 cardId 返回 undefined。 */
export function getCardRarity(cardId: string): CardRarity | undefined {
  return ensureMap().get(cardId)?.rarity;
}
