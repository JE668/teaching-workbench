#!/bin/bash
# ============================================
# 安装每日自动备份 cron（幂等：重复执行只更新本脚本管理的那一行）
# 用法: bash scripts/install-backup-cron.sh [HH:MM]   默认 03:30
# 卸载: bash scripts/install-backup-cron.sh --remove
# ============================================

set -euo pipefail

MARKER="# teaching-workbench-backup"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DAILY_AT="${1:-03:30}"

if [ "$DAILY_AT" = "--remove" ]; then
  # 走临时文件而非管道 stdin：部分 busybox crontab 不支持 `crontab -`
  TMP=$(mktemp)
  crontab -l 2>/dev/null | grep -v "$MARKER" > "$TMP" || true
  crontab "$TMP" || true
  rm -f "$TMP"
  echo "[OK] 已移除 teaching-workbench 备份 cron"
  exit 0
fi

case "$DAILY_AT" in
  [0-2][0-9]:[0-5][0-9]) MIN="${DAILY_AT#*:}"; HOUR="${DAILY_AT%%:*}" ;;
  *) echo "[ERROR] 时间格式应为 HH:MM，例如 03:30"; exit 1 ;;
esac
# cron 字段不能有前导零歧义（08/09 会被当八进制），转成十进制
HOUR=$((10#$HOUR)); MIN=$((10#$MIN))

LINE="$MIN $HOUR * * * cd $PROJECT_DIR && ./backup.sh >> $PROJECT_DIR/data/backup.log 2>&1 $MARKER"

# 只替换 marker 行，保留用户其它 crontab 条目
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v "$MARKER" > "$TMP" || true
echo "$LINE" >> "$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "[OK] 已安装每日备份 cron: ${DAILY_AT}（$PROJECT_DIR/backup.sh）"
echo "     日志: $PROJECT_DIR/data/backup.log   备份目录: \${BACKUP_DIR:-\$HOME/backups/teaching-workbench}"
echo "     卸载: bash scripts/install-backup-cron.sh --remove"
