#!/usr/bin/env bash
# Dev-CamCard · 课表风暴  一键部署脚本
#
# 作用：
#   1. 确保 .env 存在（缺失时从 .env.example 复制）
#   2. 选择可用的 docker compose CLI（plugin 或 legacy docker-compose）
#   3. build + up -d 全部服务
#   4. 打印健康检查与访问入口
#
# 用法：
#   scripts/deploy.sh              # 默认：build + up -d
#   scripts/deploy.sh down         # 停止并保留数据卷
#   scripts/deploy.sh destroy      # 停止并删除数据卷（危险）
#   scripts/deploy.sh logs         # tail 全部服务日志
#   scripts/deploy.sh migrate      # 只跑一次数据库迁移

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CMD="${1:-up}"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "[deploy] 错误：未检测到 docker compose / docker-compose，请先安装 Docker Engine + Compose。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "[deploy] 已根据 .env.example 生成 .env，可按需修改后重新运行。"
  else
    echo "[deploy] 缺少 .env.example，无法生成默认 env。" >&2
    exit 1
  fi
fi

case "$CMD" in
  up|"")
    echo "[deploy] 构建并启动全部服务..."
    "${DC[@]}" up -d --build
    echo "[deploy] 服务已启动。"
    echo "          游戏前端     http://localhost:${CLIENT_HOST_PORT:-3000}"
    echo "          Colyseus     ws://localhost:${SERVER_PORT:-2567}"
    echo "          Server 健康   http://localhost:${SERVER_PORT:-2567}/health"
    echo "          运营后台     http://localhost:${ADMIN_HOST_PORT:-3001}"
    ;;
  down)
    "${DC[@]}" down
    ;;
  destroy)
    read -rp "将删除全部容器与数据卷，确认 (y/N)? " ans
    if [[ "$ans" == "y" || "$ans" == "Y" ]]; then
      "${DC[@]}" down -v
    else
      echo "[deploy] 已取消。"
    fi
    ;;
  logs)
    "${DC[@]}" logs -f --tail=200
    ;;
  migrate)
    "${DC[@]}" run --rm server \
      pnpm --filter @dev-camcard/server exec prisma migrate deploy
    ;;
  ps|status)
    "${DC[@]}" ps
    ;;
  *)
    echo "用法: scripts/deploy.sh [up|down|destroy|logs|migrate|ps]"
    exit 1
    ;;
esac
