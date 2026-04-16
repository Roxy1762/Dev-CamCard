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
- `MatchSnapshot`：`matchId / rulesetVersion / contentSets / startedAt`
- `MatchEventLog`：`{ snapshot, events }`

说明：
- 协议层 `ts` 为 `number`（毫秒时间戳）。
- 数据库层 `MatchEvent.ts` 使用 `BIGINT`，API 返回时转换为字符串，避免 JSON 序列化 BigInt 报错。

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

1. 提供“按 matchId + seq 范围”拉取 API，减少长局日志传输压力。
2. 在协议层引入版本号字段，为未来 replay 兼容做前置治理。
3. 补齐 ReplayScene 的逐帧重建能力（可复用 engine 的可回放入口）。
