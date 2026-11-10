#!/bin/bash
# ============================================
# 1对1教学工作台 - 数据备份脚本
# ============================================
# 数据都挂在 DATA_PATH（容器内 /app/data），这里统一从容器里取，
# 避免去猜宿主机路径：宿主机可能跑的是命名卷，也可能是绑定目录。

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-${HOME}/backups/teaching-workbench}"
# restore.sh 会带 BACKUP_PREFIX=pre-restore- 给现状另存一份，与常规备份区分
BACKUP_PREFIX="${BACKUP_PREFIX:-teaching-workbench-}"
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
DB_FILE="$BACKUP_DIR/${BACKUP_PREFIX}$TIMESTAMP.db"
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
  # 回退路径：对运行中的 WAL 库做三件套拷贝不是原子的（三个瞬间），
  # 可能拷出"校验碰巧通过、恢复时才暴雷"的撕裂备份。
  # 先在容器内用 sqlite3 的 .backup 生成一致快照，再拷快照 —— 与在线备份同一语义。
  if docker exec "$CONTAINER" node --input-type=module -e \
    "import Database from 'better-sqlite3';const db=new Database('/app/data/teaching.db',{readonly:true});db.backup('/tmp/tw-fallback.db').then(()=>{db.close();process.exit(0)}).catch(()=>process.exit(1))" \
    < /dev/null 2>/dev/null; then
    docker cp "$CONTAINER:/tmp/tw-fallback.db" "$DB_FILE"
    docker exec "$CONTAINER" rm -f /tmp/tw-fallback.db 2>/dev/null || true
  else
    # 只读 backup 也失败（磁盘满等），才退化到三件套直拷 —— 带醒目告警
    docker cp "$CONTAINER:/app/data/teaching.db" "$DB_FILE"
    docker cp "$CONTAINER:/app/data/teaching.db-wal" "$DB_FILE-wal" 2>/dev/null || true
    docker cp "$CONTAINER:/app/data/teaching.db-shm" "$DB_FILE-shm" 2>/dev/null || true
    warn "回退备份退化为三件套直拷（非原子），恢复前务必人工 integrity_check"
  fi
  warn "在线备份失败，已用容器内 sqlite 快照回退"
else
  warn "数据库不存在或后端容器未运行，跳过"
fi

# ===== 备份件完整性校验 =====
# 备份最怕"文件在、库坏了"，这里用备份出来的文件本身跑 integrity_check。
# 宿主 node 可能没有 sqlite3 模块，故拷回容器内用它的 better-sqlite3 校验。
if [ -f "$DB_FILE" ]; then
  if docker cp "$DB_FILE" "$CONTAINER:/tmp/verify.db" 2>/dev/null; then
    INTEG=$(docker exec "$CONTAINER" node --input-type=module -e \
      "import Database from 'better-sqlite3';const db=new Database('/tmp/verify.db',{readonly:true});console.log(db.pragma('integrity_check',{simple:true}));db.close()" \
      < /dev/null 2>&1 | tail -1)
    docker exec "$CONTAINER" rm -f /tmp/verify.db 2>/dev/null || true
    if [ "$INTEG" = "ok" ]; then
      log "备份件完整性校验通过"
    else
      warn "备份件完整性校验异常（返回: ${INTEG}），请人工检查 $DB_FILE"
    fi
  fi
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
# 同时覆盖常规备份（teaching-workbench-*）与恢复前快照（pre-restore-*）
find . -maxdepth 1 \( -name 'teaching-workbench-*.db*' -o -name 'pre-restore-*.db*' \) -mtime +7 -delete 2>/dev/null || true
# pre-restore 的 uploads/密钥与常规备份共用同一条时间戳命名，一并被下面匹配
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
