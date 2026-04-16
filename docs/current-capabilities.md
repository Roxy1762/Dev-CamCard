# 当前阶段能力清单（统一口径）

> 以仓库代码现状为准，作为跨文档对齐基线。

## 已完成 ✅

### 1) 架构与工程

- Monorepo（apps + packages）
- 协议层：`packages/protocol`
- 规则引擎纯函数：`packages/engine`
- Schema + AJV：`packages/schemas`
- 客户端：Phaser + Vite + TypeScript
- 服务端：Colyseus + Express
- 持久化：PostgreSQL + Prisma 7

### 2) 服务端（`apps/server`）

- GameRoom 已接入真实 `engine.reduce`
- 状态分层广播：`PublicMatchView` + `PrivatePlayerView`
- 断线重连（60 秒）
- 事件日志（内存）+ 事件落库（`MatchEvent`）
- 对局元数据落库（`Match` + `MatchPlayer`）
- 只读 API：
  - `GET /api/matches`
  - `GET /api/matches/:id`
  - `GET /api/matches/:id/events`

### 3) 客户端（`apps/game-client`）

- 场景：`BootScene` / `RoomScene` / `ReplayScene`
- 基础指令交互：READY / PLAY / BUY / ATTACK / END_TURN / CONCEDE
- pending-choice 交互（含 chooseTarget / gainFaceUpCard）
- ViewModel 层（`buildBoardViewModel`）
- locale 名称映射（默认 `zh-CN`）
- 回放页：事件列表展示 + 分页滚动（骨架）

### 4) 规则与内容

- 1v1 基础流程已闭环（开局、轮转、胜负）
- 三栏市场 + 固定补给 + 预约位
- 场馆与值守机制
- 压力牌限制
- 延迟弃牌与 pendingDiscardCount
- 数据分层：rules 与 text 分离
- 当前 `market-core` 规则牌数量：**30**

### 5) 测试

- engine / schemas / game-client / server 均有 Vitest 覆盖
- server 已含持久化 API 与 DB 写入相关测试

---

## 未完成 ❌

- ReplayScene 逐事件重建播放器（当前仅日志列表）
- 管理后台对局历史页面（admin 仍为壳）
- 正式卡图渲染链路（当前主要为文本 UI）
- locale 运行时切换 UI
- 攻击分配与部分交互体验细化

---

## 文档治理约定

- 任何新增能力，优先更新本文件，再更新专题文档。
- 如专题文档与本文件冲突，以“代码 + 本文件”优先，并在同一提交中修正文档差异。
