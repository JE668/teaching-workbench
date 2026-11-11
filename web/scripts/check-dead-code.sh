#!/bin/bash
# ============================================================
# Web 死代码门禁：生产代码里不许留「未使用的局部变量 / 函数 / 类型」。
#
# 与 server/scripts/check-dead-code.sh 同一套思路，两端口径一致：
#   - 只开 noUnusedLocals（局部未使用），不开 noUnusedParameters
#     （React 组件形参、事件回调 (e) 之类按签名占位，开了全是误报）；
#   - 测试文件不纳入：测试里常有「解构出来只为触发逻辑」的写法。
#
# 历史背景：web 侧一度有 39 条未使用声明，其中
#   Reports.tsx 的两个 generatingXxxIds 状态 —— state 用来渲染"生成中"
#   禁用态与转圈图标，但对应 setter 从头到尾没人调用，等于那两个加载态
#   永远不会出现（UI 上的死逻辑）。靠这个检查一次性暴露出来的。
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

if [ -z "$OUT" ]; then
  echo "✅ 前端生产代码未发现未使用声明"
  exit $CODE
fi

echo "$OUT"
echo "::error::前端生产代码存在未使用的变量/函数/类型，请删除"
exit 1
