# 当前阶段能力清单

> 本文件记录项目截至当前的实际完成状态，以代码为准，随每轮推进同步更新。

## 已完成 ✅

### 基础架构

- [x] Monorepo 结构（apps/ + packages/）
- [x] Colyseus 房间层（GameRoom）
- [x] 规则引擎独立为纯函数包（packages/engine）
- [x] 协议层（packages/protocol：CMD / EVT / 类型定义）
- [x] 状态分层：InternalMatchState → PublicMatchView / PrivatePlayerView
- [x] Phaser + Colyseus 联机牌桌（BootScene + RoomScene）
- [x] 数据文件（starter / fixed-supplies / market-core / status / core-v1 ruleset）

### 规则引擎（engine）

- [x] 1v1 基础对局流程（READY → 开局 → 回合交替 → 胜负）
- [x] 起始套牌洗牌 + 发开局手牌（先手 4 / 后手 5）
- [x] 资源 / 攻击 / 防备 / 血量
- [x] 打出行动牌（PLAY_CARD）+ onPlay 效果
- [x] 场馆牌进场 + onActivate 效果
- [x] 压力牌不可打出
- [x] 值守场馆（isGuard）限制攻击顺序
- [x] 日程槽（PUT_CARD_TO_SCHEDULE + onScheduleResolve）
- [x] 多目标攻击分配（攻玩家 / 攻场馆 / guard 限制）
- [x] 固定补给购买
- [x] 三栏市场主循环（含自动补位）
- [x] 预约位机制（reserveFromMarket / buyReservedCard）
- [x] 延迟弃牌（queueDelayedDiscard / pendingDiscardCount / beginTurn 结算）
- [x] 结束回合（END_TURN）
- [x] 投降（CONCEDE）
- [x] SUBMIT_CHOICE：响应待处理选择

### Effect 系统（engine/effects.ts）

已支持的 `CardEffect` op：

| op | 目标 | 说明 |
|----|------|------|
| gainResource | self | 获得资源 |
| gainAttack | self | 获得攻击 |
| gainBlock | self | 获得防备 |
| heal | self | 回复生命 |
| draw | self | 摸牌 |
| drawThenDiscard | self | 摸牌后弃牌 |
| createPressure | self / opponent | 产生压力牌 |
| scry（非交互） | self | 预习：随机重洗牌堆顶 N 张（MVP）|
| scry（interactive=true） | self | 预习：玩家选择弃 0~1 张，余下原序放回 |
| setFlag | self | 设置标志位 |
| gainFaceUpCard | self | ✅ 从市场选取 maxCost 内的牌，进入 discard 或 deckTop |
| queueDelayedDiscard | self / opponent | 让目标下回合弃 N 张 |
| trashFromHandOrDiscard | self | 从手牌/弃牌堆报废 N 张（玩家选择目标） |
| chooseTarget | opponent/self | ✅ 选择对手玩家/对手场馆/己方场馆，并对其应用 onChosen 效果 |

已支持的 `TargetedEffect`（chooseTarget.onChosen）：

| op | 说明 |
|----|------|
| damageVenue | 减少场馆耐久；≤ 0 时摧毁 |
| dealDamage | 直接扣玩家 HP（非战斗伤害，不经过防备） |

已支持的 `CardCondition` type：

| condition.type | 说明 |
|----------------|------|
| firstActionThisTurn | 本回合第一张行动牌 |
| actionsPlayedAtLeast | 本回合已打出至少 N 张行动牌 |
| hasVenue | 己方至少有 1 座场馆 |
| hasScheduledCard | 任意日程槽有牌 |
| hasReservedCard | 预约位有牌 |

### Pending-Choice 状态机

- [x] `PendingChoice` 统一类型（6 种：chooseFromHand / Discard / HandOrDiscard / scryDecision / gainFaceUpCardDecision / chooseTarget）
- [x] `InternalMatchState.pendingChoice` 字段
- [x] `applyStateEffects` 顺序处理，遇到 choice 效果暂停并挂起
- [x] `resolveChoice` 恢复结算 + 继续 `remainingEffects`
- [x] 有 pending 时除 SUBMIT_CHOICE / CONCEDE 外所有命令被拒绝
- [x] `PrivatePlayerView` 含 `discard` + `pendingChoice` 字段
- [x] `PublicMatchView` 含 `pendingChoiceSide` 字段
- [x] `gainFaceUpCardDecision`：市场牌候选 + 补位 + 进 discard/deckTop
- [x] `chooseTarget`：opponentPlayer / opponentVenue / selfVenue + TargetedEffect 解析

### 服务端（server）

- [x] Colyseus GameRoom 接入真实 engine.reduce
- [x] 命令分发（onMessage "*"）
- [x] 状态广播（PublicMatchView + PrivatePlayerView）
- [x] SUBMIT_CHOICE 自动通过 reduce → resolveChoice 处理（含 getCardCost 透传）
- [x] **v2 内容加载**：GameRoom.ts 从 `data/cards/rules/*.json` 加载
- [x] **AJV 运行时校验**：card rule / card text / set / content-pack / ruleset 全程受 schema 保护

### 客户端（game-client）

- [x] Phaser 场景：BootScene + RoomScene
- [x] 基础交互：READY / 打牌 / 买牌 / 攻击 / 结束回合 / 场馆 / 日程槽
- [x] 预约位 UI
- [x] 选择 UI：有 pendingChoice 时显示遮罩 + 候选按钮 + 提交
  - chooseCardsFrom* / scryDecision：原有卡牌选择 UI
  - **gainFaceUpCardDecision**：市场牌候选列表，最多选 1 张，可跳过
  - **chooseTarget**：目标按钮列表（玩家/场馆），选 1 个后确认
- [x] **ViewModel 层**：`BoardViewModel` + `buildBoardViewModel`
- [x] **client content-loader 集成**：`buildCardNames(locale)` → ViewModel 闭环

### 数据层（内容系统）

- [x] v2 内容系统（server 当前加载路径）
- [x] JSON Schema 体系（含 `chooseTarget` 新增到 op 白名单）
- [x] **23 张市场牌**（新增 green_anniversary_sponsor + red_cheer_combo）
  - `green_anniversary_sponsor`：gainResource(1) + gainFaceUpCard(maxCost=4, discard)
  - `red_cheer_combo`：gainAttack(1) + chooseTarget(opponentVenue, damageVenue 2)

---

## 未完成 ❌

### 规则机制

- [ ] **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- [ ] **市场牌刷新事件**：无 MARKET_REFILLED 事件广播
- [ ] **scry 完整排序**：当前最多弃 1 张 + 余下原序放回；无法自定义剩余顺序
- [ ] **selfVenue chooseTarget 配套牌**：框架已实现，待添加使用它的卡牌

### 数据

- [ ] 完整市场牌（当前 15 张市场牌，目标 24+）
- [ ] 完整起始套牌效果（draft_paper / punctuality 的 onScheduleResolve 未定义）

### 基础设施

- [ ] 断线重连（Colyseus `allowReconnection` 未配置）
- [ ] 回放记录（命令日志未持久化）
- [ ] 数据库（PostgreSQL + Prisma 未初始化）

### 客户端体验

- [ ] locale 运行时切换 UI
- [ ] 攻击分配 UI 细化
- [ ] 延迟弃牌视觉提示
- [ ] 弃牌堆视图
- [ ] 市场补位动画
- [ ] 正式卡图接入

---

## 测试覆盖（截至本轮）

### engine 包

| 文件 | 测试数 |
|------|--------|
| reduce.test.ts | 47 |
| market.test.ts | 24 |
| turn.test.ts | 12 |
| deck.test.ts | 13 |
| engine.test.ts | 1 |
| reserve.test.ts | 17 |
| effects.test.ts | 25 |
| schema.test.ts | 34 |
| delayedDiscard.test.ts | 19 |
| pendingChoice.test.ts | 24 |
| **gainFaceUpCard.test.ts** | **14** |
| **小计** | **230** |

### schemas 包

| 文件 | 测试数 |
|------|--------|
| validate.test.ts | 16 |
| content-system.test.ts | 49 |
| runtime-validation.test.ts | 11 |
| **小计** | **76** |

### game-client 包

| 文件 | 测试数 |
|------|--------|
| viewmodel.test.ts | 13 |
| locale.test.ts | 10 |
| **小计** | **23** |

**总计：329 个测试（engine 230 + schemas 76 + game-client 23）**
