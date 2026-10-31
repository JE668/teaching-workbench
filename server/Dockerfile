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
# 复制 shared 模块到 src/shared，供 TypeScript 导入解析
RUN cp -r ../shared ./src/shared 2>/dev/null || true
RUN npm run build

# 移除 devDependencies，但保留 build 阶段编译出的 better-sqlite3.node，
# 供生产阶段直接复用 —— 生产阶段没有 Python/make/g++，无法二次编译。
RUN npm prune --omit=dev

# ========== Stage 2: Production ==========
FROM node:26-bookworm-slim AS production
WORKDIR /app

# 安装系统依赖（运行时必需）
# tzdata 不能省：SQLite 的 datetime('now',...) 依赖容器时区，
# 不设 TZ 时容器默认是 UTC，所有时间戳会比北京时间慢 8 小时。
# 代码里已改用显式 '+8 hours' 兜底，这里设 TZ 是双保险。
RUN apt-get update && apt-get install -y --no-install-recommends     wget tzdata     && ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime     && echo 'Asia/Shanghai' > /etc/timezone     && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai

# 构建时传入的 git 提交号（见 .github/workflows 的 build-args）。
# 镜像里带上它，线上出问题时 `docker exec <容器> printenv BUILD_SHA` 就能对上代码版本，
# 不用再猜「我到底部署的是哪一版」——本地跑没有这个变量，返回 dev。
ARG BUILD_SHA=dev
ENV BUILD_SHA=${BUILD_SHA}

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
# 内置课程目录（随镜像发版的机构级参考数据），启动时由 seedBuiltInCatalog 灌库。
# 同样必须在 dist 之外单独 COPY，路径口径见 seed/builtinCatalog.ts 的 seedDir()。
COPY --from=build /app/seed ./seed
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
