# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了两个大任务：
1. **任务 1：game-client 推进为最小可玩 Phaser 联机牌桌**
2. **任务 2：engine 新增日程槽、场馆/值守、多目标攻击、首批市场牌**

---

## 任务 1：客户端联机牌桌

### 网络层组织

```
apps/game-client/src/network/
  RoomClient.ts     ← Colyseus 连接封装
```

**RoomClient** 负责：
- `joinOrCreate(roomName, options)` — 加入/创建 Colyseus 房间
- `onStateUpdate` 回调 — 接收 `EVT.state_update`（PublicMatchView），可替换
- `onPrivateUpdate` 回调 — 接收 `EVT.private_update`（PrivatePlayerView），可替换
- `send<T extends ClientCommand>(command)` — 发送命令给 server

发送格式：`room.send(type, payload)`，server 端以 `{ type, ...payload }` 重组为 ClientCommand。

### BootScene 连接流程

1. 预加载占位资源（SVG）
2. 创建 RoomClient，注册 `onStateUpdate` + `onPrivateUpdate` 双重回调
3. `joinOrCreate("game_room", {})` 连接
4. **同时等待**首个 PublicMatchView 和 PrivatePlayerView 均到达
5. 两者到齐后切换到 `RoomScene`，传入 `{ view, privateView, roomClient }`
6. 连接失败显示错误文字，不静默失败

### Public / Private view 在客户端的消费方式

```
BootScene
  ├─ 等待 state_update → PublicMatchView
  └─ 等待 private_update → PrivatePlayerView
       ↓ (两者均到达)
RoomScene
  ├─ this.view: PublicMatchView         — 双方可见信息
  └─ this.privateView: PrivatePlayerView — 仅含自己的手牌 + side
```

RoomScene 通过 `privateView.side` 判断自己是哪个席位（0 或 1），以此区分"我方"和"对方"。

### 客户端当前可操作

| 操作 | 触发条件 | 命令 |
|------|---------|------|
| READY | 游戏未开始 | `CMD.READY` |
| 打出手牌 | 我的回合 | `CMD.PLAY_CARD` |
| 将手牌安排到日程槽 | 我的回合 + 有空槽 | `CMD.PUT_CARD_TO_SCHEDULE` |
| 启动场馆 | 我的回合 + activationsLeft>0 | `CMD.ACTIVATE_VENUE` |
| 购买商店牌 | 我的回合 | `CMD.BUY_MARKET_CARD` |
| 购买固定补给 | 我的回合 | `CMD.BUY_FIXED_SUPPLY` |
| 攻击对手（全力） | 我的回合 + attackPool>0 | `CMD.ASSIGN_ATTACK` |
| 结束回合 | 我的回合 | `CMD.END_TURN` |
| 投降 | 任意时刻 | `CMD.CONCEDE` |

### 资源目录组织

```
apps/game-client/public/assets/
  cards/art/       card-art-placeholder.svg
  cards/backs/     card-back-placeholder.svg
  cards/frames/    .gitkeep
  icons/           .gitkeep
  ui/              ui-placeholder.svg
assets-src/        README（原始设计资源，不直接给运行时加载）
```

占位资源在 BootScene.preload() 中通过 `preloadRuntimePlaceholders()` 注册。
后续只需把相同 key 的真实资源替换到同路径，无需改代码。

---

## 任务 2：引擎新机制

### 日程槽如何结算

- 命令 `PUT_CARD_TO_SCHEDULE { instanceId, slotIndex }` — 将手牌放入空日程槽
- 每位玩家最多 2 个日程槽（`ruleset.scheduleSlots = 2`）
- **结算时机**：在 `beginTurn()` 中，即玩家自己的回合开始时
- 结算步骤（对每个非空槽）：
  1. 找到 `cardDef`，执行所有 `trigger=onScheduleResolve` 的效果
  2. 将该牌移入弃牌堆
  3. 槽位清空为 null
- 一张牌不能重复安排（但可以打出后再安排另一张）

### 场馆/值守如何结算

#### 进场
- 命令 `PLAY_CARD { instanceId }` — 若 cardDef.type=venue，进入 `player.venues`，不进 played 区
- 进场时 `activationsLeft = 0`（不能当回合启动）
- 进场时 `durability = maxDurability = cardDef.durability`

#### 回合开始重置（beginTurn）
- `activationsLeft = activationsPerTurn`（通常 1）
- `durability = maxDurability`（耐久伤害不保留）

#### 启动
- 命令 `ACTIVATE_VENUE { instanceId }` — 要求 `activationsLeft > 0`
- 执行所有 `trigger=onActivate` 的效果，然后 `activationsLeft -= 1`

#### 被摧毁
- 当 `durability <= 0`（被攻击打爆）：从 `player.venues` 移除，加入 `player.discard`

#### 值守场馆（isGuard=true）
- 对方有 isGuard 场馆时，ASSIGN_ATTACK 中**不允许**攻击玩家或非守卫场馆
- 必须先将所有 guard venues 打爆才能攻击玩家

### 攻击目标模型

```typescript
interface AttackAssignment {
  amount: number;
  target: "player" | "venue";
  targetSide: PlayerSide;
  venueInstanceId?: string;   // 攻击场馆时必填
}
```

- `ASSIGN_ATTACK { assignments: AttackAssignment[] }` — 支持多条分配
- 每条分配从 `attackPool` 中扣除 `amount`
- 先进行 guard 检查（存在 guard venue 时的限制）
- 攻击玩家：先扣 block，再扣 hp；hp≤0 结束对局
- 攻击场馆：减少当前 `durability`；≤0 时摧毁（进入 discard）
- 场馆未被摧毁时，当前回合内耐久减少；在 beginTurn 时重置（伤害不保留）

### 已实现命令总表

| 命令 | 状态 |
|------|------|
| READY | ✅ |
| PLAY_CARD（行动牌） | ✅ |
| PLAY_CARD（场馆牌→进场） | ✅ 本轮新增 |
| PUT_CARD_TO_SCHEDULE | ✅ 本轮新增 |
| ACTIVATE_VENUE | ✅ 本轮新增 |
| BUY_MARKET_CARD | ✅ |
| BUY_FIXED_SUPPLY | ✅ |
| ASSIGN_ATTACK（攻玩家） | ✅ |
| ASSIGN_ATTACK（攻场馆） | ✅ 本轮新增 |
| ASSIGN_ATTACK（guard 限制） | ✅ 本轮新增 |
| END_TURN（含日程槽结算） | ✅ 本轮扩展 |
| CONCEDE | ✅ |

### 当前还没完成的特色规则

- **预约（RESERVE_MARKET_CARD / BUY_RESERVED_CARD）**：协议已定义，engine 返回 no-op
- **压力牌（status_pressure）**：产生机制、弃置时机未实现
- **场馆 onPlay 效果**：目前场馆进场无效果（只有 onActivate）
- **商店刷新（MARKET_REFILLED）**：买走后不补充
- **断线重连**：Colyseus 层未配置
- **回放记录**：未实现
- **完整 66 张市场牌**：当前只有 7 张

### 数据层

```
data/cards/
  starter.json         4 种起始牌（共 12 张/人）
  fixed-supplies.json  3 种固定补给
  status.json          压力状态牌（定义存在，机制未实现）
  market-core.json     7 种首批市场牌（本轮新增）
```

**market-core.json 卡牌说明：**

| 卡牌 ID | 类型 | 关键机制 |
|---------|------|---------|
| red_pre_match_warmup | action | onPlay gainAttack 1 + onScheduleResolve gainAttack 2 |
| red_extra_training_plan | action | onPlay draw 1 + onScheduleResolve gainAttack 2 |
| blue_all_night_study | action | onPlay gainResource 2 + onScheduleResolve draw 2 |
| white_duty_student | venue (guard) | isGuard=true, dur=4, onActivate gainBlock 1 |
| white_discipline_week | action | onPlay gainBlock 3 |
| green_makerspace | venue | dur=5, onActivate gainResource 2 |
| neutral_class_representative_notice | action | onPlay draw 1 + gainResource 1 |

### 测试覆盖

共 **85 个测试**，全部通过：
- `reduce.ts` 测试：47（含本轮新增 17 个）
- `turn.ts` 测试：12
- `market.ts` 测试：12
- `deck.ts` 测试：13
- `engine.ts` 测试：1

---

## 目录结构变化

```
packages/engine/src/
  effects.ts      ← 修改：新增 onScheduleResolve/onActivate trigger；CardDef 增加 venue 字段
  types.ts        ← 修改：VenueState 新增 maxDurability
  turn.ts         ← 修改：beginTurn 增加场馆重置 + 日程槽结算；新增 TurnConfig
  reduce.ts       ← 修改：PUT_CARD_TO_SCHEDULE / ACTIVATE_VENUE / 场馆 PLAY_CARD / 增强 ASSIGN_ATTACK
  __tests__/reduce.test.ts  ← 修改：新增 17 个测试

data/cards/
  market-core.json  ← 新增：7 张首批市场牌

apps/server/src/rooms/
  GameRoom.ts     ← 修改：加载 market-core.json，初始化商店槽

apps/game-client/src/
  network/RoomClient.ts   ← 修改：新增 onPrivateUpdate 回调 + send() 方法
  scenes/BootScene.ts     ← 修改：等待 public+private 双视图
  scenes/RoomScene.ts     ← 重写：完整交互 UI（READY/打牌/买牌/攻击/结束回合/场馆/日程）
```

---

## 下一步最推荐做什么

1. **断线重连**：在 GameRoom 配置 `allowReconnection`，重连后重发私有视图
2. **商店刷新**：买走后从对应 lane 的牌池中补充，需要在 server 维护牌池
3. **预约机制**：实现 RESERVE_MARKET_CARD / BUY_RESERVED_CARD 命令
4. **压力牌**：status_pressure 产生（某些卡效果）与弃置（回合结束）
5. **攻击分配 UI 细化**：当前"全力攻击对手"简化方案，改为可输入分配量的 UI
6. **完整市场牌**：补齐 24 张红/蓝/白/绿市场牌 JSON，实现按 lane 随机发牌
7. **回放记录**：在 GameRoom 记录每条命令，写入数据库

## 测试命令

```bash
# 引擎测试
pnpm --filter @dev-camcard/engine test

# 构建检查
pnpm --filter @dev-camcard/server build
pnpm --filter game-client build

# 本地开发（需开两个终端）
pnpm --filter @dev-camcard/server dev
pnpm --filter game-client dev
```
