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
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_SECRET}|" .env
    else
      sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_SECRET}|" .env
    fi
    log "已自动生成 JWT_SECRET 并写入 .env"
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

log "重启服务..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans
docker compose -f "$COMPOSE_FILE" up -d

log "等待服务启动..."
sleep 5
for i in $(seq 1 10); do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    log "服务已启动并健康"
    break
  fi
  if [ "$i" -eq 10 ]; then
    warn "服务启动超时，请检查日志"
  fi
  sleep 2
done

log "========== 部署状态 =========="
docker compose -f "$COMPOSE_FILE" ps
log "========== 部署完成 =========="
