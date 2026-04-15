# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了一个大任务：
1. **商店主循环修复**：实现三栏市场牌堆（courseDeck / activityDeck / dailyDeck），补位逻辑移入 engine 纯函数，并同步文档。

---

## 上轮遗留任务（已整合为背景）

### 任务 1：客户端联机牌桌（上轮完成）

#### 网络层组织

```
apps/game-client/src/network/
  RoomClient.ts     ← Colyseus 连接封装
```

**RoomClient** 负责：
- `joinOrCreate(roomName, options)` — 加入/创建 Colyseus 房间
- `onStateUpdate` 回调 — 接收 `EVT.state_update`（PublicMatchView）
- `onPrivateUpdate` 回调 — 接收 `EVT.private_update`（PrivatePlayerView）
- `send<T extends ClientCommand>(command)` — 发送命令给 server

#### 客户端当前可操作

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

---

## 本轮任务：商店主循环

### 核心改动

#### 类型变化（`packages/engine/src/types.ts`）

`MarketLaneState` 新增 `deck` 字段：

```typescript
export interface MarketLaneState {
  lane: Lane;
  slots: (CardInstance | null)[];   // 当前公开槽位
  deck: CardInstance[];              // 隐藏牌堆，deck[0] 为栈顶
}
```

#### 新增纯函数（`packages/engine/src/init.ts`）

```typescript
export function createMarketState(
  laneDefinitions: Array<{ lane: Lane; cardIds: string[] }>,
  slotsPerLane: number,
  genId: () => string,
  random: () => number
): MarketLaneState[]
```

职责：
- 对每栏 cardIds 用 `genId` 生成实例
- 用 `shuffle` 洗牌
- 前 `slotsPerLane` 张放入 `slots`（公开）
- 其余放入 `deck`（隐藏）

#### 补位逻辑（`packages/engine/src/market.ts`）

`buyFromMarket` 已更新：买走一张后，自动从该栏 `deck[0]` 补位。若 deck 为空则槽位保持 null。

#### 服务端初始化（`apps/server/src/rooms/GameRoom.ts`）

`buildInitialMarket`（旧，只填首 2 张，无牌堆）→ 替换为：

```typescript
const laneDefinitions = buildLaneDefinitions(marketCards, ruleset.marketLanesCount);
const market = createMarketState(laneDefinitions, ruleset.marketSlotsPerLane, this.genId);
```

`buildLaneDefinitions` 只做 JSON 分组，不做规则逻辑（规则留在 engine）。

### market-core.json 各栏分布

| 卡牌 ID | lane |
|---------|------|
| blue_all_night_study | course |
| red_pre_match_warmup | activity |
| red_extra_training_plan | activity |
| green_makerspace | activity |
| white_duty_student | daily |
| white_discipline_week | daily |
| neutral_class_representative_notice | daily |

共 7 张：course 1 张、activity 3 张、daily 3 张。  
每局开始：每栏随机洗牌后公开 2 张，其余入隐藏牌堆。  
（activity 3 张 → 2 公开 1 入堆；daily 3 张 → 2 公开 1 入堆；course 1 张 → 1 公开 0 入堆）

---

## 已实现命令总表

| 命令 | 状态 |
|------|------|
| READY | ✅ |
| PLAY_CARD（行动牌） | ✅ |
| PLAY_CARD（场馆牌→进场） | ✅ |
| PUT_CARD_TO_SCHEDULE | ✅ |
| ACTIVATE_VENUE | ✅ |
| BUY_MARKET_CARD（含补位） | ✅ 本轮完善 |
| BUY_FIXED_SUPPLY | ✅ |
| ASSIGN_ATTACK（攻玩家） | ✅ |
| ASSIGN_ATTACK（攻场馆） | ✅ |
| ASSIGN_ATTACK（guard 限制） | ✅ |
| END_TURN（含日程槽结算） | ✅ |
| CONCEDE | ✅ |

---

## 还没完成的特色规则

- **预约（RESERVE_MARKET_CARD / BUY_RESERVED_CARD）**：协议已定义，engine 返回 no-op
- **压力牌（status_pressure）**：产生机制、弃置时机未实现
- **场馆 onPlay 效果**：目前场馆进场无效果（只有 onActivate）
- **断线重连**：Colyseus 层未配置 `allowReconnection`
- **回放记录**：未实现
- **完整 66 张市场牌**：当前只有 7 张，按 lane 分布不均衡

---

## 数据层

```
data/cards/
  starter.json         4 种起始牌（共 12 张/人）
  fixed-supplies.json  3 种固定补给
  status.json          压力状态牌（定义存在，机制未实现）
  market-core.json     7 种首批市场牌
```

---

## 目录结构变化（本轮新增）

```
packages/engine/src/
  types.ts     ← 修改：MarketLaneState 新增 deck 字段
  init.ts      ← 修改：新增 createMarketState 纯函数
  market.ts    ← 修改：buyFromMarket 增加自动补位逻辑

apps/server/src/rooms/
  GameRoom.ts  ← 修改：用 createMarketState 替换旧 buildInitialMarket
```

---

## 测试覆盖

共 **97 个测试**，全部通过：
- `reduce.test.ts`：47（修复 market fixture 缺少 deck 字段）
- `turn.test.ts`：12
- `market.test.ts`：24（原 12，本轮新增 12）
  - buyFromMarket 补位：5 个新测试
  - createMarketState 初始化：7 个新测试
- `deck.test.ts`：13
- `engine.test.ts`：1

---

## 下一步最推荐做什么

1. **预约机制**：实现 RESERVE_MARKET_CARD / BUY_RESERVED_CARD（协议已就绪，engine 需实现）
2. **断线重连**：在 GameRoom 配置 `allowReconnection`，重连后重发私有视图
3. **压力牌**：status_pressure 产生（某些卡效果）与弃置（回合结束）
4. **完整市场牌**：补齐 24 张红/蓝/白/绿市场牌 JSON，保证三栏均有足够牌
5. **攻击分配 UI 细化**：当前"全力攻击对手"简化方案，改为可输入分配量的 UI
6. **回放记录**：在 GameRoom 记录每条命令，写入数据库

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
