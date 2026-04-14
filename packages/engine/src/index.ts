/**
 * @dev-camcard/engine
 *
 * 规则引擎 — 纯函数包骨架。
 *
 * 当前阶段：仅导出版本号与状态类型占位。
 * 后续（任务 3）将在此实现：
 *  - InternalMatchState 完整定义
 *  - draw / shuffle / endTurn / buy 纯函数
 *  - engine.reduce(state, command) → state 主入口
 *
 * 设计约束（docs/non-negotiables.md）：
 *  - 所有规则处理必须为纯函数，不依赖外部 IO
 *  - InternalMatchState 禁止直接同步给客户端
 *  - 客户端只发送 Command，不发送结算结果
 */

export const ENGINE_VERSION = "0.0.1";

// ── 状态类型占位（后续拆为单独模块）────────────────────────────────────────────

/**
 * 内部对局状态 — 仅服务端持有，禁止直接发送给客户端。
 * 参考 docs/technical-decisions.md：状态分层约定。
 */
export interface InternalMatchState {
  // TODO (任务 3)：实现完整状态结构
  // 参考 docs/game-rules.md 基础参数
}

/**
 * 公开视图 — 双方均可见的信息。
 */
export interface PublicMatchView {
  // TODO (任务 3)：实现
}

/**
 * 私有玩家视图 — 单方私有信息（如手牌）。
 */
export interface PrivatePlayerView {
  // TODO (任务 3)：实现
}
