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
- [x] 值守场馆（isGuard）限制攻击顺序
- [x] 日程槽（PUT_CARD_TO_SCHEDULE + onScheduleResolve 回合开始结算）
- [x] 多目标攻击分配（ASSIGN_ATTACK：攻玩家 / 攻场馆 / guard 限制）
- [x] 固定补给购买（BUY_FIXED_SUPPLY，无限数量）
- [x] **三栏市场主循环**（本轮完成）：
  - `createMarketState`：每栏随机洗牌，公开 2 张，其余入隐藏牌堆
  - `buyFromMarket`：购买后自动从同栏牌堆补位；牌堆空时保持空位
- [x] 结束回合（END_TURN）：弃行动牌 / 弃手牌 / 清防备 / 场馆重置 / 结算日程槽 / 摸至手上限
- [x] 投降（CONCEDE）

### 服务端（server）

- [x] Colyseus GameRoom 接入真实 engine.reduce
- [x] 命令分发（onMessage "*"）
- [x] 状态广播（PublicMatchView 全员 + PrivatePlayerView 各自）
- [x] 初始市场状态由 engine 纯函数构造（真实牌堆，已洗牌）

### 客户端（game-client）

- [x] Phaser 场景：BootScene（连接）+ RoomScene（对战 UI）
- [x] RoomClient 封装（Colyseus 连接 / 命令发送 / 双视图接收）
- [x] 基础交互：READY / 打牌 / 买牌 / 攻击 / 结束回合 / 场馆 / 日程槽

---

## 未完成 ❌

### 规则机制

- [ ] **预约位**（RESERVE_MARKET_CARD / BUY_RESERVED_CARD）：协议已定义，engine 为 no-op
- [ ] **压力牌（status_pressure）**：产生机制与回合结束弃置
- [ ] **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- [ ] **市场牌刷新事件**：目前无 MARKET_REFILLED 事件广播给客户端

### 数据

- [ ] 完整市场牌（当前仅 7 张，目标 24+ 张，三栏均衡）
- [ ] 完整起始套牌效果（draft_paper / punctuality 的 onScheduleResolve 未定义）

### 基础设施

- [ ] 断线重连（Colyseus `allowReconnection` 未配置）
- [ ] 回放记录（命令日志未持久化）
- [ ] 数据库（PostgreSQL + Prisma 未初始化）
- [ ] AJV 校验（卡牌 JSON 尚未接入 Schema 校验）

### 客户端体验

- [ ] 攻击分配 UI 细化（当前为"全力攻击对手"简化方案）
- [ ] 市场补位动画
- [ ] 手机端适配（MVP 不做）
- [ ] 实时观战（MVP 不做）

---

## 测试覆盖（截至本轮）

| 文件 | 测试数 |
|------|--------|
| reduce.test.ts | 47 |
| market.test.ts | 24 |
| turn.test.ts | 12 |
| deck.test.ts | 13 |
| engine.test.ts | 1 |
| **合计** | **97** |

全部通过（`pnpm --filter @dev-camcard/engine test`）。
