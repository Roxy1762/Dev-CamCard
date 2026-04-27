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

只需要本机装好 Docker Engine + Compose 插件（**必须开启 BuildKit**，2022 年之后的 Docker 默认即开）：

```bash
git clone <repo> dev-camcard && cd dev-camcard
cp .env.example .env          # 按需改密码/端口；脚本缺省会自动复制
scripts/deploy.sh             # build + up -d
```

启动完成后（无论部署在 localhost、内网 IP 还是公网域名，浏览器都能直接连）：

| 入口 | 地址 |
| --- | --- |
| 游戏前端（Phaser） | <http://${HOST}:3000> |
| Colyseus 房间服务 | ws://${HOST}:3000/game_room *(经 nginx 同域反代)* |
| Server 健康检查   | <http://${HOST}:3000/health> *(经 nginx 同域反代)* |
| 只读对局 API      | <http://${HOST}:3000/api/matches> *(经 nginx 同域反代)* |
| 运营后台（Next.js）| <http://${HOST}:3001> |

打开游戏前端地址，**两个浏览器标签页 / 两台设备各开一次** 就会被 Colyseus 匹配到同一张 `game_room`，进入 1v1 对局。

> 公网部署只需放行 **3000** 与 **3001**，2567 默认已经走 nginx 同域反代，不必额外暴露。
>
> 数据库迁移在 server 容器启动时自动 `prisma migrate deploy`，首次启动会建好全部表结构。

### 为什么是 “同域”？

游戏前端镜像内的 nginx 既托管 Phaser 静态产物，也把 `/matchmake/*` 与 `/game_room/*` 反代到容器内的 server:2567。客户端 `RoomClient` 在生产构建里默认用 `window.location.host` 推导 ws 地址，因此你访问哪个 host 就连哪个 host —— 不会再出现 “部署在 IP 上但客户端硬编码到 localhost:2567 → 网络不可达” 的问题。

如果确实需要前端连接到独立的 server 端点（例如多机部署），在 `.env` 里设置 `VITE_SERVER_URL=wss://your-server-host` 重新构建即可。

### 构建为什么变快？

旧版三个服务各有独立 Dockerfile，每个都跑一次 `pnpm install --frozen-lockfile`，冷构建会做三遍 ≈ 21 分钟。新版用单一 `Dockerfile` 多 target：

- `deps` 阶段执行一次 `pnpm install`，被 `server` / `game-client` / `admin` 三个 target 复用（BuildKit 自动复用 layer）。
- pnpm store 用 `--mount=type=cache` 缓存，二次构建几乎零下载。
- apk 同样使用 cache mount。

冷构建从 ≈ 17 分钟降到 ≈ 5 分钟（视网络），二次 / 增量构建只编译改动到的服务。

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
| `SERVER_HOST_PORT` | server 暴露给宿主机的端口（容器内固定 2567） | 2567 |
| `CLIENT_ORIGIN` | server CORS 白名单，`*` 放行任意来源，或逗号分隔白名单 | `*` |
| `VITE_SERVER_URL` | 构建期注入客户端的 WS 地址；留空 → 同域反代 | *(空)* |
| `CLIENT_HOST_PORT` | 游戏前端宿主机端口 | 3000 |
| `ADMIN_HOST_PORT` | 后台宿主机端口 | 3001 |
| `NEXT_PUBLIC_API_BASE` | 后台调用 server API 的地址 | *(空，走容器内部 server:2567)* |

> 默认就是 “同域单端口” 部署：`VITE_SERVER_URL` 留空 → 客户端按 `window.location` 推导 → nginx 把 `/game_room` ws 与 `/matchmake` HTTP 反代到 server。线上需要锁紧 CORS 时把 `CLIENT_ORIGIN` 换成具体域名列表即可。

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
