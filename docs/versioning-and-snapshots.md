# Versioning & Snapshots

> 记录对局事件流、快照骨架及版本标识的设计决策。

## 当前状态（内存闭环 MVP）

本轮实现了"最小内存闭环"：事件日志 + 快照头信息在服务端内存中维护，
对局期间可读取，对局结束后随房间销毁（**无持久化**）。

---

## 类型定义（`packages/protocol/src/events.ts`）

```typescript
interface MatchEvent {
  seq: number;        // 全局递增序号（从 0 开始），用于排序与去重
  ts: number;         // 服务端 Date.now()，毫秒时间戳
  type: string;       // CMD.* 或 "MATCH_START" / "MATCH_END"
  side?: PlayerSide;  // 0 | 1，系统事件无 side
  data?: Record<string, unknown>;  // 精简 payload
}

interface MatchSnapshot {
  matchId: string;          // 等于 Colyseus roomId
  rulesetVersion: string;   // 来自 data/rulesets/*.json 文件名，如 "core-v1"
  contentSets: string[];    // 参与本局的内容集合名，如 ["starter", "market-core", ...]
  startedAt: number;        // 房间创建时间（Date.now()）
}

interface MatchEventLog {
  snapshot: MatchSnapshot;
  events: MatchEvent[];
}
```

---

## 事件覆盖范围

| 类型标签 | 触发时机 | side |
|----------|----------|------|
| `MATCH_START` | `GameRoom.onCreate` | — |
| `READY` | 玩家发送 READY 命令 | 0/1 |
| `PLAY_CARD` | 玩家打出手牌 | 0/1 |
| `PUT_CARD_TO_SCHEDULE` | 放入日程槽 | 0/1 |
| `ACTIVATE_VENUE` | 启动场馆 | 0/1 |
| `RESERVE_MARKET_CARD` | 预约市场牌 | 0/1 |
| `BUY_MARKET_CARD` | 购买市场牌 | 0/1 |
| `BUY_RESERVED_CARD` | 购买预约牌 | 0/1 |
| `BUY_FIXED_SUPPLY` | 购买固定补给 | 0/1 |
| `ASSIGN_ATTACK` | 发起攻击 | 0/1 |
| `END_TURN` | 结束回合 | 0/1 |
| `CONCEDE` | 投降 | 0/1 |
| `SUBMIT_CHOICE` | 提交待处理选择 | 0/1 |
| `MATCH_END` | 对局结束（reduce 后 / onDispose） | — |

---

## Snapshot 版本标识

`rulesetVersion` 来自 `RULESET_FILE` 常量（`"data/rulesets/core-v1.json"`），
取文件名去扩展名：`"core-v1"`。

`contentSets` 来自 `CONTENT_SETS` 数组，取每个路径的文件名去扩展名：
```
["starter", "fixed-supplies", "market-core", "status"]
```

这为未来的持久化 + 重放提供了足够的版本上下文：
给定 rulesetVersion + contentSets，可以确定任意事件序列重放所需的规则环境。

---

## 客户端入口

### 事件日志推送时机

1. **加入房间时**（`onJoin`）：`client.send(EVT.MATCH_EVENTS, log)`
2. **重连成功时**（`onLeave` 重连 await 完成）：同上
3. **客户端主动拉取**：发送 `"REQUEST_MATCH_EVENTS"` → 服务端推送

### ReplayScene

位置：`apps/game-client/src/scenes/ReplayScene.ts`

当前能力：
- 以列表形式展示 `MatchEvent[]`，每行显示 seq / ts / type / side / data 摘要
- 监听 `RoomClient.onEventLog`，收到新数据后自动刷新
- 支持分页（30 条/页，方向键 / 按钮）

后续扩展（未做）：
- 逐事件重建快照并渲染（需 engine 导出 `stepReplay(snapshot, events[0..n])`）
- 从 API 加载历史 MatchEventLog

---

## 未来持久化路径（设计入口，未实现）

```
对局结束 → GameRoom.onDispose
  → 将 { snapshot, events } 序列化为 JSON
  → 写入 Prisma matchLog 表（matchId PK，snapshot jsonb，events jsonb[]）
  → 客户端可通过 REST API 获取历史日志
```

Prisma schema 占位（尚未创建数据库）：
```prisma
model MatchLog {
  matchId     String   @id
  rulesetVer  String
  contentSets String[]
  startedAt   DateTime
  events      Json
  createdAt   DateTime @default(now())
}
```
