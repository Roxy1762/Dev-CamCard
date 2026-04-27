# syntax=docker/dockerfile:1.7
# ── Dev-CamCard 多服务镜像（单 Dockerfile 多 target） ───────────────────────────
#
# 目标：
#   server       — Colyseus + Express，端口 2567
#   game-client  — Phaser 静态站，nginx 托管 + ws 反代
#   admin        — Next.js 14 运营后台，端口 3001
#
# 设计要点：
#   1) 三个服务共用一个 deps 阶段：pnpm install 仅执行一次，BuildKit 自动复用
#      → 冷构建从 ~3 × 700s 降到 ~1 × 700s。
#   2) BuildKit cache mount 缓存 pnpm store + apk index：
#      → 第二次构建（即便 lockfile 变化）也能跳过包下载。
#   3) 源码与产物分阶段拷贝：lockfile / package.json 改动才会触发重装。
#
# 构建：
#   docker build --target server      -t dev-camcard-server      .
#   docker build --target game-client -t dev-camcard-game-client .
#   docker build --target admin       -t dev-camcard-admin       .
#
# 注意：必须启用 BuildKit（DOCKER_BUILDKIT=1 / docker compose 默认即开）。

ARG NODE_IMAGE=node:20-alpine

# ── base：通用底座（pnpm + 系统依赖）────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN --mount=type=cache,id=apk,target=/var/cache/apk,sharing=locked \
    apk add --no-cache openssl bash libc6-compat \
 && corepack enable
WORKDIR /app

# ── deps：一次 pnpm install，被全部 target 复用 ────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/server/package.json       apps/server/package.json
COPY apps/server/prisma             apps/server/prisma
COPY apps/server/prisma.config.ts   apps/server/prisma.config.ts
COPY apps/game-client/package.json  apps/game-client/package.json
COPY apps/admin/package.json        apps/admin/package.json
COPY packages/engine/package.json   packages/engine/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/schemas/package.json  packages/schemas/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── full：deps + 全量源码，作为 build/runtime 的公共底座 ────────────────────
FROM deps AS full
COPY packages packages
COPY apps     apps
COPY data     data

# ──────────────────────────────────────────────────────────────────────────────
# Target: server
# ──────────────────────────────────────────────────────────────────────────────
FROM full AS server
ENV NODE_ENV=production
RUN pnpm --filter @dev-camcard/server exec prisma generate
EXPOSE 2567
# migrate 幂等，可重入；随后由 tsx 直接执行 TS（workspace main 指向 src/*.ts）
CMD ["sh", "-c", "pnpm --filter @dev-camcard/server exec prisma migrate deploy && pnpm --filter @dev-camcard/server exec tsx src/index.ts"]

# ──────────────────────────────────────────────────────────────────────────────
# Target: game-client（先 vite build，再 nginx 托管 dist）
# ──────────────────────────────────────────────────────────────────────────────
FROM full AS game-client-build
ARG VITE_SERVER_URL=""
ARG VITE_ADMIN_URL=""
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_ADMIN_URL=${VITE_ADMIN_URL}
RUN pnpm --filter @dev-camcard/game-client build

FROM nginx:1.27-alpine AS game-client
COPY apps/game-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=game-client-build /app/apps/game-client/dist /usr/share/nginx/html
EXPOSE 80

# ──────────────────────────────────────────────────────────────────────────────
# Target: admin（next build → 同镜像复用 node_modules 启动）
# ──────────────────────────────────────────────────────────────────────────────
FROM full AS admin
ARG NEXT_BASE_PATH=""
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# basePath 必须在 next build 时确定（运行期改 env 不会迁移生成的 _next/* URL）。
ENV NEXT_BASE_PATH=${NEXT_BASE_PATH}
RUN pnpm --filter @dev-camcard/admin build
EXPOSE 3001
CMD ["pnpm", "--filter", "@dev-camcard/admin", "start"]
