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
- [x] 资源（resourcePool）/ 攻击（attackPool）/ 防备（block）/ 血量（hp）
- [x] 打出行动牌（PLAY_CARD）+ onPlay 效果
- [x] 场馆牌进场（PLAY_CARD venue）+ onActivate 效果
- [x] 压力牌不可打出（PLAY_CARD 拒绝 isPressure 牌）
- [x] 值守场馆（isGuard）限制攻击顺序
- [x] 日程槽（PUT_CARD_TO_SCHEDULE + onScheduleResolve 回合开始结算）
- [x] 多目标攻击分配（ASSIGN_ATTACK：攻玩家 / 攻场馆 / guard 限制）
- [x] 固定补给购买（BUY_FIXED_SUPPLY，无限数量）
- [x] **三栏市场主循环**：`createMarketState` 洗牌 + 公开槽 + 隐藏牌堆；`buyFromMarket` 自动补位
- [x] **预约位机制**（本轮完成）：
  - `reserveFromMarket`：支付 1 资源，预约公开槽牌，对应栏立即补位
  - `buyReservedCard`：下回合起购买，费用 -1
  - `hasReservedThisTurn` 每回合开始重置，`beginTurn` 中处理
  - 预约位一次只能 1 张，每回合只能预约 1 次
- [x] 结束回合（END_TURN）：弃行动牌 / 弃手牌（含压力）/ 清防备 / 场馆重置 / 结算日程槽 / 摸至手上限
- [x] 投降（CONCEDE）

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
| createPressure | self / opponent | 产生压力牌（本轮新增） |
| scry | self | 预习：查看牌堆顶 N 张随机重洗（MVP，无交互）|
| setFlag | self | 设置标志位（如 nextBoughtCardToDeckTop）|
| gainFaceUpCard | — | ⚠️ 占位 no-op |

已支持的 `CardCondition` type（用于 CardAbility.condition）：

| condition.type | 说明 |
|----------------|------|
| firstActionThisTurn | 本回合第一张行动牌 |
| actionsPlayedAtLeast | 本回合已打出至少 N 张行动牌 |
| hasVenue | 己方至少有 1 座场馆 |
| hasScheduledCard | 任意日程槽有牌 |
| hasReservedCard | 预约位有牌 |

### 服务端（server）

- [x] Colyseus GameRoom 接入真实 engine.reduce
- [x] 命令分发（onMessage "*"）
- [x] 状态广播（PublicMatchView 全员 + PrivatePlayerView 各自）
- [x] 初始市场状态由 engine 纯函数构造（真实牌堆，已洗牌）
- [x] 加载 status.json，CardDef.isPressure 正确传递引擎

### 客户端（game-client）

- [x] Phaser 场景：BootScene（连接）+ RoomScene（对战 UI）
- [x] RoomClient 封装（Colyseus 连接 / 命令发送 / 双视图接收）
- [x] 基础交互：READY / 打牌 / 买牌 / 攻击 / 结束回合 / 场馆 / 日程槽
- [x] **预约位 UI**（本轮完成）：
  - 我方区域显示预约牌 + "购买预约牌（折扣1）"按钮
  - 对方区域显示预约位占位状态
  - 商店每张市场牌下方有"预约(1资源)"按钮（满足条件时显示）

### 数据层

- [x] starter.json（4 种起始牌）
- [x] fixed-supplies.json（3 种固定补给）
- [x] status.json（status_pressure，isPressure=true）
- [x] market-core.json（**11 张**：原 7 + 本轮新增 4 张白/中立）：
  - white_discipline_warning（createPressure×1 + gainBlock×2）
  - white_dorm_inspection（createPressure×2 + gainBlock×1）
  - white_student_affairs_talk（createPressure×3 + gainBlock×3）
  - neutral_finals_week（createPressure 双方）

---

## 未完成 ❌

### 规则机制

- [ ] **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- [ ] **市场牌刷新事件**：无 MARKET_REFILLED 事件广播
- [ ] **交互式 scry**：当前为随机重洗（无玩家选择顺序）
- [ ] **trashFromHandOrDiscard**：需 pending-action 状态机
- [ ] **queueDelayedDiscard**：需延迟效果队列

### 数据

- [ ] 完整市场牌（当前 11 张，目标 24+ 张；course / activity 栏仍偏少）
- [ ] 完整起始套牌效果（draft_paper / punctuality 的 onScheduleResolve 未定义）

### 基础设施

- [ ] 断线重连（Colyseus `allowReconnection` 未配置）
- [ ] 回放记录（命令日志未持久化）
- [ ] 数据库（PostgreSQL + Prisma 未初始化）
- [ ] AJV 校验（卡牌 JSON 尚未接入 Schema 校验，当前为代码断言）

### 客户端体验

- [ ] 攻击分配 UI 细化（当前为"全力攻击对手"简化方案）
- [ ] 市场补位动画
- [ ] 手机端适配（MVP 不做）
- [ ] 实时观战（MVP 不做）

---

## 测试覆盖（截至本轮）

| 文件 | 测试数 | 说明 |
|------|--------|------|
| reduce.test.ts | 47 | |
| market.test.ts | 24 | |
| turn.test.ts | 12 | |
| deck.test.ts | 13 | |
| engine.test.ts | 1 | |
| reserve.test.ts | 18 | 本轮新增 |
| effects.test.ts | 34 | 本轮新增 |
| schema.test.ts | 22 | 本轮新增 |
| **合计** | **171** | **全部通过** |
