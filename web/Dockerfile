# ========== Stage 1: Build ==========
FROM node:26-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# shared 模块由 CI 预拷贝（docker-publish.yml 在构建前 cp -r shared web/src/shared）；
# 本地构建依赖仓库里已跟踪的 web/src/shared 副本。此前的 `cp -r ../shared || true` 
# 在 build context=web 下永远失败，是掩盖配置漂移的死代码，已删。
RUN npm run build

# ========== Stage 2: Serve ==========
FROM nginx:alpine

# 清理默认配置
RUN rm -rf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 复制 nginx 配置（与安全头 snippet 一起，后者被 nginx.conf include）
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

# 注意：nginx 官方镜像的 master 进程仍以 root 启动（需要绑 80 端口），
# 仅 worker 是非 root —— 并不是完全非 root 运行。要彻底非 root 需换 nginx-unprivileged。
# 暴露端口
EXPOSE 80

# 健康检查探【容器内静态端点】：/health 会反代到后端，后端挂掉会把"前端明明还能
# 服务静态页"误判成 unhealthy。显式使用 IPv4，排除 localhost 的 IPv6 解析歧义。
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 -T 3 --spider http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
