import http from 'http';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { createApp } from './app.js';
import { repairAllUsers } from './services/linkOrphans.js';

// ========== 初始化 ==========
const app = createApp();

// 启动时做一次「孤儿回访」修复：把按姓名能唯一确定的未关联回访
// 补挂到对应学生档案。历史遗留数据（先写回访、后建档案）靠这一步归位。
// 幂等，可重复执行；同名歧义时不会猜，只跳过。
try {
  const repaired = repairAllUsers();
  if (repaired > 0) {
    console.log('[DB] 已把 ' + repaired + ' 条未关联的历史回访归位到对应学生档案');
  }
} catch (err: any) {
  console.warn('[DB] 历史回访归位失败（不影响启动）: ' + err.message);
}
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
