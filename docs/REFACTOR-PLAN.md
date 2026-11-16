# 重构与加固计划

> 依据：2026-11-16 的全项目审查（报告见对话记录）。
> 分支：`refactor/audit-fixes`。原则：**小步提交、每批跑基线**，宁可少改一个文件，不引入回归。

## 基线（改动前实测）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端单测 | `cd server && npm test` | 55 文件 / 757 用例全过（~8.7s） |
| 前端单测 | `cd web && npx vitest run` | 34 文件 / 440 用例全过（~4.5s） |
| 类型检查 | `cd web && npx tsc --noEmit` | 通过 |
| 后端构建 | `cd server && npm run build` | 通过 |
| E2E | `cd web && npx playwright test` | 17 spec（需 Chrome，按需跑） |

**每批完成后必须全绿**，用例数不得减少（新增用例只加不减）。

---

## 批次 1 · 安全（P0）

- [x] 1.1 `server/src/utils/outboundUrl.ts`：出站 URL 白名单校验
  - 只允许 http/https；禁止 URL 内嵌凭据（`user:pass@`）
  - 解析主机名后拒绝回环 / 私网 / 链路本地 / 保留段 / IPv4-mapped IPv6
  - **元数据地址永远拒绝**（169.254.0.0/16、100.100.100.200、fd00:ec2::254、metadata.google.internal）
  - 生产环境默认拒绝私网与回环；确实要连内网自建网关（Ollama 等）时显式 `AI_BASEURL_ALLOW_PRIVATE=1`
  - 提供同步版（字面量 IP，供构造 SDK 客户端时兜底存量脏数据）与异步版（含 DNS 解析）
- [x] 1.2 接入点
  - `server/src/routes/settings.ts` PUT：`ai.baseUrl` / `ai.geminiProxy.baseUrl` 改为异步校验（含 DNS），错误回 400 明确文案
  - `server/src/routes/settings.ts` 的 `fetch(baseUrl + '/models')`：请求前再校验一次 + `redirect: 'manual'`（防 302 跳内网）
  - `server/src/services/ai/client.ts`：构造 OpenAI 客户端前同步校验存量值
- [x] 1.3 后端安全响应头（不引新依赖，手写中间件）：nosniff / X-Frame-Options / Referrer-Policy / 去掉 `X-Powered-By`
- [x] 1.4 nginx CSP 从 Report-Only 转强制（先核对无内联脚本、无外部 CDN，已确认）
- [x] 1.5 bcrypt 同步调用改异步（`auth.ts` 4 处），避免登录高峰阻塞事件循环
- [x] 1.6 `CORS_ORIGINS` 默认值改为空（同源），与注释一致
- [x] 1.7 新增 `server/src/tests/outbound-url.test.ts`：私网/元数据/协议/凭据/DNS 各一组用例

## 批次 2 · 性能（P1）

- [x] 2.1 `server/src/routes/reports.ts`：事务内 `db.prepare` 提到事务外（三处：插入 report_items、reorder、删除）
- [x] 2.2 听评课列表分页
  - 后端 `server/src/routes/observations.ts`：`page`/`pageSize`（默认 20、上限 100，照抄 followups.read.ts 的返回形状），返回 `total`/`totalPages`；兼容不传参数的老行为（返回首页）
  - 前端 `web/src/pages/Observations.tsx`：`加载更多` 追加、筛选切换重置、空态判断用 total
  - 补测试：server/src/tests/observations-pagination.test.ts（8 用例：边界、越界、筛选组合、用户隔离）
- [x] 2.3 `server/src/routes/catalogList.ts`：limit 上限 20000 → 5000（实测两套内置目录共约 3.5k 行，5000 足够；超过就该做真分页）；`web/src/pages/Catalog.tsx` 去掉 `?limit=20000`，改成 `rows < total` 时提示「仅加载前 N 条」；Excel 全量导出接口未动
- [x] 2.4 observations 排序索引：加 `(user_id, observed_at DESC, id DESC)` 覆盖常用排序（`date()` 函数列无法走索引，SQL 侧改为范围条件）

## 批次 3 · 体验与运维（P2）

- [x] 3.1 AI 并发闸门按用户分桶（全站上限保留），排队时给前端明确提示
- [x] 3.2 docker-compose 增加 `mem_limit`/`cpus`/`stop_grace_period`；nginx 安全头抽 snippet 去重
- [x] 3.3 前端生产 `console.*` 清理（4 处）
- [x] 3.4 README 修正：上传上限 40MB、React 19、测试用例数（用脚本核对而非手写）
- [x] 3.5 上传体积前端兜底：`web/src/lib/image.ts` 导出 MAX_UPLOAD_BYTES = 40MB（与后端 multer 上限一致），`useImageUpload` 超限文件直接跳过并提示文件名，不再等传完 40MB 才被拒；>1.5MB 自动压到长边 2000px 的既有逻辑保留

## 批次 4 · 可维护性（P3）

- [x] 4.1 `shared/` 三份副本改为单一真源：新增 `scripts/sync-shared.mjs` + `scripts/sync-shared.sh`（npm run sync:shared / check:shared），CI 与 check-deploy-assets.sh 第 5 段做 diff 校验，漂移即失败；另加根 `package.json`（只放跨包脚本，无依赖，不做 workspace）
- [ ] 4.2 (延后) zod schema 下沉 `shared/`，前端 `api.get/post` 统一 parse（先覆盖设置、听评课两个模块）
- [ ] 4.3 (延后) `ReportEdit.tsx` / `FollowUp.tsx` 抽数据 hook（`useReportEditor`/`useFollowUpDraft`），视图不动
- [x] 4.4 抽 `preferenceService`，去掉 `routes/observations.ts` 反向 import `routes/auth.ts`
- [x] 4.5 事件总线改 typed command registry —— 顺带修掉真实缺陷：`App.tsx` 里 10 个「当前页」命令原本全是 window.dispatchEvent(new CustomEvent('app:xxx'))，而全仓库没有任何一处 addEventListener，也就是命令面板的保存/生成/复制/导出和 ⌘S、⌘Enter 全是静默无反应。现统一走 `web/src/lib/appEvents.ts`（命令名集中登记）+ `web/src/hooks/useAppCommand.ts`（页面订阅），`web/src/lib/appEvents.test.ts` 做静态守卫：每条命令必须有人派发且有人订阅，源码里不许再出现裸 app: 字面量
- [x] 4.6 schema 单一真源 + 版本表：核查确认已有机制 —— `server/src/migrations/runner.ts` 用 PRAGMA user_version 记序号（时间戳超 int32，故不直接存），`schema_migrations` 表在 `server/src/config/database.ts:132` 创建，4 个迁移文件齐全，无需新造表

## 批次 5 · 升级（P4）

- [x] 5.1 `.nvmrc` + `engines` 收紧（`>=22.12 <27`），CI/Docker 对齐
- [x] 5.2 覆盖率进 CI（后端 `--experimental-test-coverage`，先设软门槛）
- [x] 5.3 Dependabot（npm + GitHub Actions，weekly）
- [x] 5.4 分包与死依赖：核查发现 `framer-motion` 从未被引用（src / e2e / index.html 均 0 处），已 npm uninstall，白拿一份依赖与产物体积；`exceljs` 是 web 的 devDependency（E2E 读导出文件用）不进产物；`vite.config.ts` 保留 icons / react 两组 manualChunks
- [ ] 5.5 (另开分支) 评估 Tailwind 4 / Express 5 / React Router 7 data API（单独分支，不在本分支做）

## 不做（明确记录理由）

- **better-sqlite3 → node:sqlite**：会丢 `db.transaction` 与同步 API 的简洁性，性能还更差；维持。
- **JWT 从 localStorage 迁 httpOnly cookie**：改动面覆盖前后端与全部 E2E，收益被「CSP 强制 + XSS 面收窄」覆盖大半；单列后续专项。
- **multer 2.x**：无在用的 CVE，升级收益低，等 2.x 稳定版随 Dependabot 一起走。

---

## 验证记录（每批跑完基线）

| 批次 | 后端 | 前端 | 其他 |
| --- | --- | --- | --- |
| 基线 | 757 全过 | 440 全过 | 双端 tsc 通过 |
| 1 安全 | 770 全过 | 441 全过 | check-deploy-assets.sh 7 项通过 |
| 2 性能 | 778 全过 | 441 全过 | 分页 8 用例 + 排序索引 |
| 3 体验运维 | 784 全过 | 447 全过 | compose 资源上限、README 对齐 |
| 4 可维护 | 784 全过 | 447 全过 | 命令总线 6 用例 + 静态守卫 |
| 5 升级 | 覆盖率门槛 88/75/88 | 覆盖率门槛 64/62/52/53 | .nvmrc=26、Dependabot |

## 延后项说明（不是漏做）

- **4.2 zod schema 下沉 shared**：后端校验点分散且各有业务文案，前端 api 层还没有统一 parse 入口；一次下沉会牵动大量文件与提示文案，适合单独一批，先做「设置 + 听评课」验证形状。
- **4.3 ReportEdit / FollowUp 抽数据 hook**：两个文件都在 2000 行量级，抽取必须配足前端用例当护栏（覆盖率刚进门禁，这两页用例还薄）。建议先补 10-15 个交互用例再抽。
- **5.5 Tailwind 4 / Express 5 / React Router 7 data API**：都是破坏性升级（视觉 / 路由行为），按计划另开分支，配合视觉回归推进。
- **JWT 从 localStorage 迁 httpOnly cookie**：见上文「不做」一节，单列专项。
