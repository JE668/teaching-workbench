import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { db, initDatabase } from './config/database.js';
import { authMiddleware } from './middleware/auth.js';
import { requireMediaAuth } from './middleware/mediaAuth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import followupRoutes from './routes/followups.js';
import uploadRoutes from './routes/uploads.js';
import draftRoutes from './routes/draft.js';
import groupRoutes from './routes/groups.js';
import settingsRoutes from './routes/settings.js';

/**
 * 创建 Express 应用（不启动监听）。
 * 拆出来是为了让测试可以直接对 app 发请求，无需占用端口。
 */
export function createApp() {
  initDatabase();

  const app = express();

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
        console.log(
          '[HTTP]',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            method,
            url,
            status,
            duration: Date.now() - start + 'ms',
            ip: req.ip,
          })
        );
      });

      next();
    });
  }

  // Body parser
  app.use(express.json({ limit: '50mb' }));

  // ========== 图片服务（需鉴权） ==========
  // 不能直接用 express.static：那样任何拿到 URL 的人都能访问，
  // 而路径中的 userId 可枚举 —— 多用户场景下会互相看到对方的照片。
  // requireMediaAuth 同时校验「签名有效」与「归属一致」。
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
      });
    } catch {
      res.status(503).json({ status: 'error', message: '数据库不可用' });
    }
  });

  // ========== 路由 ==========
  app.use('/api/auth', authRoutes);
  app.use('/api/students', authMiddleware, studentRoutes);
  app.use('/api/followups', authMiddleware, followupRoutes);
  app.use('/api/settings', authMiddleware, settingsRoutes);
  app.use('/api/groups', authMiddleware, groupRoutes);
  app.use('/api/draft', authMiddleware, draftRoutes);
  app.use('/api', authMiddleware, uploadRoutes);

  // ========== 错误处理 ==========
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
