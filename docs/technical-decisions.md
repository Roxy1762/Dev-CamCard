# 技术决策冻结清单

## 技术主链

- 客户端：Phaser + TypeScript + Vite
- 联机房间：Colyseus
- 后台 API：NestJS（可与 Colyseus 同进程）
- 规则引擎：独立纯函数（packages/engine）
- 协议：packages/protocol（Command/Event/DTO/View Types）
- 数据定义：JSON Schema + AJV（packages/schemas）
- 数据库：PostgreSQL + Prisma
- 测试：Vitest + replay golden tests
- 后台：React / Next.js

## 状态分层

- InternalMatchState（仅服务端）
- PublicMatchView（双方可见）
- PrivatePlayerView（单方私有）

禁止将 InternalMatchState 直接同步给客户端。

## 许可证边界

- 可直接复用：MIT / Apache-2.0
- AGPL / GPL：仅借鉴架构，不可直接复制核心实现

## 交付策略

- 采用 monorepo：apps + packages
- 采用阶段推进：初始化 → 协议/schema → 最小引擎 → 接房间 → 客户端牌桌
- 每阶段输出：文件清单、运行命令、测试命令、风险、下一步
