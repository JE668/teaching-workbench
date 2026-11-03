/**
 * e2e 全新库开关：E2E_FRESH_DB=1 且 NODE_ENV=test 时，
 * 在打开 SQLite 之前清空 DATA_DIR（数据库三件套 + uploads）。
 *
 * 为什么在后端进程内做而不是在 Playwright globalSetup 里做：
 * webServer 先于 globalSetup 启动，外部清完再拉进程有竞态；
 * 而后端 import config/database.js 之前求值本模块，时序天然正确。
 *
 * 双重保险挡住「残留库行让『库里只有我造的课』断言崩掉」：
 * 本地 reuseExistingServer 时代踩过两次（内置目录 3589 条 / 上一轮数据）。
 */
import fs from 'node:fs';
import path from 'node:path';

if (process.env.E2E_FRESH_DB === '1' && process.env.NODE_ENV === 'test') {
  const dir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  // 防呆：绝不清理看似真实数据的目录
  if (path.basename(dir) === '.e2e-data' || path.basename(dir).startsWith('tw-test-')) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('[e2e] 已清空数据目录，全新库起步:', dir);
  } else {
    console.warn('[e2e] E2E_FRESH_DB=1 但目录名不像 e2e 专用目录，拒绝清理:', dir);
  }
}
