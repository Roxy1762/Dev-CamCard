# Claude 交接文档

## 当前完成状态（本轮）

### 本轮完成内容

实现了"最小可玩核心循环"引擎能力：抽牌 → 打牌 → 获得资源/攻击/防备 → 攻击对手 → 结束回合 → 胜负判定。

#### 新增文件

- **`packages/engine/src/effects.ts`**
  - `CardEffect` — discriminated union（gainResource / gainAttack / gainBlock / heal / draw / drawThenDiscard）
  - `CardAbility` — `{ trigger: "onPlay"; effects: CardEffect[] }`
  - `CardDef` — `{ id, type, abilities }` 供引擎使用的卡牌定义
  - `applyEffects(player, effects, random, maxHp)` — 纯函数效果解释器

#### 修改文件

- **`packages/engine/src/reduce.ts`**
  - `EngineConfig` 新增 `getCardDef: (cardId: string) => CardDef | undefined`
  - `CMD.PLAY_CARD` 分支：从手牌移至 played 区，执行 onPlay 效果
  - `CMD.ASSIGN_ATTACK` 分支：伤害结算（先 block 再 hp），hp<=0 决出胜者

- **`packages/engine/src/index.ts`**
  - 新增 `export * from "./effects"`

- **`packages/engine/src/__tests__/reduce.test.ts`**
  - 全部旧测试保留并更新 CONFIG（加入 getCardDef）
  - 新增 `describe("reduce: PLAY_CARD")`（6 个测试）
  - 新增 `describe("reduce: ASSIGN_ATTACK")`（5 个测试）
  - 共 68 个测试，全部通过

- **`apps/server/src/rooms/GameRoom.ts`**
  - 本地 `CardDef` 接口替换为从 `@dev-camcard/engine` 导入的 `CardDef`
  - 新增 `cardDefMap` 从 JSON 构建卡牌定义查找表
  - `ENGINE_CONFIG` 增加 `getCardDef` 字段

### 已实现效果

| 效果 | 实现 | 测试 |
|------|------|------|
| gainResource | ✅ | ✅ 零花钱 |
| gainAttack | ✅ | ✅ 争执（小摩擦） |
| gainBlock | ✅ | ✅ 守时习惯 |
| heal | ✅ | 通过 supply_milk_bread 卡牌定义覆盖 |
| draw | ✅ | ✅ 草稿纸 |
| drawThenDiscard | ✅ | ✅ test_draw_then_discard |

### 已实现命令

| 命令 | 状态 |
|------|------|
| READY | ✅（已有，本轮保持） |
| END_TURN | ✅（已有，本轮保持） |
| BUY_MARKET_CARD | ✅（已有，本轮保持） |
| BUY_FIXED_SUPPLY | ✅（已有，本轮保持） |
| CONCEDE | ✅（已有，本轮保持） |
| PLAY_CARD | ✅ 本轮新增 |
| ASSIGN_ATTACK | ✅ 本轮新增（仅 target="player"，先 block 后 hp） |

### 未实现（明确跳过）

- 预约 / 日程槽 / 场馆 / 值守 / 压力
- 对手下回合弃1
- 完整 66 张市场牌
- ASSIGN_ATTACK 的 target="venue" 分支

---

## 目录结构（相对变化）

```
packages/engine/src/
  effects.ts          ← 新增：效果类型 + 解释器
  reduce.ts           ← 修改：PLAY_CARD / ASSIGN_ATTACK
  index.ts            ← 修改：导出 effects

packages/engine/src/__tests__/
  reduce.test.ts      ← 修改：新增 PLAY_CARD / ASSIGN_ATTACK 测试（共 30 个）

apps/server/src/rooms/
  GameRoom.ts         ← 修改：加载 CardDef，注入 getCardDef
```

---

## 下一轮建议任务

1. **市场牌补全**：将 24 张市场牌（红/蓝/白/绿）的 JSON 数据填入 `data/cards/`，并在 `createMatchState` 时随机填入商店槽
2. **回合开始/结束事件广播**：在 GameRoom 广播 EVT.TURN_STARTED / TURN_ENDED / CARD_PLAYED / ATTACK_ASSIGNED 等事件，让客户端可以做动画
3. **客户端牌桌 UI**：Phaser Scene 展示手牌、资源池、攻击池、HP，响应 PRIVATE_UPDATE / STATE_UPDATE
4. **场馆机制**：ACTIVATE_VENUE / venue effect 处理
5. **日程槽 / 预约**：PUT_CARD_TO_SCHEDULE / RESERVE_MARKET_CARD 命令
6. **压力牌**：status_pressure 产生与弃置机制

## 测试命令

```bash
pnpm --filter @dev-camcard/engine test
```
