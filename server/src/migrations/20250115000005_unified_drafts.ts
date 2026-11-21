import type { Database } from 'better-sqlite3';

/**
 * 20250115000005 - 统一草稿版本管理
 *
 * 统一三大实体的草稿系统：
 * - followups (课后回访)
 * - reports (月度总结规划)
 * - observations (听评课)
 *
 * 替换现有的 drafts、observation_drafts、draft_history 表
 * 新增：版本图、分支/合并、冲突检测、用户标签
 */
const migration = {
  version: '20250115000005',
  description: '统一草稿版本管理：unified_drafts 表替换三大分散表',
  up: (db: Database) => {
    // 创建统一草稿表
    db.exec(`
      CREATE TABLE IF NOT EXISTS unified_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,        -- 'followup' | 'report' | 'observation'
        entity_id INTEGER,                -- 实体 ID（新建时为 null）
        version INTEGER NOT NULL DEFAULT 1,
        content_json TEXT NOT NULL,       -- 完整表单快照
        base_version INTEGER,             -- 基于哪个版本 fork
        fork_from INTEGER,                -- fork 来源 draft id
        is_branch BOOLEAN DEFAULT 0,
        label TEXT,                       -- 用户自定义标签如 '给家长版'
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_unified_drafts_entity ON unified_drafts(entity_type, entity_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_unified_drafts_user ON unified_drafts(user_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_unified_drafts_fork ON unified_drafts(fork_from);');

    // 迁移现有 drafts 表数据（如果存在）
    const hasDrafts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get();
    if (hasDrafts) {
      const rows = db.prepare('SELECT user_id, payload, updated_at FROM drafts').all() as { user_id: number; payload: string; updated_at: string }[];
      for (const row of rows) {
        try {
          const content = JSON.parse(row.payload);
          db.prepare(`
            INSERT INTO unified_drafts (user_id, entity_type, entity_id, version, content_json, created_at, updated_at)
            VALUES (?, 'followup', NULL, 1, ?, ?, ?)
          `).run(row.user_id, JSON.stringify(content), row.updated_at, row.updated_at);
        } catch {
          // 忽略脏数据
        }
      }
    }

    // 迁移现有 observation_drafts 表数据（如果存在）
    const hasObsDrafts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observation_drafts'").get();
    if (hasObsDrafts) {
      const rows = db.prepare('SELECT user_id, observation_id, payload, updated_at FROM observation_drafts').all() as { user_id: number; observation_id: number; payload: string; updated_at: string }[];
      for (const row of rows) {
        try {
          const content = JSON.parse(row.payload);
          db.prepare(`
            INSERT INTO unified_drafts (user_id, entity_type, entity_id, version, content_json, created_at, updated_at)
            VALUES (?, 'observation', ?, 1, ?, ?, ?)
          `).run(row.user_id, row.observation_id, JSON.stringify(content), row.updated_at, row.updated_at);
        } catch {
          // 忽略脏数据
        }
      }
    }

    // 迁移现有 draft_history 表数据（如果存在）
    const hasDraftHistory = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='draft_history'").get();
    if (hasDraftHistory) {
      // 检查 source 和 client_id 列是否存在
      const columns = db.prepare('PRAGMA table_info(draft_history)').all() as { name: string }[];
      const hasSource = columns.some(c => c.name === 'source');
      const hasClientId = columns.some(c => c.name === 'client_id');

      let selectSql = 'SELECT user_id, payload, created_at';
      if (hasSource) selectSql += ', source';
      if (hasClientId) selectSql += ', client_id';
      selectSql += ' FROM draft_history';

      const rows = db.prepare(selectSql).all() as { user_id: number; payload: string; created_at: string; source?: string; client_id?: string | null }[];
      for (const row of rows) {
        try {
          const content = JSON.parse(row.payload);
          // 将历史版本作为版本序列写入，entity_type 暂存为 'followup'（旧历史不区分实体类型）
          db.prepare(`
            INSERT INTO unified_drafts (user_id, entity_type, entity_id, version, content_json, label, created_at, updated_at)
            VALUES (?, 'followup', NULL, ?, ?, ?, ?, ?)
          `).run(
            row.user_id,
            1, // 版本号暂时设为 1，实际版本顺序靠 created_at 推断
            JSON.stringify(content),
            row.source || 'history',
            row.created_at,
            row.created_at
          );
        } catch {
          // 忽略脏数据
        }
      }
    }
  },
  down: (db: Database) => {
    // 回滚：重建原三表（生产环境建议从备份恢复）
    db.exec('DROP TABLE IF EXISTS unified_drafts;');
    console.warn('回滚 20250115000005：unified_drafts 已删除，原表需从备份恢复');
  },
};

export default migration;