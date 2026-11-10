#!/bin/bash
# ============================================
# 1对1教学工作台 - 数据恢复脚本（backup.sh 的逆操作）
# ============================================
# 用法:
#   bash scripts/restore.sh                      # 用最新一次备份恢复
#   bash scripts/restore.sh 20261101-033000      # 用指定时间戳恢复
#   bash scripts/restore.sh --list               # 列出可用备份
#
# 说明：恢复会覆盖当前数据库与上传文件，执行前会先把现状存一份
#       pre-restore 备份，所以误操作也能退回来。
# ============================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-${HOME}/backups/teaching-workbench}"
PROJECT="teaching-workbench"
CONTAINER="${PROJECT}-backend"
STAMP_RE='^[0-9]{8}-[0-9]{6}$'

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${GREEN}[RESTORE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ===== 列出备份（只读操作，不需要容器在跑）=====
if [ "${1:-}" = "--list" ]; then
  log "可用数据库备份（${BACKUP_DIR}）:"
  ls -1 "$BACKUP_DIR"/teaching-workbench-*.db 2>/dev/null \
    | sed -E "s|.*teaching-workbench-([0-9]{8}-[0-9]{6})\.db|\1|" || { warn "没有找到备份"; exit 0; }
  exit 0
fi

docker inspect "$CONTAINER" >/dev/null 2>&1 || error "后端容器 $CONTAINER 不存在，请先 docker compose up -d"

# ===== 选定时间戳 =====
if [ -n "${1:-}" ]; then
  [[ "$1" =~ $STAMP_RE ]] || error "时间戳格式应为 YYYYmmdd-HHMMSS，或用 --list 查看"
  STAMP="$1"
else
  STAMP=$(ls -1 "$BACKUP_DIR"/teaching-workbench-*.db 2>/dev/null \
    | sed -E "s|.*teaching-workbench-([0-9]{8}-[0-9]{6})\.db|\1|" | tail -1 || true)
  [ -n "$STAMP" ] || error "备份目录里没有找到数据库备份：$BACKUP_DIR"
  warn "未指定时间戳，使用最新备份: $STAMP"
fi

DB_FILE="$BACKUP_DIR/teaching-workbench-$STAMP.db"
[ -f "$DB_FILE" ] || error "备份不存在: $DB_FILE"

# ===== 先给现状留一份退路 =====
log "恢复前先备份当前数据..."
cd "$(dirname "$0")/.."
BACKUP_DIR="$BACKUP_DIR" BACKUP_PREFIX="pre-restore-" ./backup.sh >/dev/null 2>&1 || warn "现状备份失败（继续恢复，但失去退路）"

# ===== 停服务再写文件，避免 SQLite 句柄与写入冲突 =====
log "停止后端服务..."
docker compose stop backend || error "停止后端失败"

cleanup_tmp() { docker exec "$CONTAINER" rm -f /tmp/restore.db 2>/dev/null || true; }
trap cleanup_tmp EXIT

log "写入数据库..."
docker cp "$DB_FILE" "$CONTAINER:/tmp/restore.db"
# WAL/SHM 若随备份存在则一并放回，三件套必须同目录同名
docker cp "$DB_FILE-wal" "$CONTAINER:/app/data/teaching.db-wal" 2>/dev/null || true
docker cp "$DB_FILE-shm" "$CONTAINER:/app/data/teaching.db-shm" 2>/dev/null || true
# chown 必须以 root 执行：镜像默认 USER 是非 root 的 nodejs(1001)，
# 非 root 进程 chown 别人的文件必然失败且被 || true 吞掉 —— 恢复后写库 EACCES。
# 显式 -u 0 跑 chown，属主落对后端 compose 里 user 指定的任意 UID 都可读，
# 再把属主交给 PUID（默认 1001）。
docker exec -u 0 "$CONTAINER" sh -c '
  mv /tmp/restore.db /app/data/teaching.db &&
  rm -f /app/data/teaching.db-wal.tmp /app/data/teaching.db-shm.tmp 2>/dev/null;
  chown "${PUID:-1001}:${PGID:-1001}" /app/data/teaching.db ||
    chown nodejs:nodejs /app/data/teaching.db 2>/dev/null || true'
docker exec -u 0 "$CONTAINER" sh -c 'test -w /app/data/teaching.db || chmod 664 /app/data/teaching.db' 2>/dev/null || true

# 完整性校验：integrity_check 通过才认为这份库能用
log "校验数据库完整性..."
INTEG=$(docker exec "$CONTAINER" node --input-type=module -e \
  "import Database from 'better-sqlite3';const db=new Database('/app/data/teaching.db',{readonly:true});console.log(db.pragma('integrity_check',{simple:true}));db.close()" \
  < /dev/null 2>&1 | tail -1)
[ "$INTEG" = "ok" ] || error "数据库完整性校验失败（返回: ${INTEG}），请停止并人工检查 $DB_FILE"
log "完整性校验通过"

# ===== 上传文件 =====
UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
if [ -f "$UPLOADS_FILE" ]; then
  log "恢复上传文件..."
  docker cp "$UPLOADS_FILE" "$CONTAINER:/tmp/uploads.tar.gz"
  docker exec "$CONTAINER" sh -c '
    rm -rf /app/data/uploads.bak &&
    (mv /app/data/uploads /app/data/uploads.bak 2>/dev/null || true) &&
    tar -xzf /tmp/uploads.tar.gz -C /app/data &&
    rm -f /tmp/uploads.tar.gz'
  log "上传文件已恢复（旧文件留在 uploads.bak，确认无误后可删）"
else
  warn "该时间戳没有上传文件备份，跳过"
fi

# ===== JWT 密钥 =====
SECRET_FILE="$BACKUP_DIR/.jwt_secret-$STAMP"
if [ -f "$SECRET_FILE" ] && ! grep -qE '^JWT_SECRET=.+' .env 2>/dev/null; then
  log "恢复 JWT 密钥（.env 未显式配置时才需要）..."
  docker cp "$SECRET_FILE" "$CONTAINER:/app/data/.jwt_secret"
  docker exec "$CONTAINER" sh -c 'chmod 600 /app/data/.jwt_secret' 2>/dev/null || true
fi

log "重启后端服务..."
docker compose up -d backend || error "启动后端失败"

echo ""
log "========== 恢复完成 =========="
log "数据库: teaching-workbench-$STAMP.db"
warn "请打开页面确认数据正确；确认后可删除 uploads.bak"
