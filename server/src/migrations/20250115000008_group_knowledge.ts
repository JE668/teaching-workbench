import { Migration } from '../migrations/runner.js';

export const up: Migration['up'] = (db) => {
  // 教研组知识库分块表
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject_group TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding BLOB,
      metadata_json TEXT,
      indexed_at TEXT DEFAULT (datetime('now', '+8 hours'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gkc_group ON group_knowledge_chunks(subject_group);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gkc_source ON group_knowledge_chunks(source_type, source_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gkc_user ON group_knowledge_chunks(user_id);
  `);
};

export const down: Migration['down'] = (db) => {
  db.exec('DROP INDEX IF EXISTS idx_gkc_user;');
  db.exec('DROP INDEX IF EXISTS idx_gkc_source;');
  db.exec('DROP INDEX IF EXISTS idx_gkc_group;');
  db.exec('DROP TABLE IF EXISTS group_knowledge_chunks;');
};

const migration: Migration = {
  version: '20250115000008',
  description: '教研组知识库分块',
  up,
  down,
};

export default migration;
