# Effect 执行模型（Effect Execution Model）

> 本文档描述 `packages/engine` 中效果执行框架的分层设计，以及 pending-choice 状态机的工作方式。

---

## 一、Effect 分层

```
CardEffect
  ├── 【直接效果】    立即应用，无副作用，只影响 activeSide 玩家
  │     gainResource / gainAttack / gainBlock / heal
  │     draw / drawThenDiscard
  │     setFlag / gainFaceUpCard（后者 MVP 占位）
  │     scry（interactive=false，随机重洗，无交互）
  │
  ├── 【双方效果】    涉及对手状态，需要访问双方玩家
  │     createPressure（target = opponent/self）
  │     queueDelayedDiscard（target = opponent/self）
  │
  ├── 【选择效果】    需要玩家做出决策，产生 PendingChoice，暂停结算
  │     trashFromHandOrDiscard（zone = hand/discard/either）
  │     scry（interactive=true，玩家决定弃哪张）
  │
  └── 【延迟效果】    记录到字段，在特定时机批量结算
        queueDelayedDiscard → pendingDiscardCount，beginTurn 时结算
```

---

## 二、核心执行流程

### 2.1 `applyStateEffects`（顺序处理）

```
for effect in effects:
    if isChoiceEffect(effect):
        记录 remainingEffects = effects[i+1:]
        创建 pendingChoice 写入 state
        return state   ← 暂停，等待 SUBMIT_CHOICE
    else:
        applySingleStateEffect(state, effect)

return state   ← 全部效果处理完毕
```

**关键保证**：choice 效果之前的效果已全部应用，choice 之后的效果存入 `pendingChoice.remainingEffects`，choice 解决后再继续执行。

### 2.2 `resolveChoice`（choice 解决后继续）

```
验证 choice.forSide === side
验证选择合法性（数量范围 / instanceId 存在于正确区域）
执行 choice 效果（报废所选牌 / 重排 scry 牌堆）
清空 pendingChoice（置 null）
调用 applyStateEffects(state, activeSide, remainingEffects)
```

---

## 三、PendingChoice 结构

```typescript
type PendingChoice =
  | { type: "chooseCardsFromHand";          forSide; activeSide; minCount; maxCount; remainingEffects }
  | { type: "chooseCardsFromDiscard";       forSide; activeSide; minCount; maxCount; remainingEffects }
  | { type: "chooseCardsFromHandOrDiscard"; forSide; activeSide; minCount; maxCount; remainingEffects }
  | { type: "scryDecision";                 forSide; activeSide; revealedCards; deckBelow; maxDiscard; remainingEffects }
```

| 字段 | 说明 |
|------|------|
| `forSide` | 需要做出选择的玩家席位 |
| `activeSide` | 效果来源方（继续结算 `remainingEffects` 时使用） |
| `minCount` | 最少选择张数（0 = 可跳过） |
| `maxCount` | 最多选择张数 |
| `remainingEffects` | 选择完成后继续执行的效果列表 |
| `revealedCards` | scryDecision 专用：已翻开的牌（玩家可见） |
| `deckBelow` | scryDecision 专用：翻开牌下面的牌堆（原序保留） |

**MVP 约定**：`forSide === activeSide`（当前版本所有 choice 效果均针对打牌方自己）。

---

## 四、Choice 类型说明

### 4.1 `trashFromHandOrDiscard`

```typescript
{ op: "trashFromHandOrDiscard"; count: number; zone?: "hand" | "discard" | "either" }
```

- `zone` 默认 `"either"`（手牌和弃牌堆均可选）
- 玩家提交 `SUBMIT_CHOICE { selectedInstanceIds }` 后，所选牌从对应区域永久移除（不进弃牌堆）
- `minCount = 0`：若手牌和弃牌堆都为空，提交空数组即可

### 4.2 `scry`（interactive=true）

```typescript
{ op: "scry"; count: number; interactive: true }
```

执行流程：
1. 从牌堆顶取 `min(count, deck.length)` 张牌存入 `revealedCards`
2. 牌堆此时移除这些牌（只剩 `deckBelow`）
3. 等待 `SUBMIT_CHOICE { selectedInstanceIds }` — 所选为**要弃掉的牌**
4. 解决：弃掉所选牌（进弃牌堆），其余牌**按原序**放回牌堆顶，`deckBelow` 接在后面

**当前限制**：`maxDiscard = 1`（只能弃 0 或 1 张）。若需要完整排序（玩家指定剩余牌的顺序），需在 `SUBMIT_CHOICE` 中额外传入顺序参数，当前版本未实现。

---

## 五、Protocol 层变更

### 5.1 `SUBMIT_CHOICE` 命令

```typescript
{ type: "SUBMIT_CHOICE"; selectedInstanceIds: string[] }
```

- `selectedInstanceIds` 为空数组 = 跳过（适用于 minCount=0 的情况）
- 提交方必须是 `pendingChoice.forSide` 对应的玩家

### 5.2 `PrivatePlayerView` 新增字段

```typescript
{
  side: PlayerSide;
  hand: PublicCardRef[];
  discard: PublicCardRef[];          // 新增：弃牌堆全部内容（支持选牌）
  pendingChoice: PendingChoiceView | null;  // 新增：待处理选择视图
}
```

### 5.3 `PublicMatchView` 新增字段

```typescript
pendingChoiceSide: PlayerSide | null;  // 新增：当前等待哪方选择（null = 无）
```

---

## 六、状态机保护

`reduce.ts` 中，当 `state.pendingChoice !== null` 时：

| 命令 | 是否允许 |
|------|---------|
| `SUBMIT_CHOICE` | ✅ 唯一合法的响应 |
| `CONCEDE` | ✅ 随时可投降 |
| `READY` | ✅（游戏尚未开始时） |
| 其他所有命令 | ❌ 抛出错误，要求先响应选择 |

---

## 七、客户端选择 UI

`RoomScene.drawChoicePanel()` 在有 `pendingChoice` 时覆盖主界面：

- **半透明遮罩**防止误操作
- **候选牌按钮列表**：点击切换选中/未选中（绿色高亮）
- **实时计数**：已选 N / 最多 M 张
- **确认提交按钮**：发送 `SUBMIT_CHOICE`
- **跳过按钮**：选择 0 张时显示"跳过（不选）"

---

## 八、未来扩展路径

| 能力 | 需要的扩展 |
|------|-----------|
| `scry` 完整排序 | 在 `SubmitChoiceCmd` 加 `orderedInstanceIds` 字段；`resolveScryChoice` 按给定顺序放回 |
| 弃牌堆报废 N 张（N>1） | 当前已支持，只需在卡牌 JSON 中设置 `count` > 1 |
| 选择对手手牌 | 新增 `chooseFromOpponentHand` choice 类型；`PrivatePlayerView` 已有 `discard` 参考 |
| 选择场馆 / 目标选择 | 新增 `chooseTarget` choice 类型，`candidates` 为 `PublicVenueView[]` |
| 可选效果（yes/no） | 新增 `yesNo` choice 类型，`selectedInstanceIds` 传 `["yes"]` 或 `["no"]` |
| 多个 ability 各自产生 pending | 当前在 `handlePlayCard` 中遇到 `pendingChoice` 后 break，支持串行 pending（需结束一个再触发下一个） |

---

## 九、文件位置速查

| 文件 | 职责 |
|------|------|
| `packages/engine/src/effects.ts` | `CardEffect` / `PendingChoice` / `applyStateEffects` / `resolveChoice` |
| `packages/engine/src/types.ts` | `InternalMatchState.pendingChoice` |
| `packages/engine/src/reduce.ts` | `SUBMIT_CHOICE` 分发 / `assertNoPendingChoice` 保护 |
| `packages/engine/src/projections.ts` | `toPrivatePlayerView`（含 pending choice 投影） |
| `packages/protocol/src/commands.ts` | `SubmitChoiceCmd` |
| `packages/protocol/src/views.ts` | `PendingChoiceView` / `PrivatePlayerView.discard` |
| `apps/game-client/src/scenes/RoomScene.ts` | `drawChoicePanel` 选择 UI |
| `packages/engine/src/__tests__/pendingChoice.test.ts` | 状态机测试 |
