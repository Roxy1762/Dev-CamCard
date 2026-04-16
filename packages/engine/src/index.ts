/**
 * @dev-camcard/engine
 *
 * 规则引擎 — 纯函数包。
 *
 * 导出内容：
 *  - 运行时类型：CardInstance、VenueState、InternalPlayerState、InternalMatchState、MarketLaneState
 *  - 牌堆操作：shuffle、draw
 *  - 回合操作：beginTurn、endTurn
 *  - 市场操作：buyFromMarket、buyFixedSupply
 *  - 状态投影：toPublicMatchView、toPrivatePlayerView
 *  - 初始化：RulesetConfig、createMatchState
 *  - 主入口：EngineConfig、reduce
 *
 * 设计约束（docs/non-negotiables.md）：
 *  - 所有规则处理必须为纯函数，不依赖外部 IO
 *  - InternalMatchState 禁止直接同步给客户端
 *  - 客户端只发送 Command，不发送结算结果
 */

export const ENGINE_VERSION = "0.1.0";

export * from "./types";
export * from "./rng";
export * from "./deck";
export * from "./turn";
export * from "./market";
export * from "./effects";
export * from "./projections";
export * from "./init";
export * from "./reduce";
