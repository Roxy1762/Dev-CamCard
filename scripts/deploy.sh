#!/usr/bin/env bash
# Dev-CamCard · 课表风暴  一键部署脚本
#
# 作用：
#   1. 确保 .env 存在（缺失时从 .env.example 复制）
#   2. 选择可用的 docker compose CLI（plugin 或 legacy docker-compose）
#   3. 启用 BuildKit（pnpm 缓存 mount + 多 target 共享 deps 必须）
#   4. build + up -d 全部服务
#   5. 打印健康检查与访问入口
#
# 用法：
#   scripts/deploy.sh              # 默认：build + up -d
#   scripts/deploy.sh down         # 停止并保留数据卷
#   scripts/deploy.sh destroy      # 停止并删除数据卷（危险）
#   scripts/deploy.sh logs         # tail 全部服务日志
#   scripts/deploy.sh migrate      # 只跑一次数据库迁移
#   scripts/deploy.sh ps           # 查看容器状态

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CMD="${1:-up}"

# BuildKit 必须开启：pnpm cache mount + 多 target 共享 deps 才能生效。
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

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

# 读取 .env 中的端口（仅用于打印访问地址，不影响 compose 自身解析）。
# shellcheck disable=SC1091
set -a; source .env 2>/dev/null || true; set +a

# 公网部署时希望打印真实访问地址：优先取 PUBLIC_HOST，否则 hostname -I 第一项，最后回落 localhost。
PUBLIC_HOST="${PUBLIC_HOST:-}"
if [[ -z "$PUBLIC_HOST" ]]; then
  PUBLIC_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
PUBLIC_HOST="${PUBLIC_HOST:-localhost}"

print_endpoints() {
  cat <<EOF
[deploy] 服务已启动。
        玩家主页面    http://${PUBLIC_HOST}:${CLIENT_HOST_PORT:-3000}
        Colyseus     ws://${PUBLIC_HOST}:${CLIENT_HOST_PORT:-3000}/game_room   (经 nginx 同域反代)
        对局 API      http://${PUBLIC_HOST}:${CLIENT_HOST_PORT:-3000}/api/matches
        卡牌 API      http://${PUBLIC_HOST}:${CLIENT_HOST_PORT:-3000}/api/cards
        Server 健康   http://${PUBLIC_HOST}:${CLIENT_HOST_PORT:-3000}/health
        运营后台     http://${PUBLIC_HOST}:${CLIENT_HOST_PORT:-3000}/admin   (经 nginx 同域反代)
        （直连入口） http://${PUBLIC_HOST}:${ADMIN_HOST_PORT:-3001}/admin
        （可选直连） http://${PUBLIC_HOST}:${SERVER_HOST_PORT:-2567}/health
EOF
}

case "$CMD" in
  up|"")
    echo "[deploy] 构建并启动全部服务（BuildKit + 共享 deps）..."
    "${DC[@]}" up -d --build
    print_endpoints
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
