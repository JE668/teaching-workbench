import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { db, initDatabase } from './config/database.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import followupRoutes from './routes/followups.js';
import uploadRoutes from './routes/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== 初始化 ==========
initDatabase();
console.log('[DB] 数据库初始化完成');

const app = express();
const server = http.createServer(app);

// ========== 中间件 ==========

// ========== CORS ==========
// 说明：标准部署下前端 nginx 会把 /api 反代到后端，浏览器看到的是同源请求，
// 因此 CORS 白名单留空也不影响使用。此白名单仅用于"前后端分域部署"的场景。
const allowedOrigins = (env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // 无 Origin 头（curl、服务端调用）直接放行
    if (!origin) {
      return callback(null, true);
    }
    // 命中白名单则返回 CORS 头
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // 未命中：不报错，仅不下发 CORS 头。
    // 同源请求不受影响；跨源请求会因缺少 CORS 头被浏览器拦截（安全）。
    // 注意：这里绝不能抛错，否则浏览器同源 POST 带上 Origin 时会直接 500。
    callback(null, false);
  },
  credentials: true,
}));

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  const { method, path: url } = req;
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const size = (res.headersSent && res.get('content-length')) || '-';
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      method,
      url,
      status,
      duration: duration + 'ms',
      size,
      ip: req.ip,
    };
    
    // 非 GET 请求或错误请求才记录
    if (status >= 400 || method !== 'GET') {
      console.log('[HTTP]', JSON.stringify(logEntry));
    }
  });
  
  next();
});

// Body parser
app.use(express.json({ limit: '50mb' }));

// 静态文件服务（上传图片）
app.use('/uploads', express.static(path.join(__dirname, '../data/uploads')));

// ========== 健康检查端点 ==========
app.get('/health', (req, res) => {
  try {
    // 检查数据库连接
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    });
  } catch (error) {
    res.status(503).json({ status: 'error', message: '数据库不可用' });
  }
});

// ========== 路由 ==========
app.use('/api/auth', authRoutes);

// 需要认证的路由
app.use('/api/students', authMiddleware, studentRoutes);
app.use('/api/followups', authMiddleware, followupRoutes);
app.use('/api', authMiddleware, uploadRoutes);

// 错误处理
app.use(notFound);
app.use(errorHandler);

// ========== 启动服务器 ==========
server.listen(env.PORT, env.HOST, () => {
  console.log('=========================================');
  console.log('  1对1老师教学服务工作台 - 后端服务');
  console.log('=========================================');
  console.log('[Server] 监听 ' + env.HOST + ':' + env.PORT);
  console.log('[Server] SenseNova Model: ' + env.SENSENOVA_MODEL);
  console.log(
    '[Server] CORS 白名单: ' +
      (allowedOrigins.length ? allowedOrigins.join(', ') : '(未配置，仅同源访问)')
  );
  console.log('=========================================');
});

// ========== 优雅关闭 ==========
function gracefulShutdown(signal: string) {
  console.log('[Server] 收到 ' + signal + '，正在优雅关闭...');
  
  server.close(() => {
    console.log('[Server] HTTP 服务器已关闭');
    db.close();
    console.log('[DB] 数据库连接已关闭');
    process.exit(0);
  });
  
  // 强制退出超时（10秒后强制退出）
  setTimeout(() => {
    console.error('[Server] 关闭超时，强制退出');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 未捕获异常处理
process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] 未处理的 Promise 拒绝:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] 未捕获的异常:', error);
  gracefulShutdown('uncaughtException');
});
