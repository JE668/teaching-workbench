#!/bin/bash
# ============================================================
# 部署脚本验证（不需要 docker，可直接在开发机 / 测试机跑）
#
# 背景：deploy.sh / backup.sh / restore.sh / install-backup-cron.sh
# 的修复此前只过了 `bash -n`，没有真机执行。本脚本把其中【不依赖
# docker 的逻辑】抽出来逐条断言，能在本机跑就先跑，先抓住"改错了"。
#
# 需要 docker 才能验证的部分（健康检查退出码、chown 属主、在线备份
# 回退路径）不在本脚本范围，见文末"需在测试机手动执行"清单。
#
# 用法：  bash scripts/verify/verify-deploy-scripts.sh
# 退出码：0 全部通过；1 有失败项
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

assert_eq() { # want got desc
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3（期望 '$1'，实际 '$2'）"; fi
}

# ---------- 1. 语法 ----------
head_ "1. 脚本语法（bash -n）"
for f in deploy.sh backup.sh scripts/restore.sh scripts/install-backup-cron.sh; do
  if bash -n "$f" 2>/dev/null; then ok "$f 语法正确"; else bad "$f 语法错误"; fi
done

# ---------- 2. 弱口令识别 ----------
head_ "2. deploy.sh 弱口令识别（M24）"
RE_WEAK='^DEFAULT_ADMIN_PASS=(123456|password|your-strong-password-here| CHANGE_ME.*)?$'
for v in 123456 password your-strong-password-here "" " CHANGE_ME_x"; do
  if printf 'DEFAULT_ADMIN_PASS=%s\n' "$v" | grep -qE "$RE_WEAK"; then
    ok "弱口令能被识别：'$v'"
  else
    bad "弱口令漏检：'$v'"
  fi
done
for v in "Str0ng-Pass-2026" "1234567"; do
  if printf 'DEFAULT_ADMIN_PASS=%s\n' "$v" | grep -qE "$RE_WEAK"; then
    bad "强口令被误判：'$v'"
  else
    ok "强口令不误判：'$v'"
  fi
done

# ---------- 3. cron 时间格式 ----------
head_ "3. install-backup-cron.sh 时间格式（M28）"
check_time() {
  local v="$1"
  case "$v" in
    [0-1][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) echo VALID ;;
    *) echo INVALID ;;
  esac
}
for okv in 00:00 03:30 23:59 12:05; do
  assert_eq VALID "$(check_time "$okv")" "合法时间 $okv"
done
for badv in 29:30 24:00 03:60 3:30 03:3 ""; do
  assert_eq INVALID "$(check_time "$badv")" "非法时间被拒 '$badv'"
done

# ---------- 4. 数据目录 ----------
head_ "4. .gitignore 覆盖默认部署数据目录（H6）"
# compose 默认 DATA_PATH=./data，敏感文件都在这里
for f in data/teaching.db-wal data/teaching.db-shm data/uploads/x.png data/.jwt_secret web/tsconfig.tsbuildinfo; do
  if git check-ignore -q "$f" 2>/dev/null; then
    ok "已忽略：$f"
  else
    bad "未忽略（会进库）：$f"
  fi
done

# ---------- 5. deploy.sh 关键守卫存在性 ----------
head_ "5. deploy.sh 关键修复仍在（防回退）"
grep -q 'DEPLOY_TAG="${\?TAG\?:-latest}"' deploy.sh 2>/dev/null                  && ok "pull 与 compose 同 TAG" || bad "pull 未同 TAG"
grep -q 'docker pull "\$REGISTRY/\$PROJECT-backend:\$DEPLOY_TAG"' deploy.sh       && ok "pull 使用 DEPLOY_TAG" || bad "pull落后仍用 latest"
grep -qE 'mkdir -p "\$\{DATA_PATH:-\./data\}/uploads"' deploy.sh                  && ok "首部署创建数据目录" || bad "缺 mkdir 数据目录"
grep -q 'FROM node:26' server/Dockerfile                                          && ok "server 基础镜像存在" || bad "server Dockerfile 异常"
grep -q 'http://localhost/index.html' web/Dockerfile                              && ok "前端健康检查探本地静态页" || bad "前端健康检查仍穿透后端"

# ---------- 6. backup.sh 快照语义 ----------
head_ "6. backup.sh 回退路径（M25 校正后的语义）"
grep -q 'db.backup(' backup.sh                               && ok "先尝试容器内一致快照 .backup()" || bad "缺少一致快照尝试"
grep -qE '三件套直拷|非原子' backup.sh                        && ok "退化路径有醒目告警" || bad "三件套直拷缺少告警"
grep -q 'integrity_check' backup.sh                          && ok "备份后完整性校验" || bad "缺完整性校验"

# ---------- 7. restore.sh 以 root 修属主 ----------
head_ "7. restore.sh 恢复属主（M26）"
grep -q 'docker exec -u 0 "\$CONTAINER"' scripts/restore.sh  && ok "chown 以 root 执行" || bad "chown 仍以非 root 执行"
grep -q 'PUID:-1001' scripts/restore.sh                       && ok "属主落到 PUID" || bad "属主未落到 PUID"

printf '\n\033[1m========== 结果 ==========\033[0m\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo -e '\033[31m有失败项，请先修复再部署\033[0m'
  exit 1
fi
echo -e '\033[32m全部通过\033[0m'

cat << 'NOTE'

需在有 docker 的测试机上手动执行（本脚本不覆盖）：
  1) bash deploy.sh                     → 确认全新主机上数据目录可写、容器健康
  2) 故意让健康检查失败（如 TAG 指向不存在的镜像）后重跑
                                        → 确认退出码非 0（echo $?），cron/CI 才会告警
  3) bash backup.sh                     → 确认产出 zip/db，且 integrity_check 通过
  4) bash scripts/restore.sh <备份>     → 确认恢复后后端能正常写库（属主正确）
  5) bash scripts/install-backup-cron.sh 03:30 && crontab -l
                                        → 确认时间格式非法时被拒、合法时写入正确
NOTE
