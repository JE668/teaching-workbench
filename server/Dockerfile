# ========== Stage 1: Build ==========
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 安装系统依赖（better-sqlite3 原生模块需要）
RUN apt-get update && apt-get install -y --no-install-recommends     python3     make     g++     && rm -rf /var/lib/apt/lists/*

# 安装所有依赖（含 devDependencies 用于编译）
COPY package*.json ./
RUN npm ci

# 复制源码并编译 TypeScript
COPY . .
RUN npm run build

# ========== Stage 2: Production ==========
FROM node:20-bookworm-slim AS production
WORKDIR /app

# 安装系统依赖（运行时必需）
RUN apt-get update && apt-get install -y --no-install-recommends     wget     && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs     && adduser --system --uid 1001 nodejs

# 仅安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev

# 复制编译产物
COPY --from=build /app/dist ./dist
COPY --from=build /app/tsconfig.json ./tsconfig.json

# 创建数据目录
RUN mkdir -p data/uploads && chown -R nodejs:nodejs /app

# 切换到非 root 用户
USER nodejs

# 暴露端口
EXPOSE 3000

# Docker Health Check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 启动命令
CMD ["node", "dist/index.js"]
