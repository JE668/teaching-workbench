import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { db, initDatabase } from './config/database.js';
import { authMiddleware } from './middleware/auth.js';
import { requireMediaAuth } from './middleware/mediaAuth.js';
import { errorHandler, notFound, sanitizeErrorMessages } from './middleware/error.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { log } from './utils/logger.js';
import { observeHttpRequest, renderPrometheus } from './utils/metrics.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import followupRoutes from './routes/followups.js';
import uploadRoutes from './routes/uploads.js';
import draftRoutes from './routes/draft.js';
import draftHistoryRoutes from './routes/draftHistory.js';
import observationDraftRoutes from './routes/observations.draft.js';
import groupRoutes from './routes/groups.js';
import settingsRoutes from './routes/settings.js';
import teacherRoutes from './routes/teachers.js';
import observationRoutes from './routes/observations.js';
import catalogRoutes from './routes/catalog.js';
import reportRoutes from './routes/reports.js';
import reportAiRoutes from './routes/reports.ai.js';
import aiMetricsRoutes from './routes/aiMetrics.js';
import renewalRoutes from './renewal/renewalRoutes.js';
import { initRenewalDb } from './renewal/db.js';
import knowledgeGraphRoutes from './routes/knowledgeGraph.js';
import examAnalysisRoutes from './routes/examAnalysis.js';
import unifiedDraftsRoutes from './routes/unifiedDrafts.js';
import contentReferencesRoutes from './routes/contentReferences.js';
import studentProfileRoutes from './routes/studentProfile.js';
import knowledgeRoutes from './routes/knowledge.js';
import parentViewRoutes from './routes/parentView.js';
import lessonPlannerRoutes from './routes/lessonPlanner.js';
import teachingReviewRoutes from './routes/teachingReview.js';

/**
 * 创建 Express 应用（不启动监听）。
 * 拆出来是为了让测试可以直接对 app 发请求，无需占用端口。
 * 注：组件测试直接渲染页面（不经由这里），不受懒加载影响。
 */
export async function createApp() {
  // 等数据库初始化完成再挂路由：initDatabase 内部有 await 让出点（migrateUp），
  // 不 await 的话首批请求可能落在迁移/索引重建/RENAME 完成之前，撞进半初始化的库。
  await initDatabase();

  // 续费看板模块（独立 renewal.db）：初始化表结构。
  // 数据源收敛为一份用户做好的续费统计表 xlsx，解析入库后看板直接出图。
  initRenewalDb();

  const app = express();

  // 不暴露服务端框架：这是一条零成本的指纹消除，攻击者少一个判断依据。
  app.disable('x-powered-by');

  // S12：反代下 req.ip 默认取 socket 地址（全是 127.0.0.1）。
  // 设 trust proxy = 1 跳（nginx/Lucky 一层），req.ip 会取 X-Forwarded-For 链的最后一跳。
  // 与 rateLimit.clientIp() 的逻辑对齐，但更保守——只信单层代理（防伪造 XFF）。
  app.set('trust proxy', 1);

  // 安全响应头必须在所有路由之前挂载，静态图片与 404 也要带上。
  app.use(securityHeaders);

  // ========== CORS ==========
  // 说明：标准部署下前端 nginx 会把 /api 反代到后端，浏览器看到的是同源请求，
  // 因此 CORS 白名单留空也不影响使用。此白名单仅用于"前后端分域部署"的场景。
  const allowedOrigins = (env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      // 允许跨域携带 cookie：图片鉴权依赖 cookie，
      // 前后端分域部署时需要它；同源部署不受影响。
      credentials: true,
      origin: (origin, callback) => {
        // 无 Origin 头（curl、服务端调用）直接放行
        if (!origin) return callback(null, true);
        // 命中白名单则返回 CORS 头
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // 未命中：不报错，仅不下发 CORS 头。
        // 同源请求不受影响；跨源请求会因缺少 CORS 头被浏览器拦截（安全）。
        // 注意：这里绝不能抛错，否则浏览器同源 POST 带上 Origin 时会直接 500。
        callback(null, false);
      },
    })
  );

  // ========== 指标采集（/metrics 数据源）==========
  // 与请求日志不同：所有环境都采集（测试要断言 /metrics），只是不打印。
  app.use((req, res, next) => {
    const start = Date.now();
    // 必须此刻捕获：进入挂载 router 后 Express 会改写 req.url/path，
    // finish 回调里再读拿到的是最深层 router 的相对路径。
    const rawPath = req.baseUrl ? req.baseUrl + req.url : req.path;
    res.on('finish', () => {
      // /metrics 自身不记录，避免抓取端高频轮询污染直方图
      if (!rawPath.startsWith('/metrics')) {
        observeHttpRequest(req.method, rawPath, res.statusCode, Date.now() - start);
      }
    });
    next();
  });

  // ========== 请求日志 ==========
  // 测试环境静音，避免刷屏
  if (env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      const start = Date.now();
      const { method, path: url } = req;

      res.on('finish', () => {
        const status = res.statusCode;
        // 仅记录写操作与错误请求，避免日志噪音
        if (status < 400 && method === 'GET') return;
        log.info(
          { status, method, url, durationMs: Date.now() - start, ip: req.ip },
          'HTTP 请求'
        );
      });

      next();
    });
  }

  // Body parser
  // JSON 上限 5mb：图片走 multipart（multer 单张 40MB，nginx 层 45m），不经过这里；
  // JSON 里只存图片【路径数组】与文本字段。此前全局 50mb 只是给内存放大攻击
  // （单个 JSON 请求即可占住 50MB 堆内存）留门，收窄到业务上限之上即可。
  app.use(express.json({ limit: '5mb' }));

  // S10：拦截 500 响应里的 error.message（生产环境），防止 SQLite/FS 错误回显到前端
  app.use(sanitizeErrorMessages);

  // ========== 图片服务（需鉴权） ==========
  // 不能直接用 express.static：那样任何拿到 URL 的人都能访问，
  // 而路径中的目录名可枚举 —— 多用户场景下会互相看到对方的照片。
  // requireMediaAuth 同时校验「签名有效」与「归属一致」（数字 ID 或账户名）。
  //
  // 暂存区路由：/uploads/_staging/<账户名>/<文件>（上传后、保存前的图片）。
  // 3 段路径不会命中下面 2 段的正式路由，必须显式注册。
  app.get('/uploads/_staging/:owner/:filename', requireMediaAuth, (req: any, res) => {
    const { owner, filename } = req.params;
    const staging = path.resolve(env.UPLOAD_DIR, '_staging');
    const target = path.resolve(staging, owner, filename);

    if (!target.startsWith(staging + path.sep)) {
      return res.status(400).json({ error: '非法路径' });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: '图片不存在' });
    }
    res.sendFile(target);
  });

  // 正式归档路由：/uploads/<目录名>/<文件>（账户名，或历史的数字 ID）
  app.get('/uploads/:userId/:filename', requireMediaAuth, (req: any, res) => {
    const { userId, filename } = req.params;
    const baseDir = path.resolve(env.UPLOAD_DIR);
    const target = path.resolve(baseDir, userId, filename);

    // 防止 ../ 路径穿越
    if (!target.startsWith(baseDir + path.sep)) {
      return res.status(400).json({ error: '非法路径' });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: '图片不存在' });
    }
    res.sendFile(target);
  });

  // ========== 健康检查 ==========
  app.get('/health', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        // 构建时的 git 提交号，烤进镜像（Dockerfile 的 ARG BUILD_SHA）。
        // 确认线上是不是最新代码就看这个，别靠「我记得我部署过」。
        build: process.env.BUILD_SHA || 'dev',
        // e2e 守护：测试实例带 testEnv 标记。playwright globalSetup 断言它，
        // 挡住「复用到一台非 test 模式的残留后端 → 内置目录 seed 灌进库、
        // 全量行数断言崩掉」这类事故（本地真实踩过：残留 dev 后端被
        // reuseExistingServer 静默复用，5 个用例离奇失败）。
        ...(process.env.NODE_ENV === 'test' ? { testEnv: true } : {}),
      });
    } catch {
      res.status(503).json({ status: 'error', message: '数据库不可用' });
    }
  });

  // ========== Prometheus 指标 ==========
  // 门禁规则：
  //   - 设了 METRICS_TOKEN：必须带 ?token=xxx 或 Authorization: Bearer，
  //     不对一律 404（不暴露端点存在性）；
  //   - 未设 token：仅开发/测试环境开放（本机调试方便）；生产环境默认 404，
  //     防止 Lucky 反代把整个域名（含 /metrics）暴露到公网时泄露版本、
  //     uptime 与路径直方图。生产要开启监控就显式设置 METRICS_TOKEN。
  // 读 process.env 而非启动期定格的 env 对象：测试要能多种模式都覆盖。
  app.get('/metrics', (req, res) => {
    const token = (process.env.METRICS_TOKEN || '').trim();
    if (!token && process.env.NODE_ENV === 'production') {
      return res.status(404).end();
    }
    if (token) {
      // 只接受 Authorization: Bearer —— URL query token 会落进 nginx access log、
      // 浏览器历史、Referer 头，等于把长期密钥撒在多处。
      const given = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1]?.trim() ?? '';
      // 定长比较，避免时序侧信道逐字节爆破；长度不等直接拒绝（不进 timingSafeEqual）
      const a = Buffer.from(given);
      const b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(404).end();
      }
    }
    res.type('text/plain; version=0.0.4; charset=utf-8');
    res.send(renderPrometheus(process.env.BUILD_SHA || 'dev'));
  });

  // ========== 路由 ==========
  app.use('/api/auth', authRoutes);
  app.use('/api/students', authMiddleware, studentRoutes);
  app.use('/api/followups', authMiddleware, followupRoutes);
  app.use('/api/settings', authMiddleware, settingsRoutes);
  app.use('/api/groups', authMiddleware, groupRoutes);
  app.use('/api/teachers', authMiddleware, teacherRoutes);
  app.use('/api/observations', authMiddleware, observationRoutes);
  app.use('/api/observations', authMiddleware, observationDraftRoutes);
  app.use('/api/catalog', authMiddleware, catalogRoutes);
  app.use('/api/reports', authMiddleware, reportRoutes);
  app.use('/api/reports', authMiddleware, reportAiRoutes);
  app.use('/api/ai-metrics', authMiddleware, aiMetricsRoutes);
  app.use('/api/draft', authMiddleware, draftRoutes);
  app.use('/api/draft', authMiddleware, draftHistoryRoutes);
  // W13：给前端离线检测用。/health 挂在根路径且返回一堆字段，前端只需要一个
  // 极轻的端点判定连通性；/api 前缀会被 Vite proxy 转给后端，避免 dev 模式下
  // 心跳打到 Vite 自己（永远 200，离线检测失效）。
  // 必须注册在 app.use('/api', authMiddleware, ...) 之前，否则 authMiddleware
  // 会先拦下 /api/health 返回 401。
  // 故意不挂 authMiddleware：未登录时也需要探测连通性。
  app.get('/api/health', (req, res) => {
    res.status(200).end();
  });

  // 必须在 app.use('/api', authMiddleware, uploadRoutes) 前注册：
  // 该全局中间件会拦截所有后续 /api 请求，而家长 token 页面需要公开访问。
  app.use('/api/parent-view', parentViewRoutes);

  app.use('/api', authMiddleware, uploadRoutes);

  // ========== 续费看板模块（独立 renewal.db）==========
  // 上传用户在 Excel 里已做好的续费统计表，解析入库；
  // 教师统计表按 激励/学段/学管/课时 4 个 tab 出图，另有科组对比/学管业绩/续生漏斗/风险清单。
  app.use('/api/renewal', authMiddleware, renewalRoutes);

  // ========== 知识图谱模块 ==========
  // 从月度总结/回访/观察记录中抽取知识点，维护 mastery 动态更新，
  // 提供知识雷达、薄弱点、补缺推荐。
  app.use('/api/knowledge', authMiddleware, knowledgeGraphRoutes);

  // ========== 阶测错因分析模块 ==========
  // 上传试卷图片/文本，AI 分析错因标签、生成复习微计划、全班错因分布统计。
  app.use('/api/exam-analysis', authMiddleware, examAnalysisRoutes);

  // ========== 统一草稿版本管理模块 ==========
  // 回访/月报/听评课共用一套草稿协议，支持分支/合并/冲突检测/版本图可视化。
  app.use('/api/unified-drafts', authMiddleware, unifiedDraftsRoutes);

  // ========== 双向引用 + 变更通知模块 ==========
  // 前端统一使用 /api/content/references；保留 /api/content 作为旧客户端兼容别名。
  app.use('/api/content/references', authMiddleware, contentReferencesRoutes);
  app.use('/api/content', authMiddleware, contentReferencesRoutes);

  // ========== 学生画像模块 ==========
  // 聚合多模态长时序数据 → LLM 抽取 StudentProfile → 注入后续生成。
  app.use('/api/student-profiles', authMiddleware, studentProfileRoutes);
  // ========== 教研组知识库模块 ==========
  // 语义检索、周报摘要、相似学生匹配、优质范例、增量索引。
  app.use('/api/knowledge', authMiddleware, knowledgeRoutes);

  // ========== AI 备课助手 ==========
  app.use('/api/lesson-plans', authMiddleware, lessonPlannerRoutes);

  // ========== 教学复盘仪表盘 ==========
  // 实时聚合回访/月报/听评课/AI 指标与知识点掌握，不落新表。
  app.use('/api/teaching-review', authMiddleware, teachingReviewRoutes);

  // ========== 错误处理 ==========
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
