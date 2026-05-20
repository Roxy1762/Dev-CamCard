/**
 * cardConditions.ts
 *
 * 客户端用的 cardId → 条件键集合 投影。
 *
 * 用途（roadmap-next.md P2-2 客户端体验增强）：
 *   - 玩家悬浮一张带 condition.trigger 的手牌时，需要知道它依赖哪几个布尔条件
 *     —— "已安排 / 已预约 / 有场馆"，从而在条件状态条上 highlight 对应的 chip，
 *     并按"满足 / 未满足"给出颜色提示。
 *
 * 加载方式：
 *   - 直接静态 import 规则 JSON（与 clientLocale.ts 同理，由 Vite 在构建时打包）。
 *   - 仅抽取 ability.condition.type，不解析效果体；只在 hover 时被读一次。
 *
 * 跟漂移：
 *   - 规则 JSON schema 改名时（如 hasVenue → hasVenueOnBoard），这里会保留旧
 *     键，UI 上对应的 chip 不再高亮 —— 是显式可见的 regression，而不是静默失败。
 */

import starterRules from "../../../../data/cards/rules/starter.json";
import fixedRules from "../../../../data/cards/rules/fixed-supplies.json";
import marketRules from "../../../../data/cards/rules/market-core.json";
import statusRules from "../../../../data/cards/rules/status.json";

/**
 * 我们关心的客户端条件键。
 * 与 htmlGameView.ts 渲染的 chip key 一一对应：scheduled / reserved / venue。
 */
export type ConditionKey = "scheduled" | "reserved" | "venue";

const CONDITION_MAPPING: Record<string, ConditionKey> = {
  hasScheduledCard: "scheduled",
  hasReservedCard: "reserved",
  hasVenue: "venue",
};

interface RuleAbility {
  trigger?: string;
  condition?: { type?: string } | null;
}

interface RuleCard {
  id: string;
  abilities?: RuleAbility[];
}

function collect(rules: RuleCard[], into: Map<string, Set<ConditionKey>>): void {
  for (const card of rules) {
    if (!card.abilities) continue;
    for (const ab of card.abilities) {
      const t = ab.condition?.type;
      if (!t) continue;
      const mapped = CONDITION_MAPPING[t];
      if (!mapped) continue;
      let set = into.get(card.id);
      if (!set) {
        set = new Set<ConditionKey>();
        into.set(card.id, set);
      }
      set.add(mapped);
    }
  }
}

let cachedMap: Map<string, ReadonlySet<ConditionKey>> | null = null;

/**
 * cardId → 该卡引用过的条件键集合（可能为 undefined = 不带条件触发）。
 */
export function getCardConditions(cardId: string): ReadonlySet<ConditionKey> | undefined {
  if (cachedMap === null) {
    const acc = new Map<string, Set<ConditionKey>>();
    collect(starterRules as RuleCard[], acc);
    collect(fixedRules as RuleCard[], acc);
    collect(marketRules as RuleCard[], acc);
    collect(statusRules as RuleCard[], acc);
    cachedMap = acc as Map<string, ReadonlySet<ConditionKey>>;
  }
  return cachedMap.get(cardId);
}
