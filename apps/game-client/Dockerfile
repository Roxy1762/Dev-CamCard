# syntax=docker/dockerfile:1.6
# ── game-client：Phaser + Vite 静态镜像（由 nginx 提供） ─────────────────────
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
COPY packages          packages
COPY apps/game-client  apps/game-client
# VITE_SERVER_URL 在构建期注入；未设置时走同 host 默认推导。
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN pnpm --filter @dev-camcard/game-client build

FROM nginx:1.27-alpine AS runtime
# nginx 默认站点：托管 dist 并把 /ws → colyseus server，/api → express
COPY apps/game-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/game-client/dist /usr/share/nginx/html
EXPOSE 80
