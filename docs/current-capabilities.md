# 当前阶段能力清单（统一口径）

> 本文档以代码现状为准，按“已完成 / 未完成 / 已知风险”组织。

## 已完成 ✅

### 1) 工程与架构
- Monorepo（apps + packages）结构稳定。
- 协议层（`packages/protocol`）、引擎层（`packages/engine`）、Schema 校验层（`packages/schemas`）已分层。
- 服务端（Colyseus + Express）与客户端（Phaser + Vite）可联调运行。

### 2) 对局主流程
- 1v1 对局主循环可完整执行：开局、轮转、结束判定。
- READY / PLAY_CARD / END_TURN / CONCEDE / SUBMIT_CHOICE 已接通。
- 场馆机制与 guard 优先攻击规则已在引擎侧生效。
- 日程槽与 `onScheduleResolve` 结算链路已存在。

### 3) 经济与购买链路
- 三栏市场公开槽位 + 补位机制可运行。
- 固定补给购买可运行。
- 预约与预约位购买（含折扣）可运行。

### 4) 选择与效果系统
- `chooseTarget`、`gainFaceUpCard`、交互 `scry`、`trashFromHandOrDiscard` 已接入。
- `queueDelayedDiscard` 与回合开始结算可运行。

### 5) 联机与持久化
- 断线重连（60 秒）可用。
- 事件日志可拉取，回放入口已接通（当前为日志视图）。
- Prisma + PostgreSQL 持久化可用，含 Match / MatchPlayer / MatchEvent。
- 提供只读 API：`/api/matches`、`/api/matches/:id`、`/api/matches/:id/events`。

### 6) 可见性与客户端
- Public/Private 视图分层已落地。
- 场馆耐久字段（`durability/maxDurability`）已在公开视图与客户端显示链路中。

### 7) 可复现性基础（Mulberry32 seeded RNG）
- 统一 RNG 模块：`packages/engine/src/rng.ts`（`createSeededRng` / `hashStringToSeed` / `createSeededIdFactory`）。
- 关键随机路径全部通过注入 RNG：`shuffle` / `draw` / `reshuffle` / `createMarketState` / `applyEffects(scry/draw)`。
- `InternalMatchState` 新增 `initialSeed / rngState / idCounter`（均可选，旧状态兼容）。
- `reduce` 在 `state.rngState` 存在时自动使用 seeded RNG，并把推进后的 `rngState / idCounter` 写回返回值。
- `GameRoom` 基于 `hashStringToSeed(roomId)` 初始化 seed，并把 `initialSeed` 写入 `MatchSnapshot`。
- 引擎层已具备“同 seed + 同命令流 → 同关键结果”的最小验证（见 `determinism.test.ts`）。

### 8) effect schema 收紧
- `card-rule.schema.json` 中的 Effect 按 op 分支改为 `oneOf`，每支 `additionalProperties: false`。
- 统一 `drawThenDiscard` 字段为 `drawCount / discardCount`（engine 与 data 同步）。
- 新增 TargetedEffect 分支（`damageVenue` / `dealDamage`），`chooseTarget.onChosen` 只接受 TargetedEffect。
- `Ability.condition` 收口为 `{ type: ... }` 对象格式（与引擎 `CardCondition` 对齐）。

## 未完成 ❌

### 1) 规则正确性与一致性（优先）
- 日程槽“可安排对象、触发时机、客户端交互入口”的一致性仍需持续收敛。
- 攻击场馆的客户端可操作入口与 guard 场景交互仍不完整。

### 2) 可复现性（部分完成）
- 基础 seeded RNG 已落地；但完整回放（逐事件重建并渲染）尚未实现。
- 当前已满足“同 seed + 同命令流 → 引擎关键结果一致”的最小条件；后续需要把命令流回放 + 视图重播串联。

### 3) 规则与数据约束（效果 schema 已收紧）
- effect schema 已从松散 `additionalProperties: true` 改为按 op 的 `oneOf`；data 与 engine 的 `drawThenDiscard` 字段已统一。
- 市场供给模型仍偏薄（接近 singleton），尚未转向 rarity copies。

### 4) 内容与平衡
- starter / fixed supplies / pressure 的结构性重做尚未完成。
- 核心机制牌包（安排 / 预约 / 场馆 / 压力）尚未形成清晰玩法主轴。

### 5) 工具与产品化
- ReplayScene 仍是骨架（以事件列表为主），非完整复盘播放器。
- admin 后台仍为壳，未形成实用运营视图。

## 已知风险 ⚠️

1. **规则-UI 偏差风险**：引擎合法但 UI 不可达，或 UI 可发非法路径。
2. **重放不可验证风险**：随机源不确定导致同事件流无法稳定复盘。
3. **数据漂移风险**：schema 过松时，内容侧新增字段可能未被引擎正确消费。
4. **平衡失真风险**：市场供给结构与 starter/fixed/pressure 结构未重做前，数值评估不稳定。

## 结论

项目当前已是**可持续推进的技术原型**，下一阶段应优先补齐“规则正确性 + 可复现性”主链，
不建议立即扩展复杂新机制。
