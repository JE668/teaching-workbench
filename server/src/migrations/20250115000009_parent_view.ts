import type { Database } from 'better-sqlite3';

/**
 * 20250115000009 - 家长端视图
 *
 * 支持老师为回访/月报生成家长版结构化摘要
 * 家长通过 token 无需登录访问，可标记已读、提交反馈
 */
const migration = {
  version: '20250115000009',
  description: '家长端视图：parent_views 表',
  up: (db: Database) => {
    // 家长视图表
    db.exec(`
      CREATE TABLE IF NOT EXISTS parent_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('followup', 'report')),
        source_id INTEGER NOT NULL,
        view_json TEXT NOT NULL,
        access_token TEXT NOT NULL UNIQUE,
        expires_at TEXT,
        read_at TEXT,
        parent_feedback TEXT,
        created_at TEXT DEFAULT (datetime('now', '+8 hours')),
        UNIQUE(user_id, source_type, source_id)
      );
    `);

    // 索引
    db.exec('CREATE INDEX IF NOT EXISTS idx_parent_views_token ON parent_views(access_token);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_parent_views_source ON parent_views(user_id, source_type, source_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_parent_views_expires ON parent_views(expires_at);');
  },
  down: (db: Database) => {
    db.exec('DROP INDEX IF EXISTS idx_parent_views_token;');
    db.exec('DROP INDEX IF EXISTS idx_parent_views_source;');
    db.exec('DROP INDEX IF EXISTS idx_parent_views_expires;');
    db.exec('DROP TABLE IF EXISTS parent_views;');
    console.warn('回滚 20250115000009：parent_views 已删除');
  },
};

export default migration;
