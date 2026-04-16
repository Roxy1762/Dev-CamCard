# Claude 交接文档（2026-04-16 校准版）

> 当前项目已从“概念验证”进入**可持续推进的技术原型**阶段。后续推进以规则正确性与可复现性优先。

## 1. 当前基线与对齐原则

- 项目基线：以 `main` 分支代码语义为准。
- 能力口径：与 `docs/current-capabilities.md` 保持一致。
- 下一阶段执行：以 `docs/roadmap-next.md` 为主。
- 已知问题清单：见 `docs/known-issues.md`。

## 2. 已完成能力（代码现状）

### 2.1 服务端与联机
- `GameRoom` 已接入真实引擎 `reduce`，并做 Public/Private 双视图广播。
- 支持 60 秒断线重连与事件日志回放入口（事件流拉取）。
- 已接入 Prisma + PostgreSQL：对局元数据与命令事件可落库，含只读查询 API。

### 2.2 规则引擎（MVP 主链）
- READY / PLAY / ACTIVATE_VENUE / END_TURN / CONCEDE / SUBMIT_CHOICE 全链可跑。
- 市场购买链路（公开购买 / 固定补给 / 预约购买）可用。
- 攻击分配支持玩家与场馆目标，含 guard 优先限制。
- 日程槽可结算 `onScheduleResolve`，场馆在回合开始重置启动次数并恢复耐久。
- 选择型效果（如 chooseTarget、gainFaceUpCard、交互 scry、trashFromHandOrDiscard）已接通。

### 2.3 客户端
- RoomScene 可完成核心对局操作与 pending-choice 交互。
- 对手场馆耐久当前可显示 `durability/maxDurability`。

## 3. 当前优先级判断（已固化）

当前最优先事项**不是新增复杂机制**，而是先补齐规则正确性与可复现性主链：

1. 日程槽合法性校验（规则与 UI 行为一致）
2. 场馆真实耐久公开化（协议、投影、客户端显示一致）
3. 攻击场馆 UI 与 guard 场景完整性
4. 确定性 RNG / 可复现回放
5. schema 收紧，避免 effect 字段与 engine 读取漂移
6. 市场从 singleton 过渡到 rarity copies
7. starter / fixed supplies / pressure 的结构性重做
8. 以小包机制牌把“安排 / 预约 / 场馆 / 压力”做成玩法主轴

> 以上已写入 `docs/roadmap-next.md` 与 `docs/known-issues.md`，作为后续实现顺序依据。

## 4. 仍待修问题（摘要）

- 一致性层面：规则定义、协议视图、客户端可操作入口仍有局部错位风险。
- 可复现层面：随机流程尚未形成统一 deterministic RNG 策略，回放可校验性不足。
- 内容层面：市场供给与起始/固定补给/压力结构还不足以稳定支撑长期平衡。

## 5. 交接执行建议

- 先按 `docs/known-issues.md` 的 P0 顺序修“规则正确性 + 可复现性”。
- 每完成一个子项，同步更新：
  1) `docs/current-capabilities.md`
  2) `docs/known-issues.md`
  3) 对应实现与测试
- 暂缓新增复杂机制，避免在错误地基上叠特性。

## 6. 本文档定位

本文仅做“阶段交接 + 优先级声明”，不再维护历史流水账。
历史背景请查 Git 记录与旧提交说明。
