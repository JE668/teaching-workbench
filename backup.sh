#!/bin/bash
# ============================================
# 1对1教学工作台 - 数据备份脚本
# ============================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-${HOME}/backups/teaching-workbench}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PROJECT="teaching-workbench"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[BACKUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

mkdir -p "$BACKUP_DIR"

log "备份数据库..."
DB_FILE="$BACKUP_DIR/teaching-workbench-$TIMESTAMP.db"
if docker exec "$PROJECT-backend" test -f /app/data/teaching.db 2>/dev/null; then
  docker cp "$PROJECT-backend:/app/data/teaching.db" "$DB_FILE"
  log "数据库备份完成"
else
  warn "数据库文件不存在，跳过"
fi

log "备份上传文件..."
UPLOADS_ARCHIVE="$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz"
VOLUME_PATH=$(docker volume inspect "teaching_workbench_db" --format '${{.Mountpoint}}' 2>/dev/null || echo "")
if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH/uploads" ]; then
  tar -czf "$UPLOADS_ARCHIVE" -C "$VOLUME_PATH" uploads
  log "上传文件备份完成"
else
  warn "上传目录不存在，跳过"
fi

log "清理旧备份（保留最近7天）..."
cd "$BACKUP_DIR"
find . -name 'teaching-workbench-*.db' -mtime +7 -delete 2>/dev/null || true
find . -name 'uploads-*.tar.gz' -mtime +7 -delete 2>/dev/null || true

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0B")
DB_COUNT=$(find "$BACKUP_DIR" -name 'teaching-workbench-*.db' 2>/dev/null | wc -l | tr -d ' ')
UPLOAD_COUNT=$(find "$BACKUP_DIR" -name 'uploads-*.tar.gz' 2>/dev/null | wc -l | tr -d ' ')

echo ""
log "========== 备份完成 =========="
log "备份目录: $BACKUP_DIR"
log "数据库: $DB_COUNT 个 | 上传文件: $UPLOAD_COUNT 个 | 总大小: $TOTAL_SIZE"
