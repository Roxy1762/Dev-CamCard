# Versioning & Snapshots（已与持久化实现对齐）

> 本文档记录对局事件流、快照元信息与版本标识的当前实现口径。

## 当前状态（2026-04）

当前不是“仅内存”模式，已实现：

- 房间内维护内存事件流（用于实时推送与回放入口）
- 同时将事件流落库到 PostgreSQL（`MatchEvent`）
- 对局元信息落库到 `Match` / `MatchPlayer`
- 提供只读 API：
  - `GET /api/matches`
  - `GET /api/matches/:id`
  - `GET /api/matches/:id/events`

---

## 类型定义（`packages/protocol/src/events.ts`）

- `MatchEvent`：`seq / ts / type / side? / data?`
- `MatchSnapshot`：`matchId / rulesetVersion / contentSets / startedAt / initialSeed?`
- `MatchEventLog`：`{ snapshot, events }`

说明：
- 协议层 `ts` 为 `number`（毫秒时间戳）。
- 数据库层 `MatchEvent.ts` 使用 `BIGINT`，API 返回时转换为字符串，避免 JSON 序列化 BigInt 报错。
- `MatchSnapshot.initialSeed` 为可选的 32 位整数，指示该局 seeded RNG 的初始 seed，用于后续重建。历史快照缺省时视为未启用 seeded RNG。

---

## Seeded RNG 与可复现性基础

> 目标：让“同 seed + 同命令流 → 同关键结果”在引擎侧成立，为逐事件重建保留最小入口。

- 引擎提供统一 RNG 模块 `packages/engine/src/rng.ts`：
  - `createSeededRng(seed)`：Mulberry32 PRNG，`next()/state()/setState()` 可读写内部状态。
  - `hashStringToSeed(input)`：xmur3 风格哈希，将 `roomId` 等字符串转为稳定 32 位 seed。
  - `createSeededIdFactory(prefix, startCounter)`：确定性 ID 生成器（`genId()` 与 `counter` 可回读）。

- `InternalMatchState` 在保留向后兼容的前提下，新增可选字段：
  - `initialSeed?: number` — 该局使用的初始 seed
  - `rngState?: number` — 推进后的 RNG 内部状态
  - `idCounter?: number` — 确定性实例 ID 的单调计数器

- `reduce(state, side, cmd, config)` 的行为：
  - 若 `state.rngState != null`，自动构造 seeded RNG 推进内部逻辑（shuffle/draw/reshuffle/scry 等），并在返回的新 state 上回写 `rngState` 与 `idCounter`。
  - 若状态未携带 `rngState`，按旧逻辑运行（兼容未迁移的测试/入口）。

- `createSeededMatchState(roomId, ruleset, names, seed)` 为官方可复现入口；服务端 `GameRoom.onCreate` 以 `hashStringToSeed(roomId)`（或显式 `options.seed`）派生 `initialSeed`，并把 `initialSeed` 挂到 `MatchSnapshot`。

- 当前已具备“同 seed + 同命令流 → 同关键结果”的最小验证（见 `packages/engine/src/__tests__/determinism.test.ts`）。逐事件重建并渲染尚未实现，仍以日志视图为主。

---

## 事件覆盖范围

已覆盖：
- `MATCH_START`
- 所有客户端命令对应事件（如 `PLAY_CARD` / `BUY_MARKET_CARD` / `SUBMIT_CHOICE`）
- `MATCH_END`

事件 payload 为“精简字段”，仅保存必要重建信息（如 `instanceId/cardId/slotIndex/selectedInstanceIds/assignments`）。

---

## Snapshot 版本标识来源

- `rulesetVersion`：来自 `RULESET_FILE`（当前为 `data/rulesets/core-v1.json`）
- `contentSets`：来自 `CONTENT_SETS`（当前为 starter / fixed-supplies / market-core / status）

这组标识用于回放环境定位与后续数据兼容。

---

## 客户端入口

### 事件日志同步时机

1. `onJoin` 首次加入
2. 断线重连成功
3. 客户端发送 `REQUEST_MATCH_EVENTS`

### ReplayScene（当前能力）

- 展示日志列表（seq / ts / type / side / data）
- 分页与滚动
- 自动监听最新 `MatchEventLog`

暂未实现逐事件重建渲染播放器（仍是骨架）。

---

## 后续扩展建议

1. 提供”按 matchId + seq 范围”拉取 API，减少长局日志传输压力。
2. 在协议层引入版本号字段，为未来 replay 兼容做前置治理。
3. 补齐 ReplayScene 的逐帧重建能力：以 `MatchSnapshot.initialSeed` 初始化 seeded RNG，按命令事件流在引擎侧逐步 `reduce`，驱动客户端视图重播。
