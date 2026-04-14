/**
 * @dev-camcard/schemas
 *
 * JSON Schema 定义 + AJV 校验器。
 *
 * 任何卡牌 / ruleset / mod 数据都必须通过此包校验（non-negotiables.md）。
 * 非白名单 effect opcode 将被 AJV 拒绝。
 *
 * 卡牌 ID 以 docs/card-catalog.md 为准。
 */

export const SCHEMAS_VERSION = "0.0.1";

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

export type { ValidationResult } from "./validators";
