# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了三个大任务：
1. **预约位机制完整落地**：engine / server / client / tests 全链路实现
2. **白色体系卡牌数据补齐**：4 张新卡 + 最小 schema 测试
3. **效果系统扩充**：createPressure / scry / setFlag / checkCondition / applyStateEffects

---

## 上轮遗留任务（已整合为背景）

### 商店主循环修复（上轮完成）

`buyFromMarket` 购买后自动从同栏 `deck[0]` 补位。`createMarketState` 洗牌后公开 2 张，其余入隐藏牌堆。

---

## 本轮新增：预约位机制

### 规则实现

| 规则点 | 实现位置 |
|--------|---------|
| 每回合最多 1 次预约 | `hasReservedThisTurn` 字段 + `reserveFromMarket` 检查 |
| 预约需支付 1 资源 | `reserveFromMarket` 扣资源 |
| 只能预约公开市场牌 | `reserveFromMarket` 从 `market[].slots` 中找 |
| 预约后立即补位 | `reserveFromMarket` 同时从 `deck` 补位 |
| 预约牌只能未来回合买 | `reservedCardTurn` 字段 + `buyReservedCard` 检查 |
| 购买时费用 -1 | `reduce.ts: BUY_RESERVED_CARD` 调用 `Math.max(0, baseCost - 1)` |
| 预约位一次只能 1 张 | `reserveFromMarket` 检查 `reservedCard !== null` |

### 新增字段（InternalPlayerState）

```typescript
hasReservedThisTurn: boolean;    // 每回合重置为 false（在 beginTurn 中）
reservedCardTurn: number | null; // 预约时记录回合数，buy 时比较
activeFlags: string[];           // setFlag 效果使用，如 "nextBoughtCardToDeckTop"
```

### 新增纯函数（market.ts）

- `reserveFromMarket(state, side, instanceId, turnNumber)` — 预约
- `buyReservedCard(state, side, cost)` — 购买预约牌

### PublicPlayerSummary 新增字段

```typescript
hasReservedThisTurn: boolean; // 供客户端判断是否可再预约
```

### 客户端 UI（RoomScene.ts）

| 新增 UI 元素 | 说明 |
|-------------|------|
| 对方区域：`对方预约位: [已预约: xxx]` | 显示对手预约位状态（仅 id，不泄露其他信息） |
| 我方区域：`预约位: [xxx]` + 购买按钮 | 显示己方预约牌及购买按钮 |
| 商店区：每张市场牌下方加"预约(1资源)"按钮 | 可预约时显示，用完或已占位时隐藏 |

---

## 本轮新增：效果系统扩充

### 新增 CardEffect 类型

| op | 说明 | 实现状态 |
|----|------|---------|
| `createPressure` | 产生压力牌（到对手或自己的手牌） | ✅ 完整实现 |
| `scry` | 预习（查看牌堆顶 N 张；MVP 为随机重洗） | ✅ MVP 实现（无交互选择）|
| `setFlag` | 设置标志位（如 `nextBoughtCardToDeckTop`） | ✅ 完整实现 |
| `gainFaceUpCard` | 直接获取特定牌到手（暂为 no-op） | ⚠️ 占位，待明确来源 |

### 新增 CardCondition 类型

```typescript
{ type: "firstActionThisTurn" }          // played.length === 1
{ type: "actionsPlayedAtLeast"; count }  // played.length >= count
{ type: "hasVenue" }                     // venues.length > 0
{ type: "hasScheduledCard" }             // scheduleSlots.some(s => s !== null)
{ type: "hasReservedCard" }              // reservedCard !== null
```

### 新增函数

- `checkCondition(player, cond)` — 判断条件是否满足（`effects.ts`）
- `applyStateEffects(state, side, effects, random, maxHp, genId)` — 支持双方效果的状态级应用（`effects.ts`）

### 压力牌系统

- `status_pressure` 在 `status.json` 中标记 `isPressure: true`
- `CardDef.isPressure` 字段：打出时抛错（`handlePlayCard` 中检查）
- 服务端加载：`GameRoom.ts` 现在加载 `status.json` 并传入 `isPressure`
- 回合结束时压力牌随手牌一起弃置（已有行为，无需额外处理）

### nextBoughtCardToDeckTop 标志

当 `activeFlags` 含 `"nextBoughtCardToDeckTop"` 时，`BUY_MARKET_CARD` / `BUY_FIXED_SUPPLY` 后将新卡放到牌堆顶而非弃牌堆顶。此逻辑在 `reduce.ts: applyBuyFlag` 中实现。

---

## 本轮新增：卡牌数据（白色体系 + 中立）

| 卡牌 ID | lane | 效果 | 费用 |
|--------|------|------|------|
| `white_discipline_warning` | daily | createPressure(opp,1) + gainBlock(2) | 3 |
| `white_dorm_inspection` | daily | createPressure(opp,2) + gainBlock(1) | 4 |
| `white_student_affairs_talk` | daily | createPressure(opp,3) + gainBlock(3) | 5 |
| `neutral_finals_week` | course | createPressure(opp,2) + createPressure(self,1) | 3 |

`white_discipline_week` 已存在（获得 3 防备），无需修改。

---

## 已实现命令总表

| 命令 | 状态 |
|------|------|
| READY | ✅ |
| PLAY_CARD（行动牌） | ✅ |
| PLAY_CARD（场馆牌→进场） | ✅ |
| PLAY_CARD（压力牌→拒绝） | ✅ 本轮 |
| PUT_CARD_TO_SCHEDULE | ✅ |
| ACTIVATE_VENUE | ✅ |
| RESERVE_MARKET_CARD | ✅ 本轮 |
| BUY_RESERVED_CARD（折扣 -1） | ✅ 本轮 |
| BUY_MARKET_CARD（含补位） | ✅ |
| BUY_FIXED_SUPPLY | ✅ |
| ASSIGN_ATTACK（攻玩家） | ✅ |
| ASSIGN_ATTACK（攻场馆） | ✅ |
| ASSIGN_ATTACK（guard 限制） | ✅ |
| END_TURN（含日程槽结算） | ✅ |
| CONCEDE | ✅ |

---

## 已支持 Effect op 总表

| op | 目标 | 交互 | 状态 |
|----|------|------|------|
| gainResource | self | — | ✅ |
| gainAttack | self | — | ✅ |
| gainBlock | self | — | ✅ |
| heal | self | — | ✅ |
| draw | self | — | ✅ |
| drawThenDiscard | self | — | ✅ |
| createPressure | self / opponent | — | ✅ 本轮 |
| scry | self | ⚠️ 无交互（随机重洗） | ✅ MVP 本轮 |
| setFlag | self | — | ✅ 本轮 |
| gainFaceUpCard | self | — | ⚠️ no-op 占位 |

## 未覆盖（待后续实现）

- `trashFromHandOrDiscard`：需要玩家选择牌，需 pending-action 状态机
- `queueDelayedDiscard`：需延迟效果队列
- 交互式 `scry`（选择排列顺序）：同上，需 pending-action
- `gainFaceUpCard`：需明确牌源（固定堆 / 弃牌堆 / 特定 cardId）

---

## 还没完成的特色规则

- **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- **断线重连**：Colyseus 层未配置 `allowReconnection`
- **回放记录**：未实现
- **完整 66 张市场牌**：当前 11 张，三栏 daily 牌过多，course/activity 仍偏少

---

## 数据层

```
data/cards/
  starter.json         4 种起始牌（共 12 张/人）
  fixed-supplies.json  3 种固定补给
  status.json          压力状态牌（isPressure=true，机制已实现）
  market-core.json     11 种市场牌（原 7 + 本轮新增 4）
```

---

## 目录结构变化（本轮新增/修改）

```
packages/engine/src/
  types.ts         ← 修改：InternalPlayerState 新增 hasReservedThisTurn / reservedCardTurn / activeFlags
  effects.ts       ← 修改：新增 createPressure/scry/setFlag/gainFaceUpCard 效果类型
                            新增 CardCondition 类型及 checkCondition / applyStateEffects
  market.ts        ← 修改：新增 reserveFromMarket / buyReservedCard
  reduce.ts        ← 修改：处理 RESERVE_MARKET_CARD / BUY_RESERVED_CARD，
                            改用 applyStateEffects 替代 applyEffects，
                            新增 applyBuyFlag (nextBoughtCardToDeckTop)
  turn.ts          ← 修改：beginTurn 重置 hasReservedThisTurn；
                            onScheduleResolve 改用 applyStateEffects 支持压力效果；
                            TurnConfig 新增 genId
  init.ts          ← 修改：makePlayer 新增三个字段初始化
  projections.ts   ← 修改：PublicPlayerSummary 新增 hasReservedThisTurn

  __tests__/
    reserve.test.ts  ← 新增：18 个预约机制测试
    effects.test.ts  ← 新增：34 个效果系统测试
    schema.test.ts   ← 新增：11+ 个卡牌 JSON 结构测试
    reduce.test.ts   ← 修改：makePlayer fixture 新增三字段
    turn.test.ts     ← 修改：makePlayer fixture 新增三字段
    market.test.ts   ← 修改：makePlayer fixture 新增三字段
    deck.test.ts     ← 修改：makePlayer fixture 新增三字段

packages/protocol/src/
  views.ts         ← 修改：PublicPlayerSummary 新增 hasReservedThisTurn

apps/server/src/rooms/
  GameRoom.ts      ← 修改：加载 status.json，CardDef 新增 isPressure

apps/game-client/src/scenes/
  RoomScene.ts     ← 修改：预约 UI（对方预约位、己方预约位、市场预约按钮）

data/cards/
  market-core.json ← 修改：新增 4 张白色/中立牌
  status.json      ← 修改：status_pressure 新增 isPressure: true
```

---

## 测试覆盖

共 **171 个测试**，全部通过：

| 文件 | 测试数 | 本轮新增 |
|------|--------|---------|
| reduce.test.ts | 47 | 0（fixture 更新）|
| market.test.ts | 24 | 0（fixture 更新）|
| turn.test.ts | 12 | 0（fixture 更新）|
| deck.test.ts | 13 | 0（fixture 更新）|
| engine.test.ts | 1 | 0 |
| **reserve.test.ts** | **18** | +18 |
| **effects.test.ts** | **34** | +34 |
| **schema.test.ts** | **22** | +22 |
| **合计** | **171** | **+74** |

---

## 下一步最推荐做什么

1. **断线重连**：在 GameRoom 配置 `allowReconnection`，重连后重发私有视图
2. **完整市场牌**：补齐红/蓝/绿体系牌，保证三栏均衡（course / activity 各至少 4 张）
3. **场馆 onPlay 效果**：打出场馆时触发 onPlay 效果
4. **交互式 scry**：pending-action 状态机（player 发 SCRY_CHOOSE 命令，engine await 选择）
5. **回放记录**：在 GameRoom 记录每条命令，写入数据库
6. **攻击分配 UI 细化**：当前"全力攻击对手"简化方案

## 测试命令

```bash
# 引擎测试
pnpm --filter @dev-camcard/engine test

# 构建检查
pnpm --filter @dev-camcard/server build
pnpm --filter game-client build

# 本地开发
pnpm --filter @dev-camcard/server dev
pnpm --filter game-client dev
```
