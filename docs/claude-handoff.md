# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了**数据层内容系统升级**和**客户端 ViewModel 层**的建立：规则数据与本地化文案彻底分层，服务端迁移至 v2 加载路径，客户端渲染层建立统一 ViewModel 入口。

### 核心变更

1. **服务端迁移至 v2 内容加载路径**（`apps/server/src/rooms/GameRoom.ts`）
   - 从 `data/cards/rules/*.json` 加载规则（不含文案），替换旧 flat JSON
   - 依赖 `@dev-camcard/schemas` 的 `loadRuleBatch` / `CardRuleData`
   - `CardAbility.condition` 类型从 `string` 改为 `unknown`，与引擎的 `CardCondition` 结构兼容
   - `server/tsconfig.json` 补充 `resolveJsonModule: true`（支持引用 schemas 包的 JSON 导入）

2. **集合清单更新**（`data/sets/core-v1.json`）
   - 新增 `green_used_book_recycle`、`blue_draft_simulation` 两张卡（前轮新增但未加入清单）

3. **客户端 ViewModel 层**（`apps/game-client/src/viewmodel/BoardViewModel.ts`）
   - `BoardViewModel` 接口 + `PlayerViewModel` 接口
   - `buildBoardViewModel(pub, priv, cardNames?)` 纯函数：
     - 推导 `mySide / oppSide / isMyTurn`
     - 拍平 `hand / discard / pendingChoice`
     - `getCardName()` 支持 locale 注入 + 安全降级（返回 cardId）
   - RoomScene 所有 draw 方法消费 `vm`，不再直接散读原始视图

4. **测试**（`apps/game-client/src/__tests__/viewmodel.test.ts`，13 个）
   - game-client 新增 Vitest 配置

5. **文档**
   - 新建 `docs/asset-conventions.md`（artKey 命名规则、资源目录、正式卡图接入路径）
   - 新建 `docs/client-viewmodel.md`（ViewModel 层设计、使用方式、扩展路径）

---

## 历史任务（已整合为背景）

### 效果执行框架升级（上上轮）

统一 pending-choice 模型，trashFromHandOrDiscard，interactive scry，
blue_draft_simulation / green_used_book_recycle 接通，client 选择 UI。

### 数据层内容系统升级（上轮完成 schema / loader，本轮完成 server 迁移）

规则数据与本地化文案分层，v2 schema 体系，content-loader，locale fallback。

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
- **client cardNames 注入**：接口已预留，需在 BootScene/RoomScene 加载 locale 文案后填入

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
    core-v1.json     21 张卡牌 ID（含本轮新增 2 张）
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
| game-client | viewmodel.test.ts | 13 |
| **合计** | | **291** |

---

## 下一步推荐

1. **client cardNames 注入**：在 `BootScene` 加载 locale 文案，构建 `Map<cardId, name>` 后传给 `buildBoardViewModel`，卡牌名称从 id 变为中文展示名
2. **gainFaceUpCard 落地**：确定牌源（固定堆 / 弃牌堆 / cardId），实现 no-op → 真实效果
3. **scry 完整排序**：`SubmitChoiceCmd` 加 `orderedInstanceIds`，`resolveScryChoice` 按序放回
4. **chooseTarget（场馆选择）**：新增 `chooseTarget` pending 类型，扩展攻击分配 UI
5. **断线重连**：Colyseus `allowReconnection` + 重连后重发私有视图
6. **回放记录**：命令日志写入数据库
7. **补全市场牌**：利用已支持 op 批量补充 red/blue/green/neutral 牌池（至少到 24 张）
8. **AJV 运行时校验接入**：server 加载数据时调用 `assertCardRule` 验证数据文件

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
