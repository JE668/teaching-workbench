# ========== Stage 1: Build ==========
FROM node:26-bookworm-slim AS build
WORKDIR /app

# 安装系统依赖（better-sqlite3 原生模块需要）
RUN apt-get update && apt-get install -y --no-install-recommends     python3     make     g++     && rm -rf /var/lib/apt/lists/*

# 安装所有依赖（含 devDependencies 用于编译）
COPY package*.json ./
RUN npm ci

# 复制源码并编译 TypeScript
COPY . .
RUN npm run build

# 移除 devDependencies，但保留 build 阶段编译出的 better-sqlite3.node，
# 供生产阶段直接复用 —— 生产阶段没有 Python/make/g++，无法二次编译。
RUN npm prune --omit=dev

# ========== Stage 2: Production ==========
FROM node:26-bookworm-slim AS production
WORKDIR /app

# 安装系统依赖（运行时必需）
RUN apt-get update && apt-get install -y --no-install-recommends     wget     && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs     && adduser --system --uid 1001 nodejs

# 仅安装生产依赖
# 直接复用 build 阶段已编译好的依赖，而不是在这里重新 npm ci：
# better-sqlite3@13 已移除 prebuild-install，始终源码编译，
# 而本阶段只有 wget、没有 Python/make/g++，重新安装必然失败。
COPY --from=build /app/node_modules ./node_modules
# 复制编译产物
COPY --from=build /app/dist ./dist
# 听评课 Word 导出依赖的模板。必须在 dist 之外单独 COPY ——
# 漏掉这一步生产环境会 ENOENT，Word 导出直接 500，而本地测试全绿。
COPY --from=build /app/templates ./templates
COPY --from=build /app/package.json ./package.json
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
