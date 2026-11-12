#!/bin/bash
# ============================================================
# 生产产物冒烟测试：用【编译后的 dist + 纯 node】真正启动一次服务，
# 再访问容器 HEALTHCHECK 用的同一个端点 /health。
#
# 为什么需要它（真实事故）：
#   迁移 runner 曾只加载 .ts 文件，于是 `node dist/index.js` 启动时
#   一个迁移都不会执行 —— user_version 恒 0、initDatabase 空转。
#   单测全部用 tsx 跑 .ts，所以 757 条用例全绿，CI 全绿；
#   而容器里跑的是 dist/*.js，一发布就崩：
#     Error: 迁移 20240101000000 失败: require is not defined
#     → backend unhealthy → frontend 因 depends_on 起不来。
#
# 凡是"测试环境与运行环境形态不同"（.ts vs .js、tsx vs node、dev vs prod），
# 就必须用生产形态真跑一次。这个脚本就是那道闸门。
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PORT="${SMOKE_PORT:-38917}"
DATA="$(mktemp -d)"
LOG="$DATA/server.log"
PID=""

cleanup() {
  [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null
  rm -rf "$DATA"
}
trap cleanup EXIT

fail() { echo "::error::$1"; echo "---- 服务日志（末 40 行）----"; tail -40 "$LOG" 2>/dev/null; exit 1; }

echo "==> 编译（tsc -p tsconfig.build.json）"
npm run build >"$LOG" 2>&1 || { echo "::error::编译失败"; tail -30 "$LOG"; exit 1; }

[ -f dist/index.js ] || fail "编译产物 dist/index.js 不存在"

echo "==> 以生产形态启动：node dist/index.js（不是 tsx，不是 src/）"
DATA_DIR="$DATA" NODE_ENV=production PORT="$PORT" HOST=127.0.0.1 \
  JWT_SECRET="smoke-test-secret" DEFAULT_ADMIN_USER="admin" DEFAULT_ADMIN_PASS="smoke-pass-123" \
  node dist/index.js >>"$LOG" 2>&1 &
PID=$!

# 最多等 30s：起得来就尽快过，起不来也别无限挂
for i in $(seq 1 60); do
  if ! kill -0 "$PID" 2>/dev/null; then
    fail "后端进程已退出（启动即崩溃，退出码见日志）"
  fi
  if curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "✅ 生产产物启动成功，/health 可访问（尝试 ${i} 次）"
    break
  fi
  if [ "$i" -eq 60 ]; then
    fail "30s 内 /health 未就绪"
  fi
  sleep 0.5
done

echo "==> 复核：迁移确实在 dist 形态下跑过"
DATA_DIR="$DATA" node --input-type=module -e "
const Database = (await import('better-sqlite3')).default;
const db = new Database(process.env.DATA_DIR + '/teaching.db', { readonly: true });
const v = db.prepare('PRAGMA user_version').get().user_version;
const marks = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r => r.name);
const tables = db.prepare(\"SELECT count(*) AS n FROM sqlite_master WHERE type='table'\").get().n;
db.close();
if (v < 1) { console.error('::error::user_version 仍为 0 —— 迁移没有在 dist 形态下执行'); process.exit(1); }
if (!marks.includes('tz_fix_v1')) { console.error('::error::缺失 tz_fix_v1 留痕'); process.exit(1); }
console.log('user_version=' + v + ' tables=' + tables + ' marks=' + marks.join(','));
" || fail "生产形态下迁移未正确执行"

# 启动期依赖的【文件路径】必须能从 dist 里推出来。
# 这些路径都是用 __dirname 相对推导的（dist/utils -> ../../templates），
# 而 Dockerfile 只 COPY 了部分目录 —— 漏拷 templates 曾经导致线上 Word 导出 500，
# 本地和测试全绿。这里按同样的推导方式逐个断言，把"镜像缺文件"提前到冒烟阶段暴露。
echo "==> 复核：启动期依赖的模板/种子目录可从 dist 定位"
DATA_DIR="$DATA" node --input-type=module -e '
import fs from "fs";
import path from "path";

const docx = await import("./dist/utils/observationDocx.js");
const seed = await import("./dist/seed/builtinCatalog.js");
const envMod = await import("./dist/config/env.js");

let bad = 0;

// ① Word 模板：真的生成一份 docx（模板存在 + 能读 + 能产出，一次全验证）
try {
  const buf = await docx.buildObservationDocx({
    teacher: "冒烟老师", time: "2026-11-12", topic: "冒烟课",
    type: "一对一", evals: ["一", "二", "三", "四", "五", "六", "七", "八"],
    highlight: "亮点", optimize: "待优化", suggest: "建议",
    grade: "good", signature: "冒烟",
  });
  if (!buf || buf.length < 1000) throw new Error("产出过小: " + (buf ? buf.length : 0));
  console.log("ok    Word 模板可渲染，产出 " + buf.length + " bytes");
} catch (e) {
  console.error("::error::Word 模板不可用（templates/ 未进镜像？）：" + e.message);
  bad++;
}

// ② 内置课程目录：目录存在且至少有一个 xlsx
const sdir = seed.seedDir();
let xlsxCount = 0;
try {
  xlsxCount = fs.readdirSync(sdir).filter((f) => f.endsWith(".xlsx")).length;
} catch {}
if (xlsxCount === 0) {
  console.error("::error::内置课程目录缺失或为空：" + sdir);
  bad++;
} else {
  console.log("ok    seed/catalog -> " + sdir + "（" + xlsxCount + " 个 xlsx）");
}

// ③ 数据目录：UPLOAD_DIR 的父目录必须可建可写（否则首次启动写库失败）
const uploads = envMod.env.UPLOAD_DIR;
const dataParent = path.dirname(uploads);
try {
  fs.mkdirSync(dataParent, { recursive: true });
  fs.accessSync(dataParent, fs.constants.W_OK);
  console.log("ok    DATA_DIR 可写 -> " + dataParent);
} catch (e) {
  console.error("::error::DATA_DIR 不可写：" + dataParent + "（" + e.message + "）");
  bad++;
}

process.exit(bad ? 1 : 0);
' || fail "镜像缺少启动期必需的文件（templates / seed / data）"

echo "✅ 冒烟通过"
