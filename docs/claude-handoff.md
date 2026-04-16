# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了**效果执行框架升级**：从"若干特例效果"演化为具备长期扩展能力的统一执行框架，并落地了 `trashFromHandOrDiscard` 和交互式 `scry` 两个复杂能力。

### 核心变更

1. **统一 pending-choice 模型**（`packages/engine/src/effects.ts`）
   - 新增 `PendingChoice` discriminated union（4 种类型：chooseCardsFromHand / Discard / HandOrDiscard / scryDecision）
   - 支持 `minCount / maxCount / remainingEffects / activeSide / forSide`
   - `applyStateEffects` 改为顺序处理，遇到 choice 效果后暂停并写入 `pendingChoice`
   - 新增 `resolveChoice` 函数，处理玩家响应并继续结算 `remainingEffects`

2. **新增 CardEffect**
   - `trashFromHandOrDiscard`（zone = hand/discard/either）
   - `scry` 新增 `interactive?: boolean` 字段（true = 等待玩家决策）

3. **InternalMatchState 新增字段**（`packages/engine/src/types.ts`）
   - `pendingChoice: PendingChoice | null`

4. **Protocol 扩展**（`packages/protocol/src/`）
   - `SUBMIT_CHOICE` 命令 + `SubmitChoiceCmd`
   - `PendingChoiceView` 类型（客户端视图）
   - `PrivatePlayerView` 新增 `discard: PublicCardRef[]` + `pendingChoice: PendingChoiceView | null`
   - `PublicMatchView` 新增 `pendingChoiceSide: PlayerSide | null`

5. **reduce.ts 保护**（`packages/engine/src/reduce.ts`）
   - `SUBMIT_CHOICE` 分发到 `resolveChoice`
   - `assertNoPendingChoice` 保护：有 pending 时除 SUBMIT_CHOICE / CONCEDE 外一律拒绝

6. **投影层**（`packages/engine/src/projections.ts`）
   - `toPrivatePlayerView` 包含 `discard` + `pendingChoice`（仅给 `forSide` 对应玩家）

7. **客户端选择 UI**（`apps/game-client/src/scenes/RoomScene.ts`）
   - `drawChoicePanel`：遮罩 + 候选牌按钮 + 选中高亮 + 确认提交
   - `choiceSelected` 状态跟踪

8. **新增卡牌数据**（`data/cards/market-core.json` + `rules/` + `text/`）
   - `green_used_book_recycle`（trashFromHandOrDiscard + gainResource）
   - `blue_draft_simulation`（interactive scry + gainResource）

9. **测试**：`pendingChoice.test.ts`（24 个）

10. **文档**：`docs/effect-execution-model.md`

---

## 历史任务（已整合为背景）

### 数据层内容系统升级（上轮）

规则数据与本地化文案分层，v2 schema 体系，content-loader，locale fallback。

### queueDelayedDiscard 白色控制链

### 商店主循环 / 预约位机制

### 效果系统初版

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
| **SUBMIT_CHOICE** | **✅ 本轮** |

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
| scry（非交互） | self | — | ✅ MVP |
| **scry（interactive）** | **self** | **✅ 玩家选择弃 0~1 张** | **✅ 本轮** |
| setFlag | self | — | ✅ |
| gainFaceUpCard | — | — | ⚠️ no-op 占位 |
| queueDelayedDiscard | self / opponent | — | ✅ |
| **trashFromHandOrDiscard** | **self** | **✅ 玩家选择目标** | **✅ 本轮** |

## 已支持 CardCondition 总表

| condition.type | 说明 |
|----------------|------|
| firstActionThisTurn | 本回合第一张行动牌 |
| actionsPlayedAtLeast | 本回合已打出至少 N 张行动牌 |
| hasVenue | 己方至少有 1 座场馆 |
| hasScheduledCard | 任意日程槽有牌 |
| hasReservedCard | 预约位有牌 |

---

## 还没完成的特色规则

- **场馆 onPlay 效果**：进场时无效果（onActivate 已实现）
- **断线重连**：Colyseus 层未配置 `allowReconnection`
- **回放记录**：未实现
- **完整 66 张市场牌**：当前 13 张，course 偏少
- **gainFaceUpCard**：no-op 占位，需确定牌源
- **scry 完整排序**：当前只能弃 0~1 张，无法自定义剩余顺序

---

## 数据层

```
data/
  cards/
    # ── v1 legacy（server 当前读取路径）──
    starter.json
    fixed-supplies.json
    status.json
    market-core.json     13 种市场牌（本轮新增 used_book_recycle + draft_simulation）

    # ── v2 内容系统（新分层结构）──
    rules/
      market-core.json   （同步更新，含新卡）
    text/zh-CN/
      market-core.json   （同步更新）
    text/en-US/
      market-core.json   （同步更新）
```

---

## 测试覆盖

### engine 包（本轮后）

| 文件 | 测试数 | 本轮变化 |
|------|--------|---------|
| reduce.test.ts | 47 | 0 |
| market.test.ts | 24 | 0 |
| turn.test.ts | 12 | 0 |
| deck.test.ts | 13 | 0 |
| engine.test.ts | 1 | 0 |
| reserve.test.ts | 17 | 0 |
| effects.test.ts | 25 | 0 |
| schema.test.ts | 34 | +2（新卡数据验证）|
| delayedDiscard.test.ts | 19 | 0 |
| **pendingChoice.test.ts** | **24** | **✅ 本轮新增** |
| **小计** | **216** | |

### schemas 包（62 个，无变化）

---

## 下一步推荐

1. **server 迁移至 v2 加载路径**：`GameRoom.ts` 改从 `data/cards/rules/*.json` 加载
2. **gainFaceUpCard 落地**：确定牌源（固定堆 / 弃牌堆 / cardId），实现 no-op → 真实效果
3. **scry 完整排序**：`SubmitChoiceCmd` 加 `orderedInstanceIds`，`resolveScryChoice` 按序放回
4. **chooseTarget（场馆选择）**：新增 `chooseTarget` pending 类型，扩展攻击分配 UI
5. **断线重连**：Colyseus `allowReconnection` + 重连后重发私有视图
6. **回放记录**：命令日志写入数据库
7. **补全市场牌**（Codex 适合）：利用已支持的 op 批量补充 red/blue/green/neutral 牌池

## 测试命令

```bash
# 引擎测试（含 pendingChoice）
pnpm --filter @dev-camcard/engine test

# 构建检查
pnpm --filter @dev-camcard/server build
pnpm --filter game-client build

# 本地开发
pnpm --filter @dev-camcard/server dev
pnpm --filter game-client dev
```
