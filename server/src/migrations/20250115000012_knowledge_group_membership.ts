import type { Database } from 'better-sqlite3';

/**
 * 显式教研组成员关系与一次性加入邀请码。
 * 邀请码明文只在创建响应中返回一次，数据库仅保存 SHA-256 哈希。
 */
const migration = {
  version: '20250115000012',
  description: '教研组成员关系、一次性邀请码与知识分块去重',
  irreversible: true,
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        subject_group TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        join_code_hash TEXT UNIQUE,
        join_code_used_at TEXT,
        join_code_used_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (join_code_used_by) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_group_members (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
        joined_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES knowledge_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_group_members_user
        ON knowledge_group_members(user_id, group_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_groups_subject
        ON knowledge_groups(subject_group);

      DELETE FROM group_knowledge_chunks
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM group_knowledge_chunks
        GROUP BY user_id, source_type, source_id, chunk_text
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_gkc_unique_source_chunk
        ON group_knowledge_chunks(user_id, source_type, source_id, chunk_text);
    `);
  },
};

export default migration;
