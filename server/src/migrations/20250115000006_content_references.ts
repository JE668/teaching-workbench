import type { Database } from 'better-sqlite3';

/**
 * 20250115000006 - 双向引用 + 变更通知
 *
 * 建立内容间的引用关系：observation → report、followup → observation 等
 * 变更事件表：记录实体变更，驱动通知
 */
const migration = {
  version: '20250115000006',
  description: '双向引用 + 变更通知：content_references + content_change_events',
  up: (db: Database) => {
    // 创建内容引用表
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,        -- 'observation' | 'followup' | 'report'
        source_id INTEGER NOT NULL,
        target_type TEXT NOT NULL,        -- 'observation' | 'followup' | 'report'
        target_id INTEGER NOT NULL,
        ref_role TEXT NOT NULL,           -- 'cites' | 'derives_from' | 'supplements'
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        UNIQUE(source_type, source_id, target_type, target_id, ref_role)
      );
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_content_refs_source ON content_references(source_type, source_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_content_refs_target ON content_references(target_type, target_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_content_refs_role ON content_references(ref_role);');

    // 创建内容变更事件表
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_change_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,        -- 'observation' | 'followup' | 'report'
        entity_id INTEGER NOT NULL,
        changed_fields TEXT NOT NULL,     -- JSON: ["report", "plan"] 或 ["report"]
        version INTEGER NOT NULL,         -- 变更后的版本号
        notified BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      );
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_change_events_entity ON content_change_events(entity_type, entity_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_change_events_notified ON content_change_events(notified);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_change_events_created ON content_change_events(created_at DESC);');
  },
  down: (db: Database) => {
    db.exec('DROP TABLE IF EXISTS content_references;');
    db.exec('DROP TABLE IF EXISTS content_change_events;');
    console.warn('回滚 20250115000006：content_references 和 content_change_events 已删除');
  },
};

export default migration;