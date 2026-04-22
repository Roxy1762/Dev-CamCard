#!/usr/bin/env bash
# Dev-CamCard 本地开发环境引导脚本
#
# 作用：
#   1. 启用 corepack + pnpm
#   2. 安装 workspace 依赖
#   3. 生成 Prisma Client
#   4. （可选）启动 postgres 容器并跑一次 migrate dev
#   5. 打印后续 pnpm dev 指引
#
# 用法：
#   scripts/setup-dev.sh               # 全量准备
#   scripts/setup-dev.sh --no-db       # 不拉起 postgres 容器
#
# 要求：
#   - Node >= 20
#   - Docker（如需启动 postgres；--no-db 时非必须）

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WITH_DB=1
for arg in "$@"; do
  case "$arg" in
    --no-db) WITH_DB=0 ;;
  esac
done

echo "[setup] 启用 corepack 并校准 pnpm..."
corepack enable
corepack prepare pnpm@10.33.0 --activate >/dev/null 2>&1 || true

echo "[setup] 安装依赖（pnpm install）..."
corepack pnpm install

echo "[setup] 生成 Prisma Client..."
corepack pnpm --filter @dev-camcard/server exec prisma generate

if [[ ! -f apps/server/.env ]]; then
  cp apps/server/.env.example apps/server/.env
  echo "[setup] 已生成 apps/server/.env（默认指向 localhost:5432/camcard）"
fi

if [[ $WITH_DB -eq 1 ]]; then
  if docker compose version >/dev/null 2>&1; then
    DC=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    DC=(docker-compose)
  else
    echo "[setup] 未检测到 docker compose，跳过 postgres 启动。"
    DC=()
  fi

  if [[ ${#DC[@]} -gt 0 ]]; then
    if [[ ! -f .env ]]; then cp .env.example .env; fi
    echo "[setup] 启动 postgres 容器..."
    "${DC[@]}" up -d postgres
    echo "[setup] 等待数据库就绪..."
    for i in $(seq 1 30); do
      if "${DC[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER:-camcard}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    echo "[setup] 应用迁移..."
    corepack pnpm --filter @dev-camcard/server exec prisma migrate deploy
  fi
fi

cat <<EOF

[setup] 完成。可选下一步：
  - 单独启动房间服务：  pnpm --filter @dev-camcard/server dev
  - 启动 Phaser 前端：  pnpm --filter @dev-camcard/game-client dev   （http://localhost:3000）
  - 启动 Next 后台：    pnpm --filter @dev-camcard/admin dev         （http://localhost:3001）
  - 一把运行全部：      pnpm dev
EOF
