import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { db, initDatabase } from './config/database.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import followupRoutes from './routes/followups.js';
import uploadRoutes from './routes/uploads.js';

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
      credentials: true,
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

  // 静态文件服务（上传图片）—— 走 env.UPLOAD_DIR，确保与上传目录一致
  app.use('/uploads', express.static(env.UPLOAD_DIR));

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
  app.use('/api', authMiddleware, uploadRoutes);

  // ========== 错误处理 ==========
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
