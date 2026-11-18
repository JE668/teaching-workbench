import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

/**
 * BI 数据库（bi.db）—— 与业务库 teaching.db 完全独立。
 *
 * 设计理由（2026-11 与用户确认）：
 *   - 报表数据写入量大（单次上传 3581 行预排），与业务库分库避免写锁竞争
 *   - 按 batch 语义可整批删除重传，不影响业务数据
 *   - 备份/归档/清库节奏独立
 *   - 同进程内开两个 Database 连接是 better-sqlite3 官方支持的用法
 *
 * 文件位置：与 teaching.db 同目录（env.DATA_DIR）。
 */

const biDbPath = path.join(env.DATA_DIR, 'bi.db');

// 确保目录存在（与 database.ts 逻辑一致，防止 DATA_DIR 未建）
const dbDir = path.dirname(biDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const biDb = new Database(biDbPath);

biDb.pragma('journal_mode = WAL');
biDb.pragma('foreign_keys = ON');
biDb.pragma('busy_timeout = 5000');
biDb.pragma('synchronous = NORMAL');
biDb.pragma('cache_size = -16000');

log.info({ path: biDbPath }, 'BI 数据库已连接');

/**
 * 确保 bi 表存在指定列（与 database.ts ensureColumn 逻辑对齐，bi 库独立迁移用）。
 * 列定义需自带 DEFAULT，否则 NOT NULL 新列无法加到已有数据的表上。
 */
export function ensureBiColumn(table: string, column: string, definition: string): void {
  const columns = biDb.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  biDb.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
  log.info({ table, column }, 'bi.db 列补齐');
}
