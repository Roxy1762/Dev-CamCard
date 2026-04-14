import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import cardSchemaJson from "../schemas/card.schema.json";
import rulesetSchemaJson from "../schemas/ruleset.schema.json";
import modManifestSchemaJson from "../schemas/mod-manifest.schema.json";

const ajv = new Ajv({ allErrors: true });

export const validateCardDef: ValidateFunction = ajv.compile(cardSchemaJson);
export const validateRulesetDef: ValidateFunction = ajv.compile(rulesetSchemaJson);
export const validateModManifest: ValidateFunction = ajv.compile(modManifestSchemaJson);

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

/** CardDef を検証して結果を返す */
export function checkCardDef(data: unknown): ValidationResult {
  return toResult(validateCardDef, data);
}

/** RulesetDef を検証して結果を返す */
export function checkRulesetDef(data: unknown): ValidationResult {
  return toResult(validateRulesetDef, data);
}

/** ModManifest を検証して結果を返す */
export function checkModManifest(data: unknown): ValidationResult {
  return toResult(validateModManifest, data);
}

/** 校验 CardDef，失败则抛出详细错误 */
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
