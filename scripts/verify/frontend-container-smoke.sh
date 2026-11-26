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
cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo "前端容器运行时验收失败，保留诊断信息后清理容器" >&2
    if docker inspect "$CONTAINER" >/dev/null 2>&1; then
      docker inspect "$CONTAINER" --format \
        'image={{.Image}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}} ports={{json .NetworkSettings.Ports}} mounts={{json .Mounts}} health={{json .State.Health}}' >&2 || true
      docker logs --tail=100 "$CONTAINER" >&2 || true
    fi
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# nginx 的 proxy_pass 会在启动时解析 backend。这里仅验收静态服务，用一个明确的
# 本地占位地址满足 DNS；/healthz、index.html 和 SPA 回退都不会访问该地址。
docker run --detach --name "$CONTAINER" \
  --add-host backend:127.0.0.1 \
  --publish 127.0.0.1::80 \
  "$IMAGE" >/dev/null

docker exec "$CONTAINER" nginx -t

health="starting"
for _ in {1..30}; do
  running="$(docker inspect "$CONTAINER" --format '{{.State.Running}}')"
  if [ "$running" != "true" ]; then
    echo "nginx 容器已退出" >&2
    exit 1
  fi
  health="$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}')"
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
docker exec "$CONTAINER" netstat -lnt | awk '$4 ~ /:80$/ { found=1 } END { exit !found }'
docker exec "$CONTAINER" wget --quiet --tries=1 -T 3 --spider http://127.0.0.1:80/healthz

HOST_PORT="$(docker port "$CONTAINER" 80/tcp | awk -F: 'NR == 1 { print $NF }')"
if [ -z "$HOST_PORT" ]; then
  echo "未找到 80/tcp 的宿主机映射端口" >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${HOST_PORT}/index.html" >/dev/null
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${HOST_PORT}/spa-smoke-route" >/dev/null

echo "✅ 前端镜像验收通过：nginx -t、80 监听、healthy、容器内探针、宿主机映射与 SPA 回退"
