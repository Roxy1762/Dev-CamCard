# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了 **chooseTarget 最小框架** 与 **gainFaceUpCard 正式落地**，两批被阻塞的市场牌开始可运行。

### 核心变更

1. **gainFaceUpCard 从 no-op 变为真实效果**（`packages/engine/src/effects.ts`）
   - 效果类型改为 `{ op: "gainFaceUpCard"; maxCost: number; destination?: "discard" | "deckTop" }`
   - 产生新 pending-choice 类型 `gainFaceUpCardDecision`，候选 = 市场中费用 ≤ maxCost 的槽位牌
   - 解决时：从市场槽移除目标牌 + 自动补位 + 加入 discard 或 deckTop
   - 若市场无满足候选，效果静默跳过（不产生 pending）
   - `applyStateEffects` / `resolveChoice` 新增可选参数 `getCardCost?: GetCardCost`
   - `reduce.ts` 中所有调用点透传 `config.getCardCost`

2. **chooseTarget 最小框架**（`packages/engine/src/effects.ts`）
   - 新效果类型 `{ op: "chooseTarget"; targetType; onChosen: TargetedEffect[] }`
   - `TargetedEffect` 支持 `damageVenue`（减场馆耐久，≤0 摧毁）和 `dealDamage`（直接扣 HP）
   - `TargetCandidate` 区分 `kind: "player" | "venue"`
   - 产生新 pending-choice 类型 `chooseTarget`，候选按 targetType 自动生成
   - 提交格式：玩家 `"player:0"` / `"player:1"`，场馆 `venueInstanceId`
   - 若无候选（如对手没有场馆），静默跳过

3. **协议层更新**（`packages/protocol/src/views.ts`）
   - `PendingChoiceView` 新增 `gainFaceUpCardDecision` 和 `chooseTarget` 两个变体
   - 新增 `TargetCandidateView` 导出类型

4. **投影层更新**（`packages/engine/src/projections.ts`）
   - `toPendingChoiceView` 处理新两种 choice 类型

5. **新卡牌接通**（`data/cards/rules/market-core.json`）
   - `green_anniversary_sponsor`（cost=5，rare）：gainResource(1) + gainFaceUpCard(maxCost=4, discard)
   - `red_cheer_combo`（cost=3，common）：gainAttack(1) + chooseTarget(opponentVenue, damageVenue 2)
   - zh-CN / en-US 文案同步添加
   - `core-v1.json` set 从 21 张扩展到 23 张

6. **Schema 更新**（`packages/schemas/schemas/card-rule.schema.json`）
   - op 白名单新增 `chooseTarget`

7. **客户端 UI**（`apps/game-client/src/scenes/RoomScene.ts`）
   - `drawChoicePanel` 新增 `gainFaceUpCardDecision` 分支：候选市场牌按钮，选 1 或跳过
   - `drawChoicePanel` 新增 `chooseTarget` 分支：目标按钮（玩家/场馆），必须选 1 个确认
   - `choiceTitleText` 补充两种新类型的标题文案

8. **测试**（`packages/engine/src/__tests__/gainFaceUpCard.test.ts`）
   - 新增 14 条聚焦测试，覆盖：候选筛选、跳过、进 discard/deckTop、市场补位、非法玩家提交、非法目标

---

## 历史任务（已整合为背景）

### 内容系统运行时接入（上轮）

server 加载链全程 AJV 保护，client locale 闭环接入 ViewModel。

### 数据层内容系统升级

规则数据与本地化文案分层，v2 schema 体系，content-loader，locale fallback。

### 效果执行框架升级

统一 pending-choice 模型，trashFromHandOrDiscard，interactive scry，
blue_draft_simulation / green_used_book_recycle 接通，client 选择 UI。

### queueDelayedDiscard 白色控制链 / 商店主循环 / 预约位机制 / 效果系统初版

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
| SUBMIT_CHOICE | ✅ |

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
| scry（interactive） | self | ✅ 玩家选择弃 0~1 张 | ✅ |
| setFlag | self | — | ✅ |
| gainFaceUpCard | self | ✅ 玩家从市场候选中选牌 | ✅ |
| queueDelayedDiscard | self / opponent | — | ✅ |
| trashFromHandOrDiscard | self | ✅ 玩家选择目标 | ✅ |
| chooseTarget | opponent/self | ✅ 玩家选择玩家或场馆 | ✅ |

## 已支持 TargetedEffect（chooseTarget.onChosen）

| op | 说明 |
|----|------|
| damageVenue | 减少场馆耐久；≤ 0 时摧毁 |
| dealDamage | 直接扣玩家 HP（非战斗伤害） |

---

## 数据层

```
data/
  cards/
    rules/
      market-core.json     15 种市场牌（新增 anniversary_sponsor + cheer_combo）
      starter.json / fixed-supplies.json / status.json
    text/zh-CN/ + text/en-US/   （同步新增 2 张牌文案）
  sets/
    core-v1.json     23 张卡牌 ID（+2）
```

---

## 测试覆盖

| 包 | 文件 | 测试数 |
|----|------|--------|
| engine | reduce.test.ts | 47 |
| engine | market.test.ts | 24 |
| engine | turn.test.ts | 12 |
| engine | deck.test.ts | 13 |
| engine | engine.test.ts | 1 |
| engine | reserve.test.ts | 17 |
| engine | effects.test.ts | 25 |
| engine | schema.test.ts | 34 |
| engine | delayedDiscard.test.ts | 19 |
| engine | pendingChoice.test.ts | 24 |
| engine | **gainFaceUpCard.test.ts** | **14** |
| schemas | validate.test.ts | 16 |
| schemas | content-system.test.ts | 49 |
| schemas | runtime-validation.test.ts | 11 |
| game-client | viewmodel.test.ts | 13 |
| game-client | locale.test.ts | 10 |
| **合计** | | **329** |

---

## 下一步推荐

1. **补全市场牌**：利用 gainFaceUpCard + chooseTarget 两个新 op，批量补充 red/blue/green/neutral 牌池（至少到 20 张）
2. **selfVenue 配套牌**：chooseTarget(selfVenue) 框架已实现，加一张修复/强化己方场馆的卡
3. **scry 完整排序**：`SubmitChoiceCmd` 加 `orderedInstanceIds`，`resolveScryChoice` 按序放回
4. **dealDamage 防备联动**：当前 dealDamage 绕过防备；可在需要时加入 block 抵消逻辑
5. **断线重连**：Colyseus `allowReconnection` + 重连后重发私有视图
6. **回放记录**：命令日志写入数据库

## 注意事项（next Claude）

- `applyStateEffects` 和 `resolveChoice` 新增了可选参数 `getCardCost?: GetCardCost`。  
  若不提供，`gainFaceUpCard` 效果无法筛选候选（视作无候选，静默跳过）。  
  `reduce.ts` 中已全部透传 `config.getCardCost`，测试中需自行构造并传入。
- `chooseTarget` 提交玩家目标时格式为字符串 `"player:0"` / `"player:1"`（不是数字）。
- `gainFaceUpCard` 无候选时**不产生 pendingChoice**，效果直接跳过，不影响 remainingEffects。

## 测试命令

```bash
pnpm --filter @dev-camcard/engine test
pnpm --filter @dev-camcard/schemas test
pnpm --filter @dev-camcard/game-client test
pnpm --filter @dev-camcard/server typecheck
pnpm --filter game-client exec tsc --noEmit
```
