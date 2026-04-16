# Claude 交接文档

## 当前完成状态（本轮）

本轮完成了 **断线重连（Task 1）** 与 **最小事件日志 + 内存回放 + snapshot 骨架（Task 2）**。

### 核心变更（本轮）

#### Task 1：断线重连

1. **`packages/protocol/src/events.ts`**
   - 新增 `EVT.MATCH_EVENTS: "match_events"` 常量
   - 新增 `MatchEvent`、`MatchSnapshot`、`MatchEventLog` 类型

2. **`apps/server/src/rooms/GameRoom.ts`**
   - `onLeave` 改为 `async`，调用 `allowReconnection(client, 60)` — 60 秒内可重连
   - 重连成功后自动重发 `STATE_UPDATE + PRIVATE_UPDATE + MATCH_EVENTS`
   - 主动离开（consented=true）时立即清理 sideMap
   - 重连超时后清理 sideMap 席位

3. **`apps/game-client/src/network/RoomClient.ts`**
   - 连接成功后自动将 `room.reconnectionToken` 存入 `localStorage`
   - 新增 `reconnect()` 方法：读取 localStorage token → `client.reconnect(token)`
   - 新增 `onEventLog: EventLogHandler | null` 回调
   - 新增 `requestEventLog()` 方法（发送 `REQUEST_MATCH_EVENTS`）
   - `leave()` 同时清理 localStorage token

4. **`apps/game-client/src/scenes/BootScene.ts`**
   - 启动时检查 localStorage 是否有 `reconnectionToken`
   - 有则先尝试 `roomClient.reconnect()`，成功后等待 state+private 再切场景
   - 失败则清理 token 并 fallback 到 `joinOrCreate`

#### Task 2：事件日志 + 快照骨架

5. **`apps/server/src/rooms/GameRoom.ts`（续）**
   - 维护 `matchEvents: MatchEvent[]` 内存事件流（seq 单调递增，含 ts）
   - 维护 `matchSnapshot: MatchSnapshot`（matchId/rulesetVersion/contentSets/startedAt）
   - 每次 `reduce` 成功后调用 `recordCommandEvent`，提取精简 payload 入日志
   - 对局结束时自动追加 `MATCH_END`，`onDispose` 也追加 `MATCH_END`
   - 新增消息处理器 `REQUEST_MATCH_EVENTS` → 推送 `MatchEventLog` 给请求方
   - 加入 / 重连时均自动推送 `MATCH_EVENTS`

6. **`apps/game-client/src/scenes/RoomScene.ts`**
   - 新增 `recentEvents: MatchEvent[]` 字段（存最近 8 条）
   - `create()` 中新增 `onEventLog` 回调，更新 `recentEvents` 并触发 `rebuildUI`
   - 新增 `drawEventLogStrip()`：底部条（y=H-58），展示最近 4 条事件摘要 + "查看回放"按钮
   - `drawMyInfo()` 新增 `pendingDiscardCount > 0` 时的 ⚠ 提示文本（黄色）

7. **`apps/game-client/src/scenes/ReplayScene.ts`（新建）**
   - 事件日志列表展示（seq / 时间戳后6位 / 类型 / 操作方 / 数据摘要）
   - 支持最多 30 条可见，方向键 / 按钮分页
   - 监听 `onEventLog`，收到服务端完整日志后自动刷新
   - 按颜色区分事件类型（战斗 / 买牌 / 系统 / 投降等）
   - "← 返回"按钮回到 RoomScene

8. **`apps/game-client/src/main.ts`**
   - 注册 `ReplayScene` 到 Phaser scene 列表

9. **`apps/game-client/src/__tests__/eventLog.test.ts`（新建）**
   - 8 条聚焦测试：seq 递增、ts 正整数、side 字段、data 字段、顺序稳定、对局结束后可读、snapshot 结构、MatchEventLog 组合

---

## 历史任务（已整合为背景）

### chooseTarget + gainFaceUpCard（上轮）

`gainFaceUpCard` 从 no-op 变为真实效果，`chooseTarget` 最小框架，两张市场牌接通。

### 内容系统运行时接入

server 加载链全程 AJV 保护，client locale 闭环接入 ViewModel。

### 数据层内容系统升级

规则数据与本地化文案分层，v2 schema 体系，content-loader，locale fallback。

### 效果执行框架升级

统一 pending-choice 模型，trashFromHandOrDiscard，interactive scry，client 选择 UI。

### queueDelayedDiscard / 商店主循环 / 预约位机制 / 效果系统初版

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

| op | 交互 | 状态 |
|----|------|------|
| gainResource | — | ✅ |
| gainAttack | — | ✅ |
| gainBlock | — | ✅ |
| heal | — | ✅ |
| draw | — | ✅ |
| drawThenDiscard | — | ✅ |
| createPressure | — | ✅ |
| scry（非交互 / interactive） | 玩家选择弃 0~1 张 | ✅ |
| setFlag | — | ✅ |
| gainFaceUpCard | 玩家从市场候选中选牌 | ✅ |
| queueDelayedDiscard | — | ✅ |
| trashFromHandOrDiscard | 玩家选择目标 | ✅ |
| chooseTarget | 玩家选择玩家或场馆 | ✅ |

---

## 数据层

```
data/
  cards/
    rules/
      market-core.json     15 种市场牌
      starter.json / fixed-supplies.json / status.json
    text/zh-CN/ + text/en-US/
  sets/
    core-v1.json     23 张卡牌 ID
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
| engine | gainFaceUpCard.test.ts | 14 |
| schemas | validate.test.ts | 16 |
| schemas | content-system.test.ts | 49 |
| schemas | runtime-validation.test.ts | 11 |
| game-client | viewmodel.test.ts | 13 |
| game-client | locale.test.ts | 10 |
| game-client | **eventLog.test.ts** | **8** |
| **合计** | | **337** |

---

## 重连行为说明

- **超时**：60 秒（`RECONNECTION_TIMEOUT_SECS`）
- **Token 存储**：`localStorage` key `devCamCard_reconnectionToken`
- **恢复内容**：重连后服务端自动推送 `STATE_UPDATE` + `PRIVATE_UPDATE` + `MATCH_EVENTS`
- **pendingChoice 恢复**：`PRIVATE_UPDATE` 中包含 `pendingChoice`，客户端重新进入选择 UI
- **失败行为**：token 失效时清理 localStorage，fallback 到 `joinOrCreate` 新房间

## 事件日志说明

- 内存存储，不持久化（本轮目标）
- 事件类型：`MATCH_START` / 所有 `CMD.*` / `MATCH_END`
- 客户端可通过 `REQUEST_MATCH_EVENTS` 消息拉取完整流
- 加入 / 重连时服务端自动推送

---

## 下一步推荐

1. **补全市场牌**：利用现有 op 批量补充到 20+ 张
2. **scry 完整排序**：`SubmitChoiceCmd` 加 `orderedInstanceIds`
3. **dealDamage 防备联动**：block 抵消逻辑
4. **ReplayScene 完整播放器**：按 seq 逐步重建快照并渲染
5. **数据库持久化**：对局结束后将 `MatchEventLog` 写入 Prisma（入口已就绪）

## 注意事项（next Claude）

- `applyStateEffects` 和 `resolveChoice` 需传入 `getCardCost`，否则 `gainFaceUpCard` 无候选。
- `chooseTarget` 提交玩家目标格式为字符串 `"player:0"` / `"player:1"`。
- `allowReconnection` 返回 `Deferred<Client>`，必须 `await`，超时时 `reject`。
- `Phaser.Scene` 已有 `events` 属性，自定义事件数组不可命名为 `events`（已用 `matchLog` / `recentEvents`）。

## 测试命令

```bash
pnpm --filter @dev-camcard/engine test
pnpm --filter @dev-camcard/schemas test
pnpm --filter @dev-camcard/game-client test
pnpm --filter @dev-camcard/server typecheck
pnpm --filter game-client exec tsc --noEmit
```
