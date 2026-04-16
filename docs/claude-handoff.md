# Claude 交接文档

> ⚠️ 归档说明：本文是阶段性交接记录，可能包含历史上下文。当前能力口径请以 `docs/current-capabilities.md` 为准。


## 当前完成状态（本轮）

本轮完成了 **Prisma + PostgreSQL 最小持久化层接入（Task 3）**。

### 核心变更（本轮）

#### Task 3：Prisma 持久化 + 只读 API

1. **`apps/server/prisma/schema.prisma`（新建）**
   - 三张表：`Match`、`MatchPlayer`、`MatchEvent`
   - `Match`：roomId 为主键，rulesetVersion / contentSets / startedAt / endedAt / winner
   - `MatchPlayer`：(matchId, side) 联合唯一约束
   - `MatchEvent`：seq + BigInt ts + type + side + Json data，(matchId, seq) 联合索引

2. **`apps/server/prisma.config.ts`（新建）**
   - Prisma 7 新配置格式（datasource.url 从 schema.prisma 移至此处）
   - 读取 `.env` 文件中的 `DATABASE_URL`

3. **`apps/server/.env`（新建，本地开发用）**
   - `DATABASE_URL=postgresql://devuser:devpass@localhost:5432/dev_camcard`
   - 已添加 `.env.example`

4. **`apps/server/src/prisma.ts`（新建）**
   - 全局 Prisma 单例（`getPrisma()`）
   - 使用 `@prisma/adapter-pg` + `pg.Pool`（Prisma 7 driver adapter 方式）
   - `closePrisma()` 供进程退出时调用

5. **`apps/server/src/rooms/GameRoom.ts`（更新）**
   - `onCreate` → `dbCreateMatch()`：写 Match 记录
   - `onJoin` → `dbUpsertPlayer(side, name)`：写 MatchPlayer（upsert，支持重连）
   - `recordCommandEvent` → `dbWriteEvent(evt)`：每条命令事件逐条落库
   - 对局结束时 → `dbEndMatch(winner)`：写 endedAt + winner
   - `onDispose` → 若尚未落库 MATCH_END 则补写
   - 所有 DB 操作 fire-and-forget（不阻塞游戏逻辑，错误仅 log）

6. **`apps/server/src/index.ts`（更新）**
   - 新增三条只读 API：
     - `GET /api/matches`：最近 50 场对局（含 players），按 startedAt 倒序
     - `GET /api/matches/:id`：单场对局详情
     - `GET /api/matches/:id/events`：该对局事件流（seq 升序，ts 为字符串避免 BigInt 序列化问题）
   - 进程退出时调用 `closePrisma()`

7. **`apps/server/src/__tests__/persistence.test.ts`（新建）**
   - 7 条测试：Match 写入 / 读取、MatchEvent BigInt ts 落库、winner 更新、3 条 API 端点验证

8. **数据库初始化（已执行）**
   - PostgreSQL 实例：`localhost:5432`
   - 数据库：`dev_camcard`，用户：`devuser` / `devpass`
   - 迁移：`20260416115952_init_match_events` + `20260416120000_add_player_unique`

---

## 历史任务（已整合为背景）

### 断线重连 + 事件日志骨架（上轮）

`allowReconnection(client, 60)`，60 秒重连窗口，重连后自动重发状态 + 事件日志。
内存事件流：`matchEvents: MatchEvent[]`，seq 单调递增，含 ts。
`REQUEST_MATCH_EVENTS` 拉取接口；ReplayScene 列表展示。

### chooseTarget + gainFaceUpCard（更早）

`gainFaceUpCard` 从 no-op 变为真实效果，`chooseTarget` 最小框架，两张市场牌接通。

### 内容系统运行时接入

server 加载链全程 AJV 保护，client locale 闭环接入 ViewModel。

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

## 数据库（本轮新增）

```
PostgreSQL localhost:5432
  database: dev_camcard
  user: devuser / devpass

Tables:
  Match           (id PK, rulesetVersion, contentSets[], startedAt, endedAt?, winner?)
  MatchPlayer     (id, matchId FK, side, name) UNIQUE(matchId, side)
  MatchEvent      (id, matchId FK, seq, ts BIGINT, type, side?, data JSON?)
  _prisma_migrations
```

---

## 只读 API

| 路由 | 说明 |
|------|------|
| `GET /api/matches` | 最近 50 场，含 players |
| `GET /api/matches/:id` | 单场详情，含 players |
| `GET /api/matches/:id/events` | 事件流，ts 为字符串 |

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
| game-client | eventLog.test.ts | 8 |
| **server** | **persistence.test.ts** | **7** |
| **合计** | | **344** |

---

## 断线重连行为说明

- **超时**：60 秒（`RECONNECTION_TIMEOUT_SECS`）
- **Token 存储**：`localStorage` key `devCamCard_reconnectionToken`
- **恢复内容**：重连后服务端自动推送 `STATE_UPDATE` + `PRIVATE_UPDATE` + `MATCH_EVENTS`
- **pendingChoice 恢复**：`PRIVATE_UPDATE` 中包含 `pendingChoice`，客户端重新进入选择 UI
- **失败行为**：token 失效时清理 localStorage，fallback 到 `joinOrCreate` 新房间

## 事件日志说明

- **内存**：仍保留 `matchEvents: MatchEvent[]` 内存流，供实时推送
- **持久化**：每条事件 fire-and-forget 写入 `MatchEvent` 表（Prisma）
- 事件类型：`MATCH_START` / 所有 `CMD.*` / `MATCH_END`
- 客户端可通过 `REQUEST_MATCH_EVENTS` 消息拉取完整流

---

## 注意事项（next Claude）

### Prisma 7 特殊点

- Prisma 7 的 `schema.prisma` 不含 `url`，连接信息在 `prisma.config.ts`
- 运行时使用 `@prisma/adapter-pg`，`new PrismaClient({ adapter })` 模式
- `null` JSON 字段需传 `Prisma.JsonNull`（不是 JS `null`）
- 迁移命令需先启动 PostgreSQL：`sudo service postgresql start`
- 迁移命令（dev 环境）：`cd apps/server && npx prisma migrate dev --name <name>`
- 应用迁移（非 interactive 环境）：`npx prisma migrate deploy`
- 测试需 `DATABASE_URL` 环境变量（或 `.env` 文件）

### DB 火力不足时的降级行为

`dbCreateMatch` 等方法均 `.catch(err => console.error(...))` — DB 不可用时游戏房间不会崩溃，只是数据不落库。

### GameRoom 注意

- `applyStateEffects` 和 `resolveChoice` 需传入 `getCardCost`，否则 `gainFaceUpCard` 无候选
- `chooseTarget` 提交玩家目标格式为字符串 `"player:0"` / `"player:1"`
- `allowReconnection` 返回 `Deferred<Client>`，必须 `await`，超时时 `reject`
- `Phaser.Scene` 已有 `events` 属性，自定义事件数组不可命名为 `events`（已用 `matchLog` / `recentEvents`）

---

## 运行命令

```bash
# 启动 PostgreSQL（如未启动）
sudo service postgresql start

# 应用迁移（首次或新环境）
cd apps/server && npx prisma migrate deploy

# 开发服务器
pnpm --filter @dev-camcard/server dev

# 测试（需 DB 可用）
DATABASE_URL="postgresql://devuser:devpass@localhost:5432/dev_camcard" pnpm --filter @dev-camcard/server test

# 类型检查
pnpm --filter @dev-camcard/server typecheck

# 全量测试（engine + schemas + game-client）
pnpm --filter @dev-camcard/engine test
pnpm --filter @dev-camcard/schemas test
pnpm --filter @dev-camcard/game-client test
```

---

## 下一步推荐

1. **ReplayScene 完整播放器**：按 seq 逐步重建快照并渲染（持久化入口已就绪）
2. **补全市场牌**：利用现有 op 批量补充到 20+ 张
3. **dealDamage 防备联动**：block 抵消逻辑
4. **scry 完整排序**：`SubmitChoiceCmd` 加 `orderedInstanceIds`
5. **管理后台**：基于 `GET /api/matches` 的简单对局历史页（Next.js admin）
