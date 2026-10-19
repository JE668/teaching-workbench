#!/bin/bash
# ============================================
# 1对1教学工作台 - 数据备份脚本
# ============================================
# 数据都挂在 DATA_PATH（容器内 /app/data），这里统一从容器里取，
# 避免去猜宿主机路径：宿主机可能跑的是命名卷，也可能是绑定目录。

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-${HOME}/backups/teaching-workbench}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PROJECT="teaching-workbench"
CONTAINER="${PROJECT}-backend"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[BACKUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

mkdir -p "$BACKUP_DIR"

# ===== 数据库 =====
# 服务开着时库是 WAL 模式，只拷 teaching.db 会丢掉 -wal 里尚未合并的写入。
# 首选 better-sqlite3 的在线备份（会正确读完 WAL）；失败才退化成三件套一起拷。
log "备份数据库..."
DB_FILE="$BACKUP_DIR/teaching-workbench-$TIMESTAMP.db"
# 注意 --input-type=module：容器里 /app 的 package.json 是 type:module，
# 静态 import 写法最稳，不用猜 CJS/ESM 的导出形状。
BACKUP_NODE="import Database from 'better-sqlite3';const db=new Database('/app/data/teaching.db');db.backup('/tmp/tw-backup.db').then(()=>{console.log('backup-ok');db.close()}).catch(e=>{console.error(e&&e.message||e);process.exit(1)})"
ONLINE_OK=false
if docker exec -i "$CONTAINER" node --input-type=module -e "$BACKUP_NODE" < /dev/null >/dev/null 2>&1; then
  if docker cp "$CONTAINER:/tmp/tw-backup.db" "$DB_FILE" 2>/dev/null; then
    ONLINE_OK=true
  fi
fi
docker exec "$CONTAINER" rm -f /tmp/tw-backup.db 2>/dev/null || true

if [ "$ONLINE_OK" = true ]; then
  log "数据库备份完成（WAL 安全）"
elif docker exec "$CONTAINER" test -f /app/data/teaching.db 2>/dev/null; then
  docker cp "$CONTAINER:/app/data/teaching.db" "$DB_FILE"
  # 连 -wal / -shm 一起存，恢复时放在同一目录即可无损重建
  docker cp "$CONTAINER:/app/data/teaching.db-wal" "$DB_FILE-wal" 2>/dev/null || true
  docker cp "$CONTAINER:/app/data/teaching.db-shm" "$DB_FILE-shm" 2>/dev/null || true
  warn "在线备份失败，已改为直接拷贝数据库文件"
else
  warn "数据库不存在或后端容器未运行，跳过"
fi

# ===== 上传文件（课堂照片 / 作业截图）=====
log "备份上传文件..."
if docker exec "$CONTAINER" test -d /app/data/uploads 2>/dev/null; then
  docker exec "$CONTAINER" sh -c "tar -czf /tmp/tw-uploads.tar.gz -C /app/data uploads"
  docker cp "$CONTAINER:/tmp/tw-uploads.tar.gz" "$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz"
  docker exec "$CONTAINER" rm -f /tmp/tw-uploads.tar.gz 2>/dev/null || true
  log "上传文件备份完成"
else
  warn "上传目录不存在，跳过"
fi

# ===== JWT 签名密钥 =====
# 没有 JWT_SECRET 时它自动生成并落盘在这里；丢了会导致全体用户登录失效
log "备份 JWT 密钥..."
if docker exec "$CONTAINER" test -f /app/data/.jwt_secret 2>/dev/null; then
  docker cp "$CONTAINER:/app/data/.jwt_secret" "$BACKUP_DIR/.jwt_secret-$TIMESTAMP"
  log "JWT 密钥备份完成"
else
  log "未使用自动生成的 JWT 密钥（.env 里已显式配置），跳过"
fi

# ===== 清理：只留最近 7 天 =====
log "清理旧备份（保留最近7天）..."
cd "$BACKUP_DIR"
find . -maxdepth 1 -name 'teaching-workbench-*.db*' -mtime +7 -delete 2>/dev/null || true
find . -maxdepth 1 -name 'uploads-*.tar.gz' -mtime +7 -delete 2>/dev/null || true
find . -maxdepth 1 -name '.jwt_secret-*' -mtime +7 -delete 2>/dev/null || true

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0B")
DB_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'teaching-workbench-*.db' | wc -l | tr -d ' ')
UPLOAD_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' | wc -l | tr -d ' ')
SECRET_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name '.jwt_secret-*' | wc -l | tr -d ' ')

echo ""
log "========== 备份完成 =========="
log "备份目录: $BACKUP_DIR"
log "数据库: $DB_COUNT 个 | 上传文件: $UPLOAD_COUNT 个 | JWT 密钥: $SECRET_COUNT 个 | 总大小: $TOTAL_SIZE"
