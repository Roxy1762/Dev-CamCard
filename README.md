# Dev-CamCard · 课表风暴

面向 1v1 卡牌对战的技术原型 monorepo，当前已跑通：对局主循环、三栏市场、预约位、日程槽、场馆与 guard、断线重连、seeded RNG、事件流持久化与只读 API、Phaser 牌桌客户端、Next.js 运营后台。

> 要了解设计与进度：`docs/current-capabilities.md`、`docs/roadmap-next.md`、`docs/known-issues.md`。

## 目录

- [一分钟部署（Docker）](#一分钟部署docker)
- [本地开发](#本地开发)
- [服务拓扑](#服务拓扑)
- [环境变量](#环境变量)
- [常用运维动作](#常用运维动作)
- [可玩性范围](#可玩性范围)

## 一分钟部署（Docker）

只需要本机装好 Docker Engine + Compose 插件：

```bash
git clone <repo> dev-camcard && cd dev-camcard
cp .env.example .env          # 按需改密码/端口；脚本缺省会自动复制
scripts/deploy.sh             # build + up -d，首次约 2~3 分钟
```

启动完成后：

| 入口 | 地址 |
| --- | --- |
| 游戏前端（Phaser） | <http://localhost:3000> |
| Colyseus 房间服务 | ws://localhost:2567 |
| Server 健康检查   | <http://localhost:2567/health> |
| 只读对局 API      | <http://localhost:2567/api/matches> |
| 运营后台（Next.js）| <http://localhost:3001> |

打开 <http://localhost:3000>，**两个浏览器标签页 / 两台设备各开一次** 就会被 Colyseus 匹配到同一张 `game_room`，进入 1v1 对局。

> 数据库迁移在 server 容器启动时自动 `prisma migrate deploy`，首次启动会建好全部表结构。

## 本地开发

不想走 Docker，可以直接跑源码：

```bash
corepack enable
scripts/setup-dev.sh           # 安装依赖 + 生成 Prisma + 拉起 postgres 容器 + migrate
# 无 Docker 时：scripts/setup-dev.sh --no-db   并自行配置 DATABASE_URL
```

随后分别启动：

```bash
pnpm --filter @dev-camcard/server      dev    # 端口 2567（ts-node via tsx）
pnpm --filter @dev-camcard/game-client dev    # 端口 3000（Vite）
pnpm --filter @dev-camcard/admin       dev    # 端口 3001（Next.js）
# 或一次 pnpm dev 并行拉起全部
```

运行全量测试：

```bash
pnpm test            # engine + schemas + client + server
pnpm typecheck
```

## 服务拓扑

```
┌──────────────┐    ws  ┌───────────────┐    sql   ┌────────────┐
│ game-client  ├───────►│   server      ├─────────►│ postgres   │
│ Phaser+nginx │        │ Colyseus+Ex   │          │ 16-alpine  │
└──────────────┘        └───────┬───────┘          └────────────┘
                                │ http /api
                                ▼
                        ┌───────────────┐
                        │    admin      │
                        │ Next.js 14    │
                        └───────────────┘
```

- `server` 直接以 `tsx` 运行 TS（workspace 包通过 `package.json -> main: src/index.ts` 指向源码）。
- `game-client` 用 nginx 托管 Vite 构建产物，同时暴露 `/api`、`/matchmake`、`/game_room` 反代，便于同域部署。
- `admin` 通过 `NEXT_PUBLIC_API_BASE` 调用 server 的只读 API，显示最近对局 + 事件流。

## 环境变量

| 变量 | 用途 | 默认 |
| --- | --- | --- |
| `POSTGRES_USER/PASSWORD/DB` | Postgres 凭据 | camcard/camcard/camcard |
| `POSTGRES_HOST_PORT` | 宿主机暴露端口 | 5432 |
| `SERVER_PORT` | server 端口（宿主机 & 容器） | 2567 |
| `CLIENT_ORIGIN` | server CORS 白名单，逗号分隔 | http://localhost:3000,http://localhost:3001 |
| `VITE_SERVER_URL` | 构建期注入客户端的 WS 地址 | ws://localhost:2567 |
| `CLIENT_HOST_PORT` | 游戏前端宿主机端口 | 3000 |
| `ADMIN_HOST_PORT` | 后台宿主机端口 | 3001 |
| `NEXT_PUBLIC_API_BASE` | 后台调用 server API 的地址 | http://localhost:2567 |

> 同域部署（单端口）：把 `VITE_SERVER_URL=` 留空重建 game-client，nginx 会把 `/game_room` ws 与 `/matchmake` HTTP 反代到 server，客户端自动以 `window.location` 推导地址。

## 常用运维动作

```bash
scripts/deploy.sh up         # build + up -d（缺省动作）
scripts/deploy.sh down       # 停止容器（保留数据卷）
scripts/deploy.sh destroy    # 停止 + 删除数据卷（会提示确认）
scripts/deploy.sh logs       # tail 最近 200 行全部服务日志
scripts/deploy.sh migrate    # 单独跑一次 prisma migrate deploy
scripts/deploy.sh ps         # 查看容器状态
```

后台生成卡牌目录（对文档与策划有用）：

```bash
pnpm generate:card-catalog   # 产出 docs/card-catalog.generated.md
```

## 可玩性范围

当前 Docker 镜像启动即可玩的 MVP 功能：

- 1v1 房间匹配（自动匹配到同一个 `game_room`）
- 三栏市场 + 预约位 + 固定补给
- 日程槽、场馆耐久、guard 优先攻击、压力机制
- 60 秒断线重连
- 事件流落库 → 后台查看 & 客户端回放入口

当前仍为技术原型，不含观战、排位、社交、开包等扩展玩法。后续建议推进方向见 `docs/roadmap-next.md`。
