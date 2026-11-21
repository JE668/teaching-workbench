import type { Database } from 'better-sqlite3';

/** 每条引用独立记录同步进度，避免全局 notified 影响其他引用方。 */
const migration = {
  version: '20250115000014',
  description: 'content_references 增加独立同步进度',
  up: (db: Database) => {
    const columns = db.prepare('PRAGMA table_info(content_references)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'last_synced_event_id')) {
      db.exec('ALTER TABLE content_references ADD COLUMN last_synced_event_id INTEGER NOT NULL DEFAULT 0;');
    }
    if (!columns.some((column) => column.name === 'last_synced_at')) {
      db.exec('ALTER TABLE content_references ADD COLUMN last_synced_at TEXT;');
    }
  },
  down: (_db: Database) => {
    console.warn('回滚 20250115000014：同步进度列保留（无害冗余）');
  },
};

export default migration;
