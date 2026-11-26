#!/usr/bin/env bash
# 构建后、推送前运行真实前端镜像，验证 nginx 配置、80 监听和宿主机端口映射。
set -euo pipefail

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "用法: bash scripts/verify/frontend-container-smoke.sh <frontend-image>" >&2
  exit 64
fi
command -v docker >/dev/null 2>&1 || { echo "需要 Docker 才能执行容器运行时验收" >&2; exit 69; }
command -v curl >/dev/null 2>&1 || { echo "需要 curl 才能验证宿主机端口映射" >&2; exit 69; }

CONTAINER="${FRONTEND_SMOKE_NAME:-tw-frontend-smoke-$$}"
CONTAINER_ID=""
created=false
cleanup() {
  status=$?
  trap - EXIT
  # docker run 失败（尤其是名称冲突）时，容器不属于本次验收，绝不能清理。
  if [ "$created" != true ]; then
    exit "$status"
  fi
  if [ "$status" -ne 0 ]; then
    echo "前端容器运行时验收失败，保留诊断信息后清理本次容器" >&2
    if docker inspect "$CONTAINER_ID" >/dev/null 2>&1; then
      docker inspect "$CONTAINER_ID" --format \
        'image={{.Image}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}} ports={{json .NetworkSettings.Ports}} mounts={{json .Mounts}} health={{json .State.Health}}' >&2 || true
      docker logs --tail=100 "$CONTAINER_ID" >&2 || true
    fi
  fi
  # 按本次返回的容器 ID 清理，避免名称被外部删除并复用后误删新容器。
  docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Smoke 容器名已存在，拒绝覆盖或清理已有容器: $CONTAINER" >&2
  exit 73
fi

# nginx 的 proxy_pass 会在启动时解析 backend。这里仅验收静态服务，用一个明确的
# 本地占位地址满足 DNS；/healthz、index.html 和 SPA 回退都不会访问该地址。
CONTAINER_ID="$(docker run --detach --name "$CONTAINER" \
  --add-host backend:127.0.0.1 \
  --publish 127.0.0.1::80 \
  "$IMAGE")"
created=true

docker exec "$CONTAINER_ID" nginx -t

health="starting"
for _ in {1..30}; do
  running="$(docker inspect "$CONTAINER_ID" --format '{{.State.Running}}')"
  if [ "$running" != "true" ]; then
    echo "nginx 容器已退出" >&2
    exit 1
  fi
  health="$(docker inspect "$CONTAINER_ID" --format '{{.State.Health.Status}}')"
  if [ "$health" = "healthy" ]; then
    break
  fi
  sleep 2
done
if [ "$health" != "healthy" ]; then
  echo "前端健康检查未通过，最后状态: $health" >&2
  exit 1
fi

# 直接验证监听，避免仅凭进程存在就误判服务可用。
docker exec "$CONTAINER_ID" netstat -lnt | awk '$4 ~ /:80$/ { found=1 } END { exit !found }'
docker exec "$CONTAINER_ID" wget --quiet --tries=1 -T 3 --spider http://127.0.0.1:80/healthz

HOST_PORT="$(docker port "$CONTAINER_ID" 80/tcp | awk -F: 'NR == 1 { print $NF }')"
if [ -z "$HOST_PORT" ]; then
  echo "未找到 80/tcp 的宿主机映射端口" >&2
  exit 1
fi
BASE_URL="http://127.0.0.1:${HOST_PORT}"

HEALTHZ_BODY="$(curl --fail --silent --show-error --max-time 5 "${BASE_URL}/healthz")"
if [ "$HEALTHZ_BODY" != "ok" ]; then
  printf '前端健康端点正文错误，期望 ok，实际: %q\n' "$HEALTHZ_BODY" >&2
  exit 1
fi

INDEX_HTML="$(curl --fail --silent --show-error --max-time 5 "${BASE_URL}/index.html")"
if [ -z "${INDEX_HTML//[[:space:]]/}" ]; then
  echo "前端入口 index.html 为空" >&2
  exit 1
fi
case "$INDEX_HTML" in
  *'id="root"'*|*"id='root'"*|*" id=root"*) ;;
  *)
    echo "前端入口 index.html 缺少 id=root 挂载点" >&2
    exit 1
    ;;
esac
curl --fail --silent --show-error --max-time 5 "${BASE_URL}/spa-smoke-route" >/dev/null

# 只接受入口直接引用的本地 Vite 哈希 JS/CSS，并校验响应类型与大小；
# 否则缺失资源会被 try_files 回退成 index.html，curl --fail 仍误报成功。
ASSET_PATH="$(
  printf '%s\n' "$INDEX_HTML" | awk '
    match($0, /(src|href)="\/assets\/[^"]+-[A-Za-z0-9_-]{6,}\.(js|css)"/) {
      asset = substr($0, RSTART, RLENGTH)
      sub(/^(src|href)="/, "", asset)
      sub(/"$/, "", asset)
      print asset
      exit
    }'
)"
if [ -z "$ASSET_PATH" ]; then
  echo "前端入口未引用本地哈希 JS/CSS 资源" >&2
  exit 1
fi
ASSET_METADATA="$(
  curl --fail --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{content_type} %{size_download}' \
    "${BASE_URL}${ASSET_PATH}"
)"
ASSET_TYPE="${ASSET_METADATA% *}"
ASSET_SIZE="${ASSET_METADATA##* }"
case "$ASSET_SIZE" in
  '' | *[!0-9]*)
    echo "无法解析静态资源响应大小: $ASSET_METADATA" >&2
    exit 1
    ;;
esac
if [ "$ASSET_SIZE" -eq 0 ]; then
  echo "入口引用的静态资源为空: $ASSET_PATH" >&2
  exit 1
fi
case "$ASSET_PATH:$ASSET_TYPE" in
  *.js:application/javascript* | *.js:text/javascript* | *.css:text/css*) ;;
  *)
    echo "静态资源响应类型错误（可能被 SPA 回退替代）: $ASSET_PATH -> $ASSET_TYPE" >&2
    exit 1
    ;;
esac

echo "✅ 前端镜像验收通过：容器 ownership、nginx -t、80 监听、healthy、健康正文、入口挂载点、哈希资源、宿主机映射与 SPA 回退"
