/**
 * @dev-camcard/schemas
 *
 * JSON Schema 定义与 AJV 校验 — 卡牌 / 规则集数据校验层。
 *
 * 当前阶段：占位，仅声明版本常量。
 * 后续将在此实现：
 *  - CardDef JSON Schema（含 effect type 白名单）
 *  - RulesetDef JSON Schema
 *  - AJV 实例与 validate 导出函数
 *  - 非法 effect type 拒绝逻辑
 *
 * 卡牌 ID 以 docs/card-catalog.md 为准，不得改动既有 ID。
 * 数据文件将放置于 data/cards/*.json（后续任务）。
 */

export const SCHEMAS_VERSION = "0.0.1";
