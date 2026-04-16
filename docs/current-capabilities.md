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

## 未完成 ❌

### 1) 规则正确性与一致性（优先）
- 日程槽“可安排对象、触发时机、客户端交互入口”的一致性仍需持续收敛。
- 攻击场馆的客户端可操作入口与 guard 场景交互仍不完整。

### 2) 可复现性（优先）
- 尚未完成统一 deterministic RNG 策略。
- 回放尚未达到“逐事件可重建并可校验一致”的目标。

### 3) 规则与数据约束
- effect schema 与 engine 读取约束仍偏松，存在字段漂移风险。
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
