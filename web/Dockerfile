# ========== Stage 1: Build ==========
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ========== Stage 2: Serve ==========
FROM nginx:alpine

# 清理默认配置
RUN rm -rf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 非 root 运行（nginx 官方镜像已支持）
# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
