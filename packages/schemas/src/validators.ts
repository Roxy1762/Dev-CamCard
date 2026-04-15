import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import cardSchemaJson from "../schemas/card.schema.json";
import cardRuleSchemaJson from "../schemas/card-rule.schema.json";
import cardTextSchemaJson from "../schemas/card-text.schema.json";
import setSchemaJson from "../schemas/set.schema.json";
import contentPackSchemaJson from "../schemas/content-pack.schema.json";
import rulesetSchemaJson from "../schemas/ruleset.schema.json";
import modManifestSchemaJson from "../schemas/mod-manifest.schema.json";

const ajv = new Ajv({ allErrors: true });

// ── v1 legacy validators ──────────────────────────────────────────────────────
export const validateCardDef: ValidateFunction = ajv.compile(cardSchemaJson);
export const validateRulesetDef: ValidateFunction = ajv.compile(rulesetSchemaJson);
export const validateModManifest: ValidateFunction = ajv.compile(modManifestSchemaJson);

// ── v2 content-system validators ──────────────────────────────────────────────
export const validateCardRule: ValidateFunction = ajv.compile(cardRuleSchemaJson);
export const validateCardText: ValidateFunction = ajv.compile(cardTextSchemaJson);
export const validateSetManifest: ValidateFunction = ajv.compile(setSchemaJson);
export const validateContentPack: ValidateFunction = ajv.compile(contentPackSchemaJson);

// ── 结果类型 ──────────────────────────────────────────────────────────────────
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function toResult(
  validate: ValidateFunction,
  data: unknown
): ValidationResult {
  const valid = validate(data) as boolean;
  const errors: string[] = valid
    ? []
    : (validate.errors ?? []).map(
        (e: ErrorObject) =>
          `${e.instancePath || "(root)"} ${e.message ?? "unknown error"}`
      );
  return { valid, errors };
}

// ── v1 公共接口 ───────────────────────────────────────────────────────────────

/** 校验 v1 CardDef（旧 flat 格式，含 name/text） */
export function checkCardDef(data: unknown): ValidationResult {
  return toResult(validateCardDef, data);
}

/** 校验 RulesetDef */
export function checkRulesetDef(data: unknown): ValidationResult {
  return toResult(validateRulesetDef, data);
}

/** 校验 ModManifest */
export function checkModManifest(data: unknown): ValidationResult {
  return toResult(validateModManifest, data);
}

/** 校验 v1 CardDef，失败则抛出详细错误 */
export function assertCardDef(data: unknown): void {
  const result = checkCardDef(data);
  if (!result.valid) {
    throw new Error(`CardDef 校验失败:\n${result.errors.join("\n")}`);
  }
}

/** 校验 RulesetDef，失败则抛出详细错误 */
export function assertRulesetDef(data: unknown): void {
  const result = checkRulesetDef(data);
  if (!result.valid) {
    throw new Error(`RulesetDef 校验失败:\n${result.errors.join("\n")}`);
  }
}

// ── v2 公共接口 ───────────────────────────────────────────────────────────────

/** 校验 v2 CardRule（规则真源，不含文案） */
export function checkCardRule(data: unknown): ValidationResult {
  return toResult(validateCardRule, data);
}

/** 校验 CardTextFile（本地化文案文件） */
export function checkCardText(data: unknown): ValidationResult {
  return toResult(validateCardText, data);
}

/** 校验 SetManifest（卡牌集合清单） */
export function checkSetManifest(data: unknown): ValidationResult {
  return toResult(validateSetManifest, data);
}

/** 校验 ContentPackManifest（内容包清单） */
export function checkContentPack(data: unknown): ValidationResult {
  return toResult(validateContentPack, data);
}

/** 校验 v2 CardRule，失败则抛出详细错误 */
export function assertCardRule(data: unknown): void {
  const result = checkCardRule(data);
  if (!result.valid) {
    throw new Error(`CardRule 校验失败:\n${result.errors.join("\n")}`);
  }
}
