# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了**数据层内容系统升级**：把"卡牌 JSON 原型"升级为可长期扩展的内容系统，为多语言、mod、版本管理铺路。

### 核心变更
1. **规则数据与本地化文案分层**：
   - 新目录 `data/cards/rules/` — v2 规则真源（无 name/text）
   - 新目录 `data/cards/text/zh-CN/` — 中文文案
   - 新目录 `data/cards/text/en-US/` — 英文占位文案
2. **新增 4 个 schema**（`card-rule` / `card-text` / `set` / `content-pack`）
3. **修复 v1 card schema**（补全 `isPressure`/`isGuard`/`activationsPerTurn`，修正 rarity 枚举）
4. **新增 content-loader**（`packages/schemas/src/content-loader.ts`）
5. **新增 Set 和 ContentPack 清单**（`data/sets/core-v1.json` / `data/content-packs/base.json`）
6. **44 个新 schema/loader 测试全部通过**，总计 250 个测试

**旧数据完全兼容**：`data/cards/*.json`（v1）保持原位，server 继续正常运行。

---

## 历史任务（已整合为背景）

### queueDelayedDiscard 白色控制链（上轮已完成）

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
data/
  cards/
    # ── v1 legacy（server 当前读取路径）──
    starter.json         4 种起始牌（共 12 张/人）
    fixed-supplies.json  3 种固定补给
    status.json          压力状态牌（isPressure=true）
    market-core.json     11 种市场牌（白色 3 张已升至 v2 效果）

    # ── v2 内容系统（新分层结构）──
    rules/               v2 规则真源（无 name/text，供 engine 消费）
      starter.json
      fixed-supplies.json
      status.json
      market-core.json
    text/
      zh-CN/             中文文案
        starter.json / fixed-supplies.json / status.json / market-core.json
      en-US/             英文占位文案（最小内容）
        starter.json / fixed-supplies.json / status.json / market-core.json

  sets/
    core-v1.json         核心牌组清单（19 张卡 ID）

  content-packs/
    base.json            基础内容包（引用 core-v1 set + core-v1 ruleset）

  rulesets/
    core-v1.json         规则集（生命值/手牌上限等）
```

详见 `docs/content-architecture.md`。

---

## 目录结构变化（本轮新增/修改）

```
packages/schemas/
  schemas/
    card.schema.json        ← 修改：补全 isPressure/isGuard/activationsPerTurn；修正 rarity 枚举；放宽 venue 约束
    card-rule.schema.json   ← 新增：v2 规则真源 schema（不含 name/text）
    card-text.schema.json   ← 新增：locale 文案文件 schema
    set.schema.json         ← 新增：卡牌集合清单 schema
    content-pack.schema.json ← 新增：内容包清单 schema
  src/
    validators.ts           ← 修改：新增 v2 校验器（checkCardRule/checkCardText/checkSetManifest/checkContentPack）
    content-loader.ts       ← 新增：规则/文案加载与合并工具
    index.ts                ← 修改：导出新增符号；SCHEMAS_VERSION 升至 0.1.0
    __tests__/
      validate.test.ts      ← 修改：更新 venue 兼容性测试（反映放宽后的 v1 schema 行为）
      content-system.test.ts ← 新增：44 个测试覆盖 v2 schema + content-loader + locale 降级

data/
  cards/
    rules/                  ← 新增：v2 规则真源（4 文件）
    text/zh-CN/             ← 新增：中文文案（4 文件）
    text/en-US/             ← 新增：英文占位文案（4 文件）
  sets/
    core-v1.json            ← 新增：核心卡牌集合清单
  content-packs/
    base.json               ← 新增：基础内容包清单

docs/
  content-architecture.md  ← 新增：内容系统架构文档

# 以下文件本轮未修改（保持向后兼容）
packages/engine/**
packages/protocol/**
apps/server/**
apps/game-client/**
data/cards/*.json（v1 legacy）
data/rulesets/core-v1.json
```

---

## 测试覆盖

共 **250 个测试**，全部通过：

### engine 包（190 个，本轮无变化）

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

### schemas 包（60 个，本轮新增 44）

| 文件 | 测试数 | 本轮新增 |
|------|--------|---------|
| validate.test.ts | 16 | 0（1 个测试更新断言反映 v1 兼容性变化）|
| **content-system.test.ts** | **44** | **+44** |
| **小计** | **60** | **+44** |

---

## 下一步最推荐做什么

### 内容系统后续（新）

1. **将 server 迁移到 v2 加载路径**：修改 `GameRoom.ts`，改为从 `data/cards/rules/*.json` 加载，删除对旧 flat 格式的依赖
2. **补全 card-catalog.md 中其余卡牌的规则文件**：按 v2 格式批量补充 red/blue/green/neutral/white 其余牌
3. **添加 en-US locale 完整翻译**（当前为机器翻译占位）

### 规则机制（原有优先级）

4. **批量补充市场牌**（Codex 适合）：补 `queueDelayedDiscard` / `createPressure` / `gainResource` 等已支持 op 的牌，让牌池厚度明显提升
5. **trashFromHandOrDiscard + pending-choice 状态机**（Claude 适合）：实现"从手牌/弃牌堆报废 N 张"——需要最小交互状态机
6. **断线重连**：在 GameRoom 配置 `allowReconnection`，重连后重发私有视图
7. **回放记录**：在 GameRoom 记录每条命令，写入数据库

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
