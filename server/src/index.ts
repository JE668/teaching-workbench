import http from 'http';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { createApp } from './app.js';
import { repairAllUsers } from './services/linkOrphans.js';
import {
  migrateLegacyFolders,
  gcStagedImages,
  cleanupOrphanImages,
} from './services/imageLifecycle.js';

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

// ========== 图片目录整理（幂等，可重复执行） ==========
// 1) 历史目录迁移：uploads/<数字ID>/ 改名为 uploads/<账户名>/，
//    并同步改写回访与草稿里存的引用路径。
try {
  const migrated = migrateLegacyFolders();
  if (migrated.movedFiles > 0 || migrated.renamedDirs > 0) {
    console.log(
      '[图片] 已迁移 ' + migrated.movedFiles + ' 个文件到账户名目录，改名 ' + migrated.renamedDirs + ' 个旧目录'
    );
  }
} catch (err: any) {
  console.warn('[图片] 历史目录迁移失败（不影响启动）: ' + err.message);
}

// 2) 清理：过期的暂存图（没保存回访的）+ 没有任何记录引用的孤儿文件。
//    保留期 7 天，与草稿一致 —— 草稿还在，它引用的暂存图就不能删。
try {
  const staged = gcStagedImages();
  const orphans = cleanupOrphanImages();
  if (staged + orphans > 0) {
    console.log('[图片] 已清理 ' + staged + ' 个过期暂存图，' + orphans + ' 个无引用孤儿文件');
  }
} catch (err: any) {
  console.warn('[图片] 清理失败（不影响启动）: ' + err.message);
}

// 每日跑一次清理，让长期运行的服务也能持续回收空间
const gcTimer = setInterval(() => {
  try {
    const staged = gcStagedImages();
    const orphans = cleanupOrphanImages();
    if (staged + orphans > 0) {
      console.log('[图片] 定时清理：暂存 ' + staged + ' 个，孤儿 ' + orphans + ' 个');
    }
  } catch (err: any) {
    console.warn('[图片] 定时清理失败: ' + err.message);
  }
}, 24 * 60 * 60 * 1000);
gcTimer.unref?.();

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
