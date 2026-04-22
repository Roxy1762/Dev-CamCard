# syntax=docker/dockerfile:1.6
# ── admin：Next.js 14 后台镜像 ───────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/server/package.json       apps/server/package.json
COPY apps/admin/package.json        apps/admin/package.json
COPY apps/game-client/package.json  apps/game-client/package.json
COPY packages/engine/package.json   packages/engine/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/schemas/package.json  packages/schemas/package.json
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app /app
COPY apps/admin apps/admin
RUN pnpm --filter @dev-camcard/admin build

FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@dev-camcard/admin", "start"]
