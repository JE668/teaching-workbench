#!/usr/bin/env bash
# 把根 shared/ 同步到两个包的 src/shared（单一真源，避免三份副本漂移）。
# 用法：npm run sync:shared 写入；npm run check:shared 只校验（CI 用）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/sync-shared.mjs" "$@"
