# syntax=docker/dockerfile:1.6
# ── server：Colyseus + Express 运行镜像 ──────────────────────────────────────
# 说明：workspace 包（engine/protocol/schemas）通过 package.json 的 "main" 指向 src/*.ts，
# 所以生产运行时仍用 tsx 直接执行 TS，避免为每个包再维护一份构建产物。
FROM node:20-alpine AS base
RUN apk add --no-cache openssl bash libc6-compat
RUN corepack enable

# ── 1) deps：仅安装 node_modules（利用分层缓存） ────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/server/package.json          apps/server/package.json
COPY apps/server/prisma                apps/server/prisma
COPY apps/server/prisma.config.ts      apps/server/prisma.config.ts
COPY apps/game-client/package.json     apps/game-client/package.json
COPY apps/admin/package.json           apps/admin/package.json
COPY packages/engine/package.json      packages/engine/package.json
COPY packages/protocol/package.json    packages/protocol/package.json
COPY packages/schemas/package.json     packages/schemas/package.json
RUN pnpm install --frozen-lockfile

# ── 2) runtime：拷贝源码 + 预生成 Prisma client ──────────────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY packages   packages
COPY apps/server apps/server
COPY data       data
COPY scripts    scripts
# Prisma 7 需要在运行时前完成 generate
RUN pnpm --filter @dev-camcard/server exec prisma generate

EXPOSE 2567
# 启动流程：先 migrate deploy（幂等），再拉起 tsx 运行 server
CMD ["sh", "-c", "pnpm --filter @dev-camcard/server exec prisma migrate deploy && pnpm --filter @dev-camcard/server exec tsx src/index.ts"]
