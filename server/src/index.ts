import http from 'http';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { createApp } from './app.js';

// ========== 初始化 ==========
const app = createApp();
const server = http.createServer(app);

// ========== 启动服务器 ==========
server.listen(env.PORT, env.HOST, () => {
  const allowed = (env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  console.log('=========================================');
  console.log('  1对1老师教学服务工作台 - 后端服务');
  console.log('=========================================');
  console.log('[Server] 监听 ' + env.HOST + ':' + env.PORT);
  console.log('[Server] SenseNova Model: ' + env.SENSENOVA_MODEL);
  console.log('[Server] 思考强度: ' + env.SENSENOVA_REASONING_EFFORT);
  console.log('[Server] CORS 白名单: ' + (allowed.length ? allowed.join(', ') : '(未配置，仅同源访问)'));
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

  // 强制退出兜底（10 秒）
  setTimeout(() => {
    console.error('[Server] 关闭超时，强制退出');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] 未处理的 Promise 拒绝:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] 未捕获的异常:', error);
  gracefulShutdown('uncaughtException');
});
