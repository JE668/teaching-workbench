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
import { log } from './utils/logger.js';

// ========== 初始化 ==========
const app = createApp();

// 启动时做一次「孤儿回访」修复：把按姓名能唯一确定的未关联回访
// 补挂到对应学生档案。历史遗留数据（先写回访、后建档案）靠这一步归位。
// 幂等，可重复执行；同名歧义时不会猜，只跳过。
try {
  const repaired = repairAllUsers();
  if (repaired > 0) {
    log.info({ repaired }, '已把未关联的历史回访归位到对应学生档案');
  }
} catch (err: any) {
  log.warn({ err: err.message }, '历史回访归位失败（不影响启动）');
}

// ========== 图片目录整理（幂等，可重复执行） ==========
// 1) 历史目录迁移：uploads/<数字ID>/ 改名为 uploads/<账户名>/，
//    并同步改写回访与草稿里存的引用路径。
try {
  const migrated = migrateLegacyFolders();
  if (migrated.movedFiles > 0 || migrated.renamedDirs > 0) {
    log.info({ movedFiles: migrated.movedFiles, renamedDirs: migrated.renamedDirs }, '已迁移历史图片目录到账户名目录');
  }
} catch (err: any) {
  log.warn({ err: err.message }, '历史目录迁移失败（不影响启动）');
}

// 2) 清理：过期的暂存图（没保存回访的）+ 没有任何记录引用的孤儿文件。
//    保留期 7 天，与草稿一致 —— 草稿还在，它引用的暂存图就不能删。
try {
  const staged = gcStagedImages();
  const orphans = cleanupOrphanImages();
  if (staged + orphans > 0) {
    log.info({ staged, orphans }, '已清理过期暂存图与无引用孤儿文件');
  }
} catch (err: any) {
  log.warn({ err: err.message }, '清理失败（不影响启动）');
}

// 每日跑一次清理，让长期运行的服务也能持续回收空间
const gcTimer = setInterval(() => {
  try {
    const staged = gcStagedImages();
    const orphans = cleanupOrphanImages();
    if (staged + orphans > 0) {
      log.info({ staged, orphans }, '定时清理：过期暂存图与孤儿文件');
    }
  } catch (err: any) {
    log.warn({ err: err.message }, '定时清理失败');
  }
}, 24 * 60 * 60 * 1000);
gcTimer.unref?.();

const server = http.createServer(app);

// ========== 启动服务器 ==========
server.listen(env.PORT, env.HOST, () => {
  const allowed = (env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  log.info(
    { host: env.HOST, port: env.PORT, model: env.SENSENOVA_MODEL, reasoningEffort: env.SENSENOVA_REASONING_EFFORT, cors: allowed.length ? allowed.join(', ') : '(未配置，仅同源访问)' },
    '1对1老师教学服务工作台 - 后端服务已启动'
  );
});

// ========== 优雅关闭 ==========
function gracefulShutdown(signal: string) {
  log.info({ signal }, '收到信号，正在优雅关闭');

  server.close(() => {
    log.info({}, 'HTTP 服务器已关闭');
    db.close();
    log.info({}, '数据库连接已关闭');
    process.exit(0);
  });

  // 强制退出兜底（10 秒）
  setTimeout(() => {
    log.error({ signal }, '关闭超时，强制退出');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error({ reason: String(reason) }, '未处理的 Promise 拒绝');
});

process.on('uncaughtException', (error) => {
  log.fatal({ err: error.stack }, '未捕获的异常');
  gracefulShutdown('uncaughtException');
});
