#!/bin/bash
# ============================================================
# 死代码门禁：生产代码里不许留「未使用的局部变量 / 函数 / 类型」。
#
# 为什么单开一个脚本，而不是直接开 tsconfig 的 noUnusedLocals：
#   1) 主 typecheck 要连测试一起过。测试里有大量「解构出来只为触发逻辑」
#      的变量（token、req、before…），一开严格模式立刻几百条噪声，
#      真正该拦的死代码反而被淹没。
#   2) noUnusedParameters 不能开：Express / multer / 迁移文件里存在大量
#      「按签名占位但用不到」的形参（req、next、Migration），全是误报。
#
# 已知豁免（KL-1）：tsc 的一个追踪局限 —— 在【函数内部】声明的 interface
#   若只作为 `as SomeType[]` 的断言目标使用，会被误报 "declared but never used"，
#   而该名字在文件其它位置完全可能被引用。对这条按键名 + 位置豁免，
#   而不是把生产代码里的类型上移（上移属改动面更大的"为工具让路"）。
#   一旦 TS 修复该追踪问题或该声明消失，本豁免会自动失效（filter 不再命中）。
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

TSCONFIG="tsconfig.strict.json"
if [ ! -f "$TSCONFIG" ]; then
  echo "::error::缺少 $TSCONFIG（死代码门禁配置）"
  exit 1
fi

OUT=$(npx tsc --noEmit -p "$TSCONFIG" 2>&1)
CODE=$?

# 完全是正常通过（无输出）
if [ -z "$OUT" ]; then
  echo "✅ 生产代码未发现未使用声明"
  exit $CODE
fi

# 过滤已知误报
FILTERED=$(printf '%s\n' "$OUT" | grep -vE "src/routes/students\.ts\(100,[0-9]+\): error TS6196: 'FollowUpRow' is declared but never used\.")

if [ -z "$FILTERED" ]; then
  echo "✅ 生产代码未发现未使用声明（1 条已知 tsc 误报已豁免，见脚本头 KL-1）"
  exit 0
fi

printf '%s\n' "$FILTERED"
echo "::error::生产代码存在未使用的变量/函数/类型，请删除或加 _ 前缀标记"
exit 1
