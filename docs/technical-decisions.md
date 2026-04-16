# 技术决策冻结清单（与当前代码对齐）

## 技术主链

- 客户端：**Phaser + TypeScript + Vite**（`apps/game-client`）
- 联机房间：**Colyseus**（`apps/server/src/rooms/GameRoom.ts`）
- 后端 API：**Express（与 Colyseus 同进程）**（`apps/server/src/index.ts`）
- 规则引擎：**独立纯函数包**（`packages/engine`）
- 协议：`packages/protocol`（Command / Event / View Types）
- 数据定义与校验：**JSON Schema + AJV**（`packages/schemas`）
- 持久化：**PostgreSQL + Prisma 7 + @prisma/adapter-pg**（`apps/server/src/prisma.ts`）
- 测试：**Vitest**（engine/schemas/client/server 均已接入）
- 后台：**Next.js 14（admin 壳）**（`apps/admin`）

## 状态分层

- `InternalMatchState`（仅服务端）
- `PublicMatchView`（双方可见）
- `PrivatePlayerView`（单方私有）

禁止将 `InternalMatchState` 直接同步给客户端。

## 许可证边界

- 可直接复用：MIT / Apache-2.0
- AGPL / GPL：仅借鉴架构，不可直接复制核心实现

## 交付策略（当前仍有效）

- monorepo（`apps/* + packages/*`）
- 阶段推进（架构 → 协议/schema → 引擎 → 房间 → 客户端）
- 每阶段输出：文件清单、运行命令、测试命令、风险、下一步
