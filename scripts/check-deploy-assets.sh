#!/bin/bash
# ============================================
# 部署资产静态守护（CI 与本地共用）
# ============================================
# 从 workflow 内联脚本提取而来：本地改了 Dockerfile / compose / 模板后，
# push 前先跑一遍，不用等 CI 红才知道。
#
# 覆盖的事故复盘：
# 1. Dockerfile 曾只 COPY dist/ 漏了 templates/ —— 测试全绿，只有线上
#    容器 ENOENT、Word 导出 500。
# 2. 容器默认时区 UTC 曾导致整库时间戳慢 8 小时。
# 3. .dockerignore 误排除模板 —— 构建照样成功，镜像里却没有文件。
# 4. shared/ 三处副本各自漂移（模板被单端改坏）。

set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "::error::$1" >&2; exit 1; }

# ===== 1. Word 模板必须打进生产镜像 =====
test -f server/templates/observation-template.docx \
  || fail "缺少 Word 模板文件 server/templates/observation-template.docx"

grep -q 'COPY --from=build /app/templates ./templates' server/Dockerfile \
  || fail "server/Dockerfile 未 COPY templates/ —— 生产镜像缺失 Word 模板，导出会 500"

for f in server/templates/*; do
  n="${f##*/}"
  case "$(cat server/.dockerignore 2>/dev/null || true)" in
    *"templates"*|*"$n"*)
      fail ".dockerignore 排除了 $n（生产镜像将缺失该文件）" ;;
  esac
done
echo "✅ 模板文件已纳入生产镜像"

# ===== 2. SQLite 时间戳必须是北京墙钟 =====
# 唯一例外是 timezone-migration.test.ts —— 它的用例就是在造 UTC 偏差数据。
BAD=$(grep -rn "datetime('now'" server/src --include='*.ts' \
      | grep -v '8 hours' \
      | grep -v 'tests/timezone-migration.test.ts' \
      | grep -vE '^[^:]+:[0-9]+:[[:space:]]*[*//]' || true)
if [ -n "$BAD" ]; then
  echo "::error::发现未带 +8 hours 的 SQLite 时间戳（容器默认 UTC，会慢 8 小时）："
  echo "$BAD"
  exit 1
fi
grep -q "TZ=Asia/Shanghai" server/Dockerfile \
  || fail "server/Dockerfile 缺 ENV TZ=Asia/Shanghai"
grep -q "TZ=Asia/Shanghai" docker-compose.yml \
  || fail "docker-compose.yml 缺 TZ=Asia/Shanghai"
echo "✅ 时区守护通过"

# ===== 3. compose 里声明的每个变量，示例 .env 必须齐全 =====
# 事故：.env.production.example 里写了三个没人消费的 GEMINI_PROXY_* 变量，
# 排查「gemini 一直 401」时被示例文件带偏。示例与实际消费面必须对得上。
MISSING=""
for v in $(grep -oE '\$\{[A-Z_]+' docker-compose.yml | cut -d'{' -f2 | sort -u); do
  grep -qE "^${v}(=|:)" .env.production.example || MISSING="$MISSING $v"
done
[ -z "$MISSING" ] || fail "docker-compose.yml 用到的变量在 .env.production.example 缺失:$MISSING"
echo "✅ .env.production.example 覆盖 compose 全部变量"

# ===== 4. package.json 必须声明 Node 版本下限 =====
for f in server/package.json web/package.json; do
  grep -q '"engines"' "$f" || fail "$f 缺 engines 字段"
  grep -q '"node":' "$f" || fail "$f 的 engines 缺 node"
done
echo "✅ engines 声明齐全"

# ===== 5. shared 三处副本必须一致 =====
# 根目录 shared/ 是唯一事实源；CI 的 cp -r shared 会盖副本，本地副本漂移
# 意味着「本地测的和 CI 跑的不是同一份模板」。
for f in promptTemplates.ts reportTemplate.ts; do
  diff -q "shared/$f" "server/src/shared/$f" \
    || fail "server/src/shared/$f 与根目录 shared/$f 不一致（根目录才是事实源，请同步后提交）"
  diff -q "shared/$f" "web/src/shared/$f" \
    || fail "web/src/shared/$f 与根目录 shared/$f 不一致（根目录才是事实源，请同步后提交）"
done
echo "✅ shared 副本一致"

echo "✅ 部署资产守护全部通过"
