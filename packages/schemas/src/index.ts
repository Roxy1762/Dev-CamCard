/**
 * @dev-camcard/schemas
 *
 * JSON Schema 定义 + AJV 校验器 + 内容加载工具。
 *
 * 任何卡牌 / ruleset / mod 数据都必须通过此包校验（non-negotiables.md）。
 * 非白名单 effect opcode 将被 AJV 拒绝。
 *
 * 卡牌 ID 以 docs/card-catalog.md 为准。
 *
 * ## 版本
 *
 * - v1（card.schema.json）：旧 flat 格式，name + text 与规则字段混合
 * - v2（card-rule.schema.json）：规则与文案分层，详见 docs/content-architecture.md
 */

export const SCHEMAS_VERSION = "0.1.0";

// ── v1 legacy ─────────────────────────────────────────────────────────────────
export {
  validateCardDef,
  validateRulesetDef,
  validateModManifest,
  checkCardDef,
  checkRulesetDef,
  checkModManifest,
  assertCardDef,
  assertRulesetDef,
} from "./validators";

// ── v2 content-system ─────────────────────────────────────────────────────────
export {
  validateCardRule,
  validateCardText,
  validateSetManifest,
  validateContentPack,
  checkCardRule,
  checkCardText,
  checkSetManifest,
  checkContentPack,
  assertCardRule,
} from "./validators";

export type { ValidationResult } from "./validators";

// ── content-loader ────────────────────────────────────────────────────────────
export {
  loadCardRuleFile,
  loadCardTextFile,
  loadSetManifest,
  loadContentPackManifest,
  mergeCardDef,
  getCardText,
  loadRuleBatch,
  loadMergedBatch,
} from "./content-loader";

export type {
  CardRuleData,
  CardTextEntry,
  CardTextFile,
  MergedCardDef,
  SetManifest,
  ContentPackManifest,
  CardAbility,
  CardEffect,
} from "./content-loader";
