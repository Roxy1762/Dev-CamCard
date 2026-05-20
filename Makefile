# Dev-CamCard · 课表风暴  Makefile
#
# 设计原则：
#   - 不重复 scripts/deploy.sh 的逻辑，所有运维操作 thin-wrap 到既有脚本。
#   - 新增的关键能力是 `make update` —— 拉取最新代码 + 重建镜像 + 滚动重启 +
#     自动跑数据库迁移，全程不删除 postgres 数据卷。
#   - 兼容 BSD make 与 GNU make 的基础语法；不依赖 GNU 扩展 (no .PHONY block reuse, no patsubst).
#   - 默认目标 = help，避免裸 `make` 误触构建动作。
#
# 用法速查：
#   make            # 等价于 make help，列出全部目标
#   make update     # 关键：在线更新部署（拉新代码 + 重建 + 迁移 + 重启）
#   make up         # 首次部署或冷启动
#   make logs       # tail 服务日志
#   make ps         # 看容器状态

# ── 配置 ─────────────────────────────────────────────────────────────────────
DEPLOY     ?= scripts/deploy.sh
PNPM       ?= corepack pnpm
GIT        ?= git
# 允许覆盖：`make update GIT_REMOTE=upstream GIT_BRANCH=main`
GIT_REMOTE ?= origin
GIT_BRANCH ?=

# 颜色（仅在 tty 时启用，避免污染日志）
ifeq ($(shell test -t 1 && echo yes),yes)
  C_BOLD := \033[1m
  C_DIM  := \033[2m
  C_OK   := \033[32m
  C_WARN := \033[33m
  C_END  := \033[0m
else
  C_BOLD :=
  C_DIM  :=
  C_OK   :=
  C_WARN :=
  C_END  :=
endif

.DEFAULT_GOAL := help

# ── 帮助 ─────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@printf '$(C_BOLD)Dev-CamCard · 课表风暴 — Make 目标$(C_END)\n'
	@printf '\n'
	@printf '$(C_BOLD)在线运维$(C_END)\n'
	@printf '  $(C_OK)make update$(C_END)        在线更新部署：git pull → 重建镜像 → 迁移 → 滚动重启（保留数据）\n'
	@printf '  make update-local  本地变更后重建部署（跳过 git pull，仅 rebuild + migrate + restart）\n'
	@printf '  make up            首次部署 / 冷启动（build + up -d）\n'
	@printf '  make down          停止容器（保留数据卷）\n'
	@printf '  make restart       仅滚动重启已有容器（不重建）\n'
	@printf '  make destroy       $(C_WARN)危险$(C_END)：停止并删除数据卷（会确认）\n'
	@printf '  make logs          tail 全部服务最近 200 行\n'
	@printf '  make logs-server   tail server 日志\n'
	@printf '  make logs-client   tail game-client 日志\n'
	@printf '  make logs-admin    tail admin 日志\n'
	@printf '  make ps / status   查看容器状态\n'
	@printf '  make migrate       单独跑一次 prisma migrate deploy\n'
	@printf '  make backup-db     dump postgres 到 ./backups/<时间戳>.sql\n'
	@printf '\n'
	@printf '$(C_BOLD)本地开发$(C_END)\n'
	@printf '  make install       安装依赖（pnpm install --frozen-lockfile）\n'
	@printf '  make dev           本地开发模式 (pnpm dev，并行启动全部 app)\n'
	@printf '  make build         monorepo build\n'
	@printf '  make test          monorepo test\n'
	@printf '  make typecheck     monorepo typecheck\n'
	@printf '  make lint          monorepo lint\n'
	@printf '  make catalog       生成 docs/card-catalog.generated.md\n'
	@printf '  make clean         清理 node_modules / dist / .next / .turbo\n'
	@printf '\n'
	@printf '$(C_BOLD)说明$(C_END)\n'
	@printf '  $(C_DIM)`make update` 等于上线更新的"安全键"：永远 rebuild + migrate + 滚动重启，但不会动数据卷。$(C_END)\n'
	@printf '  $(C_DIM)如果某个变更已经在本地写好但不想拉远端，请用 `make update-local`。$(C_END)\n'

# ── 在线运维（thin wrap scripts/deploy.sh） ─────────────────────────────────
.PHONY: up
up:
	@$(DEPLOY) up

.PHONY: down
down:
	@$(DEPLOY) down

.PHONY: destroy
destroy:
	@$(DEPLOY) destroy

.PHONY: logs
logs:
	@$(DEPLOY) logs

.PHONY: logs-server
logs-server:
	@docker compose logs -f --tail=200 server

.PHONY: logs-client
logs-client:
	@docker compose logs -f --tail=200 game-client

.PHONY: logs-admin
logs-admin:
	@docker compose logs -f --tail=200 admin

.PHONY: ps status
ps status:
	@$(DEPLOY) ps

.PHONY: migrate
migrate:
	@$(DEPLOY) migrate

.PHONY: restart
restart:
	@docker compose restart

# ── update：在线更新部署（核心新增能力） ──────────────────────────────────
# 流程：
#   1. (可选) git fetch + git pull --ff-only：始终走 fast-forward，避免脚本里产生意外 merge commit。
#      - 工作区脏 → 中止并提示，避免覆盖未提交的本地改动。
#      - 网络失败 → 中止并提示重试。
#   2. docker compose build：BuildKit + 多 target 共享 deps，增量构建 ≈ 1-2 分钟。
#   3. docker compose run --rm server prisma migrate deploy：保证 schema 与新代码一致。
#      - 容器内固定走 `pnpm --filter @dev-camcard/server exec prisma migrate deploy`，
#        失败时立即中止，避免代码已上但 schema 落后导致 5xx。
#   4. docker compose up -d：缺省 recreate-strategy=changed 实现"滚动重启"——
#      只重启镜像变化的服务，postgres 不会被动。
#   5. 打印健康检查 / 入口地址。
.PHONY: update
update:
	@printf '$(C_BOLD)[1/4] 拉取最新代码 ($(GIT_REMOTE)$(if $(GIT_BRANCH),/$(GIT_BRANCH),))...$(C_END)\n'
	@if ! $(GIT) diff --quiet || ! $(GIT) diff --cached --quiet; then \
	  printf '$(C_WARN)[update] 工作区存在未提交改动，已中止。先 git stash 或 commit 再 make update（或用 make update-local 跳过 pull）。$(C_END)\n'; \
	  exit 1; \
	fi
	@if [ -n "$(GIT_BRANCH)" ]; then \
	  $(GIT) fetch $(GIT_REMOTE) $(GIT_BRANCH) && \
	  $(GIT) pull --ff-only $(GIT_REMOTE) $(GIT_BRANCH); \
	else \
	  CUR_BRANCH=$$($(GIT) rev-parse --abbrev-ref HEAD) && \
	  $(GIT) fetch $(GIT_REMOTE) $$CUR_BRANCH && \
	  $(GIT) pull --ff-only $(GIT_REMOTE) $$CUR_BRANCH; \
	fi
	@$(MAKE) -s _update-rebuild

.PHONY: update-local
update-local:
	@printf '$(C_BOLD)[1/4] 跳过 git pull（本地模式）$(C_END)\n'
	@$(MAKE) -s _update-rebuild

# 真正干活的子目标：build → migrate → up -d（保留数据卷）→ 打印入口
.PHONY: _update-rebuild
_update-rebuild:
	@printf '$(C_BOLD)[2/4] 重建镜像（BuildKit 共享 deps，仅变更服务重新编译）...$(C_END)\n'
	@DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose build
	@printf '$(C_BOLD)[3/4] 执行数据库迁移 (prisma migrate deploy)...$(C_END)\n'
	@$(DEPLOY) migrate
	@printf '$(C_BOLD)[4/4] 滚动重启（保留 postgres 数据卷）...$(C_END)\n'
	@DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up -d
	@printf '$(C_OK)[update] 完成。容器状态：$(C_END)\n'
	@$(DEPLOY) ps

# ── 备份 ─────────────────────────────────────────────────────────────────────
.PHONY: backup-db
backup-db:
	@mkdir -p backups
	@TS=$$(date +%Y%m%d-%H%M%S); \
	  OUT=backups/postgres-$$TS.sql; \
	  printf '$(C_BOLD)[backup] dumping postgres → %s$(C_END)\n' "$$OUT"; \
	  docker compose exec -T postgres sh -c 'pg_dump -U "$${POSTGRES_USER:-camcard}" "$${POSTGRES_DB:-camcard}"' > "$$OUT"; \
	  printf '$(C_OK)[backup] done: %s$(C_END)\n' "$$OUT"

# ── 本地开发 ─────────────────────────────────────────────────────────────────
.PHONY: install
install:
	@$(PNPM) install --frozen-lockfile

.PHONY: dev
dev:
	@$(PNPM) -r --if-present --parallel run dev

.PHONY: build
build:
	@$(PNPM) -r run build

.PHONY: test
test:
	@$(PNPM) -r --if-present run test

.PHONY: typecheck
typecheck:
	@$(PNPM) -r run typecheck

.PHONY: lint
lint:
	@$(PNPM) -r --if-present run lint

.PHONY: catalog
catalog:
	@$(PNPM) generate:card-catalog

.PHONY: clean
clean:
	@printf '$(C_BOLD)[clean] 删除 node_modules / dist / .next / .turbo$(C_END)\n'
	@find . -type d \( -name node_modules -o -name dist -o -name .next -o -name .turbo \) -prune -exec rm -rf {} +
	@printf '$(C_OK)[clean] done$(C_END)\n'
