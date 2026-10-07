# 1对1老师教学服务工作台

一个面向1对1教师的教育服务管理平台，支持学生信息管理、课后回访AI生成等功能。

## 功能特性

### 1. 用户认证
- 注册/登录系统，JWT Token 鉴权
- 默认管理员账号: admin / 123456

### 2. 学生管理系统
- 学生信息增删改查、按姓名/年级/学科搜索
- 字段：姓名、年级、学科、联系电话、备注

### 3. 课后回访模块（核心）
- 课堂信息录入：学生姓名、年级、学科、课程主题、课堂表现、掌握程度
- 图片上传：支持 Ctrl+V 粘贴截图 / 文件选择上传 / 拖拽上传
- AI 智能生成：接入商汤 SenseNova 多模态大模型
- 输出规范：课堂内容、学生收获、课后任务 三段，150-500字
- 可编辑修改、历史记录查询

### 4. 工作台仪表盘
- 学生总数、回访总数、覆盖学科统计
- 近期回访动态、学生概览

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite + TypeScript + TailwindCSS |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| AI | SenseNova sensenova-6.8-flash-lite (OpenAI兼容) |
| 部署 | Docker + Docker Compose + Caddy |
| CI/CD | GitHub Actions + GHCR |

## 项目结构

```
teaching-workbench/
├── server/                        # 后端服务
│   ├── Dockerfile                 # 后端 Docker 配置（多阶段构建）
│   ├── .dockerignore
│   ├── src/
│   │   ├── config/                # 数据库、环境配置
│   │   ├── middleware/            # 认证、错误处理
│   │   ├── routes/                # 认证、学生、回访、上传
│   │   ├── services/              # SenseNova AI 集成
│   │   └── index.ts               # 主入口（含 /health 端点）
│   └── .env                       # 环境配置
├── web/                           # 前端应用
│   ├── Dockerfile                 # 前端 Docker 配置（多阶段构建+nginx）
│   ├── nginx.conf                 # nginx 配置（反向代理API）
│   ├── .dockerignore
│   └── src/
│       ├── api/                   # API 客户端
│       ├── components/            # 公共组件
│       ├── context/               # 认证上下文
│       ├── pages/                 # 登录、工作台、学生、回访
│       └── types/                 # 类型定义
├── .github/workflows/
│   └── docker-publish.yml         # GitHub Actions CI/CD
├── docker-compose.yml             # Docker 编排
├── deploy.sh                      # NAS 一键部署脚本
├── backup.sh                      # 数据备份脚本
├── Caddyfile.example              # Caddy 反向代理配置
├── .env.production.example        # 生产环境变量模板
└── README.md
```

## 本地开发

### 环境要求
- Node.js 18+

### 配置 AI API Key

```bash
cd server
cp .env .env
# 编辑 .env，填入 SENSENOVA_API_KEY
```

### 启动服务

```bash
# 后端
cd server && npm install && npm run dev
# 前端
cd web && npm install && npm run dev
```

访问 http://localhost:5173 ，默认账号 admin / 123456

## NAS Docker 部署

### 前置条件
- NAS 上已安装 Docker + Docker Compose
- NAS 已配置域名并解析到公网IP
- GitHub 仓库已配置（代码已推送）

### 部署步骤

#### 1. 克隆代码到 NAS

```bash
git clone https://github.com/je668/teaching-workbench.git
cd teaching-workbench
```

#### 2. 配置环境变量

```bash
cp .env.production.example .env

# 编辑 .env 文件：
# - JWT_SECRET: openssl rand -hex 32 生成
# - SENSENOVA_API_KEY: 填入你的 SenseNova API Key
# - CORS_ORIGINS: 你的域名
# - DEFAULT_ADMIN_PASS: 修改默认密码
```

#### 3. 首次部署

```bash
# 拉取镜像并启动
./deploy.sh

# 或手动执行:
docker compose pull
docker compose up -d
```

#### 4. 配置 Caddy 反向代理

```bash
# 复制配置
cp Caddyfile.example /etc/caddy/Caddyfile
# 编辑域名后重启 Caddy
caddy reload
```

#### 5. 日常更新

```bash
# 拉取最新镜像并重启
./deploy.sh

# 部署前自动备份
./deploy.sh --backup

# 回滚到上一个版本
./deploy.sh --rollback
```

#### 6. 数据备份

```bash
# 手动备份
./backup.sh

# 建议添加定时任务（每天凌晨3点）
crontab -e
# 添加: 0 3 * * * /path/to/teaching-workbench/backup.sh
```

### GitHub Actions 自动构建

代码推送到 main 分支后，GitHub Actions 会自动：
1. 构建后端 Docker 镜像 → 推送到 GHCR
2. 构建前端 Docker 镜像 → 推送到 GHCR
3. 使用 git SHA 和 latest 双标签，支持精确回滚

镜像地址:
- 后端: ghcr.io/je668/teaching-workbench-backend:latest
- 前端: ghcr.io/je668/teaching-workbench-frontend:latest

### 生产架构

```
Internet → 域名 → Caddy (自动SSL)
                    ↓
              frontend:80 (nginx)
                    ↓
              ┌─────┴─────┐
              │ 静态文件    │ /api/* → backend:3000
              │ React Build│
              └───────────┘
                    
              backend:3000 (Express)
              ├─ /health (健康检查)
              ├─ /api/* (API)
              └─ /uploads/* (图片)
                    
              Volume: db_data
              ├─ teaching.db (SQLite)
              └─ uploads/ (图片)
```

### 备份说明

- 数据库: 每日备份 teaching.db
- 上传文件: 每日备份 uploads/ 目录
- 保留策略: 自动保留最近 7 天备份
- 备份位置: ~/backups/teaching-workbench/

## SenseNova API 说明

- Base URL: https://token.sensenova.cn/v1
- Model: sensenova-6.8-flash-lite
- 图片输入: 支持 Base64 Data URL
- 图片格式: JPG、PNG、WebP
- API Key 获取: https://platform.sensenova.cn
