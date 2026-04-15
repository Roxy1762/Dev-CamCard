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
- [x] **预约位机制**：
  - `reserveFromMarket`：支付 1 资源，预约公开槽牌，对应栏立即补位
  - `buyReservedCard`：下回合起购买，费用 -1
  - `hasReservedThisTurn` 每回合开始重置，`beginTurn` 中处理
  - 预约位一次只能 1 张，每回合只能预约 1 次
- [x] **延迟弃牌（queueDelayedDiscard）**（本轮新增）：
  - `pendingDiscardCount` 字段记录下回合开始时需弃牌数
  - `applyStateEffects` 正确积累到目标玩家
  - `beginTurn` 在清理阶段结算并归零（手牌不足时弃光即止）
  - 多次叠加正确累加
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
| createPressure | self / opponent | 产生压力牌 |
| scry | self | 预习：查看牌堆顶 N 张随机重洗（MVP，无交互）|
| setFlag | self | 设置标志位（如 nextBoughtCardToDeckTop）|
| gainFaceUpCard | — | ⚠️ 占位 no-op |
| **queueDelayedDiscard** | **self / opponent** | **让目标下回合开始时弃 N 张（本轮新增）** |

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
- [x] **预约位 UI**：
  - 我方区域显示预约牌 + "购买预约牌（折扣1）"按钮
  - 对方区域显示预约位占位状态
  - 商店每张市场牌下方有"预约(1资源)"按钮（满足条件时显示）
- [x] **pendingDiscardCount** 通过 PublicPlayerSummary 向双方广播（客户端可展示对手下回合弃牌数）

### 数据层

- [x] **v1 legacy 格式**（server 当前读取，保持兼容）：
  - starter.json（4 种起始牌）
  - fixed-supplies.json（3 种固定补给）
  - status.json（status_pressure，isPressure=true）
  - market-core.json（**11 张**：原 7 + 白色/中立 4 张，白色 3 张 v2 效果）
- [x] **v2 内容系统**（新分层结构，详见 docs/content-architecture.md）：
  - data/cards/rules/（4 文件，规则真源，无 name/text）
  - data/cards/text/zh-CN/（4 文件，中文文案）
  - data/cards/text/en-US/（4 文件，最小英文占位文案）
  - data/sets/core-v1.json（核心集清单，19 张卡 ID）
  - data/content-packs/base.json（基础包清单）
  - rules 卡牌 `artKey` 已在现有 19 张卡上补齐并统一（当前与 `id` 对齐）
- [x] **JSON Schema 体系**：
  - card.schema.json（v1，已补全 isPressure/isGuard，修正 rarity 枚举）
  - card-rule.schema.json（v2 规则真源 schema，新增）
  - card-text.schema.json（locale 文案 schema，新增）
  - set.schema.json（集合清单 schema，新增）
  - content-pack.schema.json（内容包 schema，新增）
- [x] **content-loader**（packages/schemas/src/content-loader.ts）：
  - loadCardRuleFile / loadCardTextFile
  - mergeCardDef（规则 + 文案合并）
  - getCardText（locale 安全降级）
  - loadRuleBatch / loadMergedBatch（批量加载）

---

## 未完成 ❌

### 规则机制

- [ ] **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- [ ] **市场牌刷新事件**：无 MARKET_REFILLED 事件广播
- [ ] **交互式 scry**：当前为随机重洗（无玩家选择顺序）
- [ ] **trashFromHandOrDiscard**：需 pending-action 状态机

### 数据

- [ ] 完整市场牌（当前 11 张，目标 24+ 张；course / activity 栏仍偏少）
- [ ] 完整起始套牌效果（draft_paper / punctuality 的 onScheduleResolve 未定义）

### 基础设施

- [ ] 断线重连（Colyseus `allowReconnection` 未配置）
- [ ] 回放记录（命令日志未持久化）
- [ ] 数据库（PostgreSQL + Prisma 未初始化）
- [x] AJV 校验：schemas 包已有 v1/v2 全套校验器，但 server 加载时**未接入运行时校验**（只有测试时校验）
- [ ] server 迁移至 v2 加载路径（当前仍读取旧 flat JSON）
- [ ] 完整 en-US 翻译（当前仅提供最小英文占位文案，保证 locale 不缺文件）

### 客户端体验

- [ ] 攻击分配 UI 细化（当前为"全力攻击对手"简化方案）
- [ ] 延迟弃牌视觉提示（pendingDiscardCount 已广播，但 RoomScene 尚未展示）
- [ ] 市场补位动画
- [ ] 手机端适配（MVP 不做）
- [ ] 实时观战（MVP 不做）

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
| schema.test.ts | 32 |
| delayedDiscard.test.ts | 19 |
| **小计** | **190** |

### schemas 包

| 文件 | 测试数 | 说明 |
|------|--------|------|
| validate.test.ts | 16 | v1 schema 校验 |
| **content-system.test.ts** | **46** | **v2 内容系统（含 locale fallback 与 artKey 完整性）** |
| **小计** | **62** | |

**总计：252 个测试（engine 190 + schemas 62）**
