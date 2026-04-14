/**
 * @dev-camcard/protocol
 *
 * 共享协议类型 — 客户端 ↔ 服务端通信契约。
 *
 * 当前阶段：占位，仅声明类型框架。
 * 后续将在此定义：
 *  - Command union（客户端 → 服务端）
 *  - Event union（服务端 → 客户端）
 *  - PublicMatchView / PrivatePlayerView 视图类型
 *
 * 参考 docs/technical-decisions.md：状态分层约定
 * 禁止将 InternalMatchState 混入此包。
 */

// ── Command 占位 ──────────────────────────────────────────────────────────────
// TODO (任务 2)：替换为 DrawCommand | BuyCommand | EndTurnCommand | ... 的 union
export type CommandType = string;

// ── Event 占位 ────────────────────────────────────────────────────────────────
// TODO (任务 2)：替换为 StateUpdateEvent | ErrorEvent | ... 的 union
export type EventType = string;

// ── 视图类型占位 ──────────────────────────────────────────────────────────────
// TODO (任务 3)：迁移自 packages/engine 并在此导出 DTO 形状
export interface PublicMatchViewDTO {
  // placeholder
}

export interface PrivatePlayerViewDTO {
  // placeholder
}
