# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了一个核心任务：
1. **`queueDelayedDiscard` 白色控制链完整闭环**：
   - 新增 `pendingDiscardCount` 状态字段
   - 实现 `queueDelayedDiscard` 效果（积累 → 广播 → 回合开始结算）
   - 白色控制牌数据更正为符合设计意图的真实控制效果
   - 19 个新增测试全部通过，总计 190 个测试

---

## 历史任务（已整合为背景）

### 商店主循环（已完成）

`buyFromMarket` 购买后自动从同栏 `deck[0]` 补位。`createMarketState` 洗牌后公开 2 张，其余入隐藏牌堆。

### 预约位机制（已完成）

| 规则点 | 实现位置 |
|--------|---------|
| 每回合最多 1 次预约 | `hasReservedThisTurn` 字段 + `reserveFromMarket` 检查 |
| 预约需支付 1 资源 | `reserveFromMarket` 扣资源 |
| 只能预约公开市场牌 | `reserveFromMarket` 从 `market[].slots` 中找 |
| 预约后立即补位 | `reserveFromMarket` 同时从 `deck` 补位 |
| 预约牌只能未来回合买 | `reservedCardTurn` 字段 + `buyReservedCard` 检查 |
| 购买时费用 -1 | `reduce.ts: BUY_RESERVED_CARD` 调用 `Math.max(0, baseCost - 1)` |
| 预约位一次只能 1 张 | `reserveFromMarket` 检查 `reservedCard !== null` |

### 效果系统（已完成）

- createPressure / scry / setFlag / gainFaceUpCard（占位）
- CardCondition 类型（firstActionThisTurn / actionsPlayedAtLeast / hasVenue / hasScheduledCard / hasReservedCard）
- checkCondition / applyStateEffects

---

## 本轮新增：延迟弃牌（queueDelayedDiscard）

### 规则实现

| 规则点 | 实现位置 |
|--------|---------|
| 积累阶段：效果让目标 pendingDiscardCount += N | `applyStateEffects` 中的 `delayedDiscardEffects` 分支 |
| 结算阶段：回合开始时弃 pendingDiscardCount 张 | `beginTurn` 步骤 1b，紧随清理防备之后 |
| 手牌不足时弃光即止，不抛错 | `Math.min(pendingDiscardCount, hand.length)` |
| 结算后归零 | `pendingDiscardCount: 0` |
| 多次叠加正确累加 | `pendingDiscardCount + dd.count` |
| 广播给双方客户端 | `PublicPlayerSummary.pendingDiscardCount` |

### 新增字段（InternalPlayerState）

```typescript
pendingDiscardCount: number;  // 下回合开始时需弃牌数，默认 0，beginTurn 后归零
```

### 新增 CardEffect 类型

```typescript
| { op: "queueDelayedDiscard"; count: number; target?: "opponent" | "self" }
```

### PublicPlayerSummary 新增字段

```typescript
pendingDiscardCount: number; // 供客户端展示"对手下回合将弃 N 张"提示
```

---

## 本轮更正：白色控制牌数据（v2）

原数据为 createPressure + gainBlock，现已更正为符合白色控制主题的设计意图：

| 卡牌 ID | lane | 原效果 | 更正后效果 | 费用 |
|--------|------|-------|-----------|------|
| `white_discipline_warning` | daily | createPressure(opp,1) + gainBlock(2) | **queueDelayedDiscard(opp,1)** + gainBlock(2) | 3 |
| `white_dorm_inspection` | daily | createPressure(opp,2) + gainBlock(1) | **queueDelayedDiscard(opp,2)** + gainBlock(1) | 4 |
| `white_student_affairs_talk` | daily | createPressure(opp,3) + gainBlock(3) | **queueDelayedDiscard(opp,3)** + gainBlock(3) | 5 |

> `neutral_finals_week`（createPressure 双方）和 `white_discipline_week`（gainBlock×3）保持不变。

---

## 已实现命令总表

| 命令 | 状态 |
|------|------|
| READY | ✅ |
| PLAY_CARD（行动牌） | ✅ |
| PLAY_CARD（场馆牌→进场） | ✅ |
| PLAY_CARD（压力牌→拒绝） | ✅ |
| PUT_CARD_TO_SCHEDULE | ✅ |
| ACTIVATE_VENUE | ✅ |
| RESERVE_MARKET_CARD | ✅ |
| BUY_RESERVED_CARD（折扣 -1） | ✅ |
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
| createPressure | self / opponent | — | ✅ |
| scry | self | ⚠️ 无交互（随机重洗） | ✅ MVP |
| setFlag | self | — | ✅ |
| gainFaceUpCard | self | — | ⚠️ no-op 占位 |
| **queueDelayedDiscard** | **self / opponent** | **—** | **✅ 本轮** |

## 未覆盖（待后续实现）

- `trashFromHandOrDiscard`：需要玩家选择牌，需 pending-action 状态机
- 交互式 `scry`（选择排列顺序）：同上，需 pending-action
- `gainFaceUpCard`：需明确牌源（固定堆 / 弃牌堆 / 特定 cardId）

---

## 还没完成的特色规则

- **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- **断线重连**：Colyseus 层未配置 `allowReconnection`
- **回放记录**：未实现
- **完整 66 张市场牌**：当前 11 张，three栏 daily 牌过多，course/activity 仍偏少

---

## 数据层

```
data/cards/
  starter.json         4 种起始牌（共 12 张/人）
  fixed-supplies.json  3 种固定补给
  status.json          压力状态牌（isPressure=true，机制已实现）
  market-core.json     11 种市场牌（原 7 + 4 张白色/中立，白色 3 张已升至 v2）
```

---

## 目录结构变化（本轮新增/修改）

```
packages/engine/src/
  types.ts         ← 修改：InternalPlayerState 新增 pendingDiscardCount
  effects.ts       ← 修改：新增 queueDelayedDiscard 类型；applyStateEffects 处理延迟弃牌
  turn.ts          ← 修改：beginTurn 步骤 1b 结算 pendingDiscardCount
  init.ts          ← 修改：makePlayer 新增 pendingDiscardCount: 0
  projections.ts   ← 修改：PublicPlayerSummary 新增 pendingDiscardCount

  __tests__/
    delayedDiscard.test.ts  ← 新增：19 个延迟弃牌测试（全路径覆盖）
    schema.test.ts          ← 修改：白色控制牌断言更新为 queueDelayedDiscard
    turn.test.ts / deck.test.ts / reduce.test.ts
    effects.test.ts / reserve.test.ts / market.test.ts
                            ← 修改：makePlayer fixture 新增 pendingDiscardCount: 0

packages/protocol/src/
  views.ts         ← 修改：PublicPlayerSummary 新增 pendingDiscardCount

data/cards/
  market-core.json ← 修改：white_discipline_warning / white_dorm_inspection /
                            white_student_affairs_talk 更正为 queueDelayedDiscard（v2）
```

---

## 测试覆盖

共 **190 个测试**，全部通过：

| 文件 | 测试数 | 本轮新增 |
|------|--------|---------|
| reduce.test.ts | 47 | 0（fixture 更新）|
| market.test.ts | 24 | 0（fixture 更新）|
| turn.test.ts | 12 | 0（fixture 更新）|
| deck.test.ts | 13 | 0（fixture 更新）|
| engine.test.ts | 1 | 0 |
| reserve.test.ts | 18 | 0 |
| effects.test.ts | 34 | 0 |
| schema.test.ts | 22 | 0（断言更新）|
| **delayedDiscard.test.ts** | **19** | **+19** |
| **合计** | **190** | **+19** |

---

## 下一步最推荐做什么

1. **批量补充市场牌**（Codex 适合）：补 `queueDelayedDiscard` / `createPressure` / `gainResource` 等已支持 op 的牌，让牌池厚度明显提升
2. **trashFromHandOrDiscard + pending-choice 状态机**（Claude 适合）：实现"从手牌/弃牌堆报废 N 张"——需要最小交互状态机
3. **断线重连**：在 GameRoom 配置 `allowReconnection`，重连后重发私有视图
4. **完整市场牌**：补齐红/蓝/绿体系牌（course / activity 各至少 4 张）
5. **回放记录**：在 GameRoom 记录每条命令，写入数据库

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
