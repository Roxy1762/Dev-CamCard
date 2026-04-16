# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了**内容系统运行时接入**：server 加载数据链全程受 AJV 保护，client 真正从 locale 文案读取卡牌名称，ViewModel 与内容系统形成闭环。

### 核心变更

1. **server AJV 运行时校验**（`packages/schemas/src/`）
   - `validators.ts` 新增 `assertCardText` / `assertSetManifest` / `assertContentPack`
   - `content-loader.ts` 在 `loadCardRuleFile` / `loadCardTextFile` / `loadSetManifest` / `loadContentPackManifest` 内部直接调用对应 `assert*`，校验失败抛出含路径信息的清晰报错
   - `index.ts` 导出三个新 assert 函数
   - `GameRoom.ts` 在加载 ruleset 时调用 `assertRulesetDef`，不再静默信任 JSON

2. **client content-loader 集成**（`apps/game-client/src/content/clientLocale.ts`）
   - 新模块，浏览器端最小 locale 加载层
   - 静态导入四组文案文件（zh-CN / en-US），Vite 构建时打包
   - `buildCardNames(locale)` → `Map<cardId, localizedName>`
   - 支持 `SupportedLocale = "zh-CN" | "en-US"`，`DEFAULT_LOCALE = "zh-CN"`
   - 代码结构支持后续无缝新增 locale

3. **BootScene 接入 locale**（`apps/game-client/src/scenes/BootScene.ts`）
   - `create()` 在连接前同步调用 `buildCardNames(DEFAULT_LOCALE)`
   - `cardNames` Map 随 `view / privateView / roomClient` 一起传入 RoomScene

4. **RoomScene 消费 cardNames**（`apps/game-client/src/scenes/RoomScene.ts`）
   - `init()` 参数新增 `cardNames?`，赋值给已有 `this.cardNames`
   - `rebuildUI()` 将 `this.cardNames` 传给 `buildBoardViewModel`，使 `getCardName()` 真正返回中文展示名

5. **测试**
   - `packages/schemas/src/__tests__/runtime-validation.test.ts`（11 个）：合法内容不抛错 × 5 + 非法内容清晰报错 × 6
   - `apps/game-client/src/__tests__/locale.test.ts`（10 个）：locale 命中 × 5 + 缺失降级 × 2 + ViewModel 闭环 × 3

---

## 历史任务（已整合为背景）

### 内容系统运行时接入（上轮）

server 加载链全程 AJV 保护，client locale 闭环接入 ViewModel。

### 数据层内容系统升级（上上轮）

规则数据与本地化文案分层，v2 schema 体系，content-loader，locale fallback。

### 效果执行框架升级（更早）

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
| gainFaceUpCard | — | — | ⚠️ no-op 占位 |
| queueDelayedDiscard | self / opponent | — | ✅ |
| trashFromHandOrDiscard | self | ✅ 玩家选择目标 | ✅ |

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
- **完整 66 张市场牌**：当前 13 张
- **gainFaceUpCard**：no-op 占位，需确定牌源
- **scry 完整排序**：当前只能弃 0~1 张，无法自定义剩余顺序

---

## 数据层

```
data/
  cards/
    # ── v2 内容系统（server 当前读取路径）──
    rules/
      starter.json
      fixed-supplies.json
      market-core.json     13 种市场牌（含 used_book_recycle + draft_simulation）
      status.json
    text/zh-CN/
      starter.json / fixed-supplies.json / market-core.json / status.json
    text/en-US/
      starter.json / fixed-supplies.json / market-core.json / status.json

    # ── v1 legacy（归档，不再被 server 读取）──
    starter.json
    fixed-supplies.json
    market-core.json
    status.json

  sets/
    core-v1.json     21 张卡牌 ID
  content-packs/
    base.json
  rulesets/
    core-v1.json
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
| schemas | validate.test.ts | 16 |
| schemas | content-system.test.ts | 46 |
| schemas | runtime-validation.test.ts | 11 |
| game-client | viewmodel.test.ts | 13 |
| game-client | locale.test.ts | 10 |
| **合计** | | **312** |

---

## 下一步推荐

1. **gainFaceUpCard 落地**：确定牌源（固定堆 / 弃牌堆 / cardId），实现 no-op → 真实效果
2. **scry 完整排序**：`SubmitChoiceCmd` 加 `orderedInstanceIds`，`resolveScryChoice` 按序放回
3. **chooseTarget（场馆选择）**：新增 `chooseTarget` pending 类型，扩展攻击分配 UI
4. **断线重连**：Colyseus `allowReconnection` + 重连后重发私有视图
5. **回放记录**：命令日志写入数据库
6. **补全市场牌**：利用已支持 op 批量补充 red/blue/green/neutral 牌池（至少到 24 张）
7. **locale 运行时切换 UI**：现在结构支持切换，可在 BootScene 或设置入口让玩家选择语言

## 测试命令

```bash
# 全部测试
pnpm --filter @dev-camcard/engine test
pnpm --filter @dev-camcard/schemas test
pnpm --filter @dev-camcard/game-client test

# 构建检查
pnpm --filter @dev-camcard/server typecheck
pnpm --filter game-client build

# 本地开发
pnpm --filter @dev-camcard/server dev
pnpm --filter game-client dev
```
