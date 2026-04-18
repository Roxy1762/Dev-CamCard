# Claude 交接文档（2026-04-18 结构重做版）

> 当前项目已从“概念验证”进入**可持续推进的技术原型**阶段。后续推进以规则正确性与可复现性优先。

## 最近一轮更新（市场 rarity copies 落地）

- 市场供给已从 singleton 结构升级为“按 rarity 复制数量”的真实供给：
  - `common -> 5` 份
  - `uncommon -> 3` 份
  - `rare -> 2` 份
- 生效路径：`GameRoom` 在构造 `laneDefinitions` 时，先按 `rarity` 扩展 `cardIds`，再交给 `createMarketState` 洗牌并生成三栏槽位/牌堆。
- 三栏市场、购买补位、牌堆耗尽置空等既有逻辑保持不变。
- 兼容策略（用于旧字段/旧内容）：
  - `mid -> uncommon`
  - `elite / higher -> rare`
  - rarity 缺失或未知值默认按 `common`（避免历史数据直接崩溃）
- 本轮未做大规则改版，仅完成供给结构升级与最小稳定化验证。

## 最近一轮更新（starter / fixed supplies / pressure）

- `data/rulesets/core-v1.json` 的 starter 组成已调整为：
  - `starter_allowance x5`
  - `starter_quarrel x3`
  - `starter_draft_paper x2`
  - `starter_punctuality x2`
- fixed supplies 三堆已按职责重写：
  - 经济：`supply_milk_bread`（2 资源 + 1 防备）
  - 生存：`supply_errand_runner`（回复 1 + 1 防备）
  - 牌质修复：`supply_print_materials`（抽 2 弃 1）
- 压力规则已改为默认进入弃牌堆（`createPressure` 不再直接把压力放进手牌），仍保留：
  - 压力抽到手后不可打出
  - 回合结束会随手牌一起弃置
- 本轮“与建议略有不同”的最小调整说明：
  - 生存补给使用了“治疗 + 防备”的双轻量组合，而非单纯治疗，目的是让防守收益不依赖单一生命恢复来源。

## 最近一轮更新（RNG + Schema 收口）

- 引擎新增统一 seeded RNG 模块（`packages/engine/src/rng.ts`），提供 `createSeededRng` / `hashStringToSeed` / `createSeededIdFactory`。
- 关键随机路径（`shuffle` / `draw` / `reshuffle` / `createMarketState` / `applyEffects` 等）的 RNG 来源统一可注入；当 `InternalMatchState.rngState` 存在时，`reduce` 自动以 seeded RNG 推进并回写 `rngState` 与 `idCounter`。
- `createSeededMatchState(roomId, ruleset, names, seed)` 为可复现对局的官方入口；server 侧 `GameRoom` 会基于 `hashStringToSeed(roomId)` 写入 `initialSeed / rngState / idCounter`，并将 `initialSeed` 挂到 `MatchSnapshot`。
- `MatchSnapshot.initialSeed` 与 `InternalMatchState.rngState / idCounter / initialSeed` 为**后续重建**留出最小基础，当前 replay 仍以日志查看为主，但已具备“同 seed + 同命令流 → 同关键结果”的引擎验证能力。
- effect schema 由宽松 `{op + additionalProperties: true}` 改为按 op 的 `oneOf` 分支，每支 `additionalProperties: false`，`drawThenDiscard` 由 `count` 统一为 `drawCount / discardCount`（engine 与 data 同步）。
- 新测试：
  - `packages/engine/src/__tests__/determinism.test.ts`（5 条，最小可复现性验证）
  - `packages/schemas/src/__tests__/effect-schema.test.ts`（6 条，聚焦 schema 收紧）

## 最近一轮更新（12 张机制牌接通）

- 围绕“安排 / 预约 / 场馆 / 压力”新增的 12 张机制牌完成一次可玩性梳理，确认其核心依赖链路均已接通：
  - `hasScheduledCard`：`red_morning_run_checklist` / `red_closed_gym_training` / `blue_review_outline` / `blue_topic_defense`
  - `hasReservedCard`：`blue_after_class_makeup_log` / `red_preselection_application`
  - `hasVenue`：`white_student_council_meeting` / `white_school_rules_briefing`
  - 其余直接机制：`red_tournament_countdown`（安排）、`white_counseling_room`（场馆）、`blue_course_grab_plugin`（setFlag）、`white_makeup_procedure`（trash+heal）
- 补齐高杠杆小缺口：`setFlag(nextBoughtCardToDeckTop)` 现在同样作用于 `BUY_RESERVED_CARD`，使“预约购买”也能吃到置顶收益。
- 新增聚焦测试文件 `packages/engine/src/__tests__/mechanic-pack-bridge.test.ts`（5 条）：
  - 覆盖 5 张新增机制牌的真实行为路径（条件触发、gainFaceUpCard 选择、预约购买吃 flag）。

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
