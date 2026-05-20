# 当前阶段能力清单（统一口径）

> 本文档以代码现状为准，按“已完成 / 未完成 / 已知风险”组织。

## 已完成 ✅

### 1) 工程与架构
- Monorepo（apps + packages）结构稳定。
- 协议层（`packages/protocol`）、引擎层（`packages/engine`）、Schema 校验层（`packages/schemas`）已分层。
- 服务端（Colyseus + Express）与客户端（HTML/CSS + Vite）可联调运行。

### 2) 对局主流程
- 1v1 对局主循环可完整执行：开局、轮转、结束判定。
- READY / PLAY_CARD / END_TURN / CONCEDE / SUBMIT_CHOICE 已接通。
- 场馆机制与 guard 优先攻击规则已在引擎侧生效。
- 日程槽与 `onScheduleResolve` 结算链路已存在。

### 3) 经济与购买链路
- 三栏市场公开槽位 + 补位机制可运行。
- 固定补给购买可运行。
- 预约与预约位购买（含折扣）可运行。
- 市场供给已升级为 rarity copies：`common=5`、`uncommon=3`、`rare=2`，并在市场构造阶段生效（不再是纯文案标签）。

### 4) 选择与效果系统
- `chooseTarget`、`gainFaceUpCard`、交互 `scry`、`trashFromHandOrDiscard` 已接入。
- `queueDelayedDiscard` 与回合开始结算可运行。
- `setFlag(nextBoughtCardToDeckTop)` 已覆盖三种购买路径：公开市场 / 固定补给 / 预约购买（`BUY_RESERVED_CARD`）。

### 5) 联机与持久化
- 断线重连（60 秒）可用。
- 事件日志可拉取，回放入口已升级为"逐事件浏览器"：HTML 模态弹层 + 步进 /
  自动播放（1x/2x/4x） / 跳转 / 进度条 / 当前 cursor 行高亮 + 已过事件淡化。
  控制层与表格渲染解耦，下一步只需把表格行替换为 `replayFromEvents` 输出的逐帧
  state 投影，即可完成 P0-4 最终一步。
- Prisma + PostgreSQL 持久化可用，含 Match / MatchPlayer / MatchEvent；已补齐 Match 创建与玩家/事件写入之间的时序等待，避免极端竞争下丢记录。
- 提供只读 API：`/api/matches`、`/api/matches/:id`、`/api/matches/:id/events`、
  `/api/matches/:id/metrics`（对局指标聚合，纯函数从 matchEvent 流投影，覆盖
  turns / durationMs / avgTurnMs / 双侧命令分布 + 攻击量分桶）。

### 6) 可见性与客户端
- Public/Private 视图分层已落地。
- 场馆耐久字段（`durability/maxDurability`）已在公开视图与客户端显示链路中。
- 客户端已补齐“攻击场馆”操作入口、guard 阻挡提示、服务端错误消息可视反馈。
- RoomClient 已支持更稳健的默认 WS 地址推导；server 端 CORS 支持多 origin 白名单。
- 条件状态条 ↔ 卡牌悬浮联动：hover 一张 condition 牌时，状态条上对应的 chip
  会蓝色高亮（已满足）/ 红色高亮（未满足），由
  `apps/game-client/src/content/cardConditions.ts` 在构建期从规则 JSON 投影出
  cardId → conditionKey 索引，零网络往返。

### 7) 可复现性基础（Mulberry32 seeded RNG）
- 统一 RNG 模块：`packages/engine/src/rng.ts`（`createSeededRng` / `hashStringToSeed` / `createSeededIdFactory`）。
- 关键随机路径全部通过注入 RNG：`shuffle` / `draw` / `reshuffle` / `createMarketState` / `applyEffects(scry/draw)`。
- `InternalMatchState` 新增 `initialSeed / rngState / idCounter`（均可选，旧状态兼容）。
- `reduce` 在 `state.rngState` 存在时自动使用 seeded RNG，并把推进后的 `rngState / idCounter` 写回返回值。
- `GameRoom` 基于 `hashStringToSeed(roomId)` 初始化 seed，并把 `initialSeed` 写入 `MatchSnapshot`。
- 引擎层已具备“同 seed + 同命令流 → 同关键结果”的最小验证（见 `determinism.test.ts`）。

### 7.1) 回放重建原语（P0-4 基础设施）
- 新增 `packages/engine/src/replay.ts`，把 P0-4 拆出可复用的最小核心：
  - `buildReplayInitialState({ roomId, ruleset, playerNames, initialSeed, laneDefinitions })`
    —— 与 `GameRoom.onCreate` 共用同一条 `createSeededMatchState` + `createMarketState`
    初始化路径，确保 live 与回放重建逐字节一致。
  - `reconstructCommand(event)` —— 把 `MatchEvent.data` 还原为可被 `reduce` 消费的
    `ClientCommand`；系统事件（MATCH_START / MATCH_END）与未知 type 返回 null。
  - `replayFromEvents(initialState, events, config)` —— 按事件流逐步推进，
    返回每步 `ReplayStep`（含 state、event、可选 error）与 finalState、errors 清单。
    单条事件出错不会中断流程：会回退到上一帧 state 并继续推进，便于定位首个偏差点。
- `GameRoom` 已切换为调用 `buildReplayInitialState`，消灭"live 初始化"与"replay 初始化"
  长期分叉的风险。
- 新增聚焦测试 `packages/engine/src/__tests__/replay.test.ts`（16 条），覆盖：
  - 同 setup 重复调用得到逐字节相同的初始状态。
  - 不同 seed 产出不同的市场布局。
  - 系统事件作为占位帧通过、命令事件还原、缺失字段安全降级、未知 type 返回 null。
  - 空事件流、典型主链事件流（READY×2 + END_TURN×2）回放结果与直接 reduce 等价。
  - 单步出错被记录到 errors 但流程继续。

### 8) effect schema 收紧
- `card-rule.schema.json` 中的 Effect 按 op 分支改为 `oneOf`，每支 `additionalProperties: false`。
- 统一 `drawThenDiscard` 字段为 `drawCount / discardCount`（engine 与 data 同步）。
- 新增 TargetedEffect 分支（`damageVenue` / `dealDamage`），`chooseTarget.onChosen` 只接受 TargetedEffect。
- `Ability.condition` 收口为 `{ type: ... }` 对象格式（与引擎 `CardCondition` 对齐）。

## 未完成 ❌

### 1) 规则正确性与一致性（优先）
- 日程槽“可安排对象、触发时机、客户端交互入口”的一致性仍需持续收敛。
- 攻击分配 UI 仍偏 MVP：当前以“全力打脸 / 对单个场馆快捷攻击”两种快捷操作为主，尚未提供可视化多段拆分分配器。

### 2) 可复现性（部分完成）
- 基础 seeded RNG 已落地；引擎侧已实现 `replayFromEvents` / `buildReplayInitialState`
  作为"逐事件重建状态"的原语；尚未完成的是把 UI 渲染层接上来（步进 / 自动播放 /
  跳转控件目前仍是事件列表视图）。
- 当前已满足“同 seed + 同命令流 → 引擎关键结果一致”，并能在引擎层从 snapshot
  + event log 重建出每一帧 `InternalMatchState`；接下来只剩把这些帧投影到
  渲染层（HtmlGameView 或 server-side snapshot 接口）。

### 3) 规则与数据约束（效果 schema 已收紧）
- effect schema 已从松散 `additionalProperties: true` 改为按 op 的 `oneOf`；data 与 engine 的 `drawThenDiscard` 字段已统一。
- rarity 缺失/未知值默认按 `common` 处理；兼容映射 `mid -> uncommon`、`elite/higher -> rare`，用于旧内容字段过渡。

### 4) 内容与平衡
- starter 已调整为 5/3/2/2（allowance/quarrel/draft_paper/punctuality），起手曲线较旧版更平滑。
- fixed supplies 已重构为三类明确职责：经济（`supply_milk_bread`）、生存（`supply_errand_runner`）、牌质修复（`supply_print_materials`）。
- pressure 生成默认进入弃牌堆（不再直接进手牌）；压力抽到手后仍不可打出，且回合结束照常弃置。
- 核心机制牌包首批 12 张（安排 / 预约 / 场馆 / 压力联动）已从“仅数据存在”推进到“引擎可真实结算”：
  - 条件链路：`hasScheduledCard / hasReservedCard / hasVenue` 均可驱动 onPlay/onActivate。
  - 效果链路：`setFlag / gainFaceUpCard / queueDelayedDiscard / createPressure` 均可在对局中触发并结算。

### 5) 工具与产品化
- 回放仍是骨架（以事件列表为主），非完整复盘播放器。下一步是"逐事件重建并渲染"。
- admin 后台仍为壳，未形成实用运营视图。

### 6) 客户端渲染层（HTML/CSS 重构）
- 牌桌前端从 Phaser canvas 改为 HTML + CSS Grid（`htmlGameView.ts`）。
- 文字清晰度、布局重叠、点击不可达、房号双显等系列 bug 一并消除。
- bundle 从 ~1.3MB 降到 ~116KB（gzip 34KB）。
- 详见 `docs/technical-decisions.md` "客户端渲染方案"决策记录。

## 已知风险 ⚠️

1. **规则-UI 偏差风险**：引擎合法但 UI 不可达，或 UI 可发非法路径。
2. **重放不可验证风险**：随机源不确定导致同事件流无法稳定复盘。
3. **数据漂移风险**：schema 过松时，内容侧新增字段可能未被引擎正确消费。
4. **平衡失真风险**：市场供给结构与 starter/fixed/pressure 结构未重做前，数值评估不稳定。

## 结论

项目当前已是**可持续推进的技术原型**，下一阶段应优先补齐“规则正确性 + 可复现性”主链，
不建议立即扩展复杂新机制。
