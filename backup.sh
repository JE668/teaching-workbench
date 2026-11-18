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

# ===== 数据库备份（teaching.db + bi.db）=====
# 服务开着时库是 WAL 模式，只拷 .db 会丢掉 -wal 里尚未合并的写入。
# 首选 better-sqlite3 的在线备份（会正确读完 WAL）；失败才退化成三件套一起拷。
# bi.db（BI 报表数据底座）与 teaching.db 同目录，一并备份，否则报表上传/指标配置全丢。
backup_one_db() {
  local src_name="$1"           # 容器内文件名，如 teaching.db / bi.db
  local dst_file="$2"           # 宿主目标路径
  local tmp_name="tw-backup-$src_name"

  # 注意 --input-type=module：容器里 /app 的 package.json 是 type:module，
  # 静态 import 写法最稳，不用猜 CJS/ESM 的导出形状。
  local BACKUP_NODE="import Database from 'better-sqlite3';const db=new Database('/app/data/${src_name}');db.backup('/tmp/${tmp_name}').then(()=>{console.log('backup-ok');db.close()}).catch(e=>{console.error(e&&e.message||e);process.exit(1)})"
  local online_ok=false
  if docker exec -i "$CONTAINER" node --input-type=module -e "$BACKUP_NODE" < /dev/null >/dev/null 2>&1; then
    if docker cp "$CONTAINER:/tmp/${tmp_name}" "$dst_file" 2>/dev/null; then
      online_ok=true
    fi
  fi
  docker exec "$CONTAINER" rm -f "/tmp/${tmp_name}" 2>/dev/null || true

  if [ "$online_ok" = true ]; then
    log "${src_name} 备份完成（WAL 安全）"
    return 0
  fi

  if ! docker exec "$CONTAINER" test -f "/app/data/${src_name}" 2>/dev/null; then
    warn "${src_name} 不存在或后端容器未运行，跳过"
    return 1
  fi

  # 回退路径：对运行中的 WAL 库做三件套拷贝不是原子的（三个瞬间），
  # 可能拷出"校验碰巧通过、恢复时才暴雷"的撕裂备份。
  # 先在容器内用 sqlite3 的 .backup 生成一致快照，再拷快照 —— 与在线备份同一语义。
  local fb_name="tw-fallback-$src_name"
  if docker exec "$CONTAINER" node --input-type=module -e \
    "import Database from 'better-sqlite3';const db=new Database('/app/data/${src_name}',{readonly:true});db.backup('/tmp/${fb_name}').then(()=>{db.close();process.exit(0)}).catch(()=>process.exit(1))" \
    < /dev/null 2>/dev/null; then
    docker cp "$CONTAINER:/tmp/${fb_name}" "$dst_file"
    docker exec "$CONTAINER" rm -f "/tmp/${fb_name}" 2>/dev/null || true
    warn "在线备份失败，${src_name} 已用容器内 sqlite 快照回退"
    return 0
  fi

  # 只读 backup 也失败（磁盘满等），才退化到三件套直拷 —— 带醒目告警
  docker cp "$CONTAINER:/app/data/${src_name}" "$dst_file"
  docker cp "$CONTAINER:/app/data/${src_name}-wal" "$dst_file-wal" 2>/dev/null || true
  docker cp "$CONTAINER:/app/data/${src_name}-shm" "$dst_file-shm" 2>/dev/null || true
  warn "${src_name} 回退备份退化为三件套直拷（非原子），恢复前务必人工 integrity_check"
}

# 备份件完整性校验：用备份出来的文件本身跑 integrity_check。
# 宿主 node 可能没有 sqlite3 模块，故拷回容器内用它的 better-sqlite3 校验。
verify_one_db() {
  local db_file="$1"
  [ -f "$db_file" ] || return 0
  if ! docker cp "$db_file" "$CONTAINER:/tmp/tw-verify.db" 2>/dev/null; then
    warn "无法把 $db_file 拷回容器校验"
    return 0
  fi
  local integ
  integ=$(docker exec "$CONTAINER" node --input-type=module -e \
    "import Database from 'better-sqlite3';const db=new Database('/tmp/tw-verify.db',{readonly:true});console.log(db.pragma('integrity_check',{simple:true}));db.close()" \
    < /dev/null 2>&1 | tail -1)
  docker exec "$CONTAINER" rm -f /tmp/tw-verify.db 2>/dev/null || true
  if [ "$integ" = "ok" ]; then
    log "完整性校验通过：$(basename "$db_file")"
  else
    warn "完整性校验异常（返回: ${integ}），请人工检查 $db_file"
  fi
}

log "备份数据库..."
DB_FILE="$BACKUP_DIR/${BACKUP_PREFIX}$TIMESTAMP.db"
BI_DB_FILE="$BACKUP_DIR/${BACKUP_PREFIX}bi-$TIMESTAMP.db"
backup_one_db "teaching.db" "$DB_FILE" || true
backup_one_db "bi.db" "$BI_DB_FILE" || true

verify_one_db "$DB_FILE"
verify_one_db "$BI_DB_FILE"

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
find . -maxdepth 1 \( -name 'teaching-workbench-*.db*' -o -name 'teaching-workbench-bi-*.db*' -o -name 'pre-restore-*.db*' \) -mtime +7 -delete 2>/dev/null || true
# pre-restore 的 uploads/密钥与常规备份共用同一条时间戳命名，一并被下面匹配
find . -maxdepth 1 -name 'uploads-*.tar.gz' -mtime +7 -delete 2>/dev/null || true
find . -maxdepth 1 -name '.jwt_secret-*' -mtime +7 -delete 2>/dev/null || true

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0B")
DB_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'teaching-workbench-[0-9]*.db' | wc -l | tr -d ' ')
BI_DB_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'teaching-workbench-bi-*.db' | wc -l | tr -d ' ')
UPLOAD_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' | wc -l | tr -d ' ')
SECRET_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name '.jwt_secret-*' | wc -l | tr -d ' ')

echo ""
log "========== 备份完成 =========="
log "备份目录: $BACKUP_DIR"
log "主库: $DB_COUNT 个 | BI 库: $BI_DB_COUNT 个 | 上传文件: $UPLOAD_COUNT 个 | JWT 密钥: $SECRET_COUNT 个 | 总大小: $TOTAL_SIZE"
