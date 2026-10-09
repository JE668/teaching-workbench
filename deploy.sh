#!/bin/bash
# ============================================
# 1对1教学工作台 - NAS 部署脚本
# ============================================

set -euo pipefail

REGISTRY="ghcr.io/je668"
PROJECT="teaching-workbench"
COMPOSE_FILE="docker-compose.yml"
BACKUP_DIR="${HOME}/backups/teaching-workbench"
ROLLBACK_FILE="/tmp/teaching-workbench-last-tag"

# 读取 .env 中的前端端口（健康检查用；默认 80）
# 注意：set -e 下命令替换失败会终止脚本，故必须兜底；并校验为纯数字。
FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r' || true)
case "$FRONTEND_PORT" in
  '' | *[!0-9]*) FRONTEND_PORT=80 ;;
esac

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

DO_BACKUP=false
DO_ROLLBACK=false
for arg in "$@"; do
  case $arg in
    --backup) DO_BACKUP=true ;;
    --rollback) DO_ROLLBACK=true ;;
    *) error "未知参数: $arg" ;;
  esac
done

# ===== 部署前检查关键密钥 =====
ensure_env_secrets() {
  if [ ! -f .env ]; then
    warn "未找到 .env，请先执行: cp .env.production.example .env"
    return 0
  fi

  # JWT_SECRET 为空时自动生成，避免退回源码中公开的默认密钥
  if ! grep -qE '^JWT_SECRET=.+' .env; then
    NEW_SECRET=$(openssl rand -hex 32)

    if grep -qE '^JWT_SECRET=' .env; then
      # 已有该行但值为空 -> 就地替换
      if sed --version >/dev/null 2>&1; then
        sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_SECRET}|" .env
      else
        sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_SECRET}|" .env
      fi
      log "已自动生成 JWT_SECRET 并写入 .env"
    else
      # 完全没有该行 -> 必须追加。
      # 原来直接 sed 会"匹配不到就不替换"却仍报成功，
      # 导致每次部署重复生成、密钥从未落盘。
      printf '
# 自动生成的 JWT 签名密钥（请勿泄露；丢失会导致所有登录失效）
JWT_SECRET=%s
' "$NEW_SECRET" >> .env
      log "已在 .env 中新增 JWT_SECRET（自动生成）"
    fi
  fi

  if ! grep -qE '^SENSENOVA_API_KEY=.+' .env; then
    warn "SENSENOVA_API_KEY 尚未配置，AI 生成功能将不可用"
  fi

  if grep -qE '^DEFAULT_ADMIN_PASS=(123456)?$' .env; then
    warn "默认管理员密码仍是弱口令，建议修改 DEFAULT_ADMIN_PASS"
  fi
}
ensure_env_secrets

if [ "$DO_ROLLBACK" = true ]; then
  if [ -f "$ROLLBACK_FILE" ]; then
    LAST_TAG=$(cat "$ROLLBACK_FILE")
    log "回滚到版本: $LAST_TAG"
    TAG="$LAST_TAG" docker compose -f "$COMPOSE_FILE" pull
    TAG="$LAST_TAG" docker compose -f "$COMPOSE_FILE" up -d
    log "回滚完成"
  else
    error "未找到上次部署记录"
  fi
  exit 0
fi

if docker compose -f "$COMPOSE_FILE" ps -q backend > /dev/null 2>&1; then
  CURRENT_IMAGE=$(docker compose -f "$COMPOSE_FILE" ps --format '${{.Image}}' backend 2>/dev/null || echo "")
  if [ -n "$CURRENT_IMAGE" ]; then
    echo "$CURRENT_IMAGE" > "$ROLLBACK_FILE"
    log "已记录当前版本"
  fi
fi

if [ "$DO_BACKUP" = true ]; then
  log "部署前备份数据..."
  BACKUP_DIR="$BACKUP_DIR" ./backup.sh
fi

log "拉取最新镜像..."
docker pull "$REGISTRY/$PROJECT-backend:latest"
docker pull "$REGISTRY/$PROJECT-frontend:latest"

# ====== 老版本数据迁移（命名卷 → 目录）======
# 早期版本用 Docker 命名卷 teaching_workbench_db 存数据。
# 改成目录挂载后，若不迁移，用户会以为"数据全没了"。
migrate_legacy_volume() {
  local data_path
  # 注意：必须一起去掉 \r —— .env 若是 CRLF 换行，
  # 路径会变成 "./data\r"，导致下面的存在性判断永远不成立、每次部署重复迁移。
  data_path="$(grep -E '^DATA_PATH=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d ' \r')"
  data_path="${data_path:-./data}"

  # 只在老卷存在、且新目录还没有数据库时才迁移
  if ! docker volume inspect teaching_workbench_db >/dev/null 2>&1; then
    return 0
  fi
  if [ -f "$data_path/teaching.db" ]; then
    return 0
  fi

  log "检测到旧版命名卷，正在把数据迁移到 $data_path ..."
  mkdir -p "$data_path"

  docker run --rm \
    -v teaching_workbench_db:/from \
    -v "$(cd "$data_path" && pwd)":/to \
    alpine sh -c "cd /from && cp -a . /to/" >/dev/null 2>&1 || {
      warn "自动迁移失败，请手动执行："
      warn "  docker run --rm -v teaching_workbench_db:/from -v \$(pwd)/data:/to alpine sh -c 'cd /from && cp -a . /to/'"
      return 0
    }

  log "数据已迁移（旧卷仍保留，确认无误后可执行 docker volume rm teaching_workbench_db 清理）"
}

migrate_legacy_volume

log "重启服务..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans
docker compose -f "$COMPOSE_FILE" up -d

log "等待服务启动..."
sleep 5
# 后端 3000 仅在容器网络内暴露（expose），宿主机访问不到，
# 因此通过前端已发布端口做端到端健康检查（nginx 会把 /health 反代到后端）。
HEALTH_URL="http://localhost:${FRONTEND_PORT}/health"
for i in $(seq 1 10); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    log "服务已启动并健康 ($HEALTH_URL)"
    break
  fi
  if [ "$i" -eq 10 ]; then
    warn "健康检查超时 ($HEALTH_URL)，请查看日志: docker compose -f $COMPOSE_FILE logs"
  fi
  sleep 2
done

log "========== 部署状态 =========="
docker compose -f "$COMPOSE_FILE" ps
log "本地访问: http://localhost:${FRONTEND_PORT}"
log "========== 部署完成 =========="
