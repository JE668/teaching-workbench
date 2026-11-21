import type { Migration } from './runner.js';

const migration: Migration = {
  version: '20250115000015',
  description: 'AI 流式会话归属、终态与过期时间',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_stream_sessions (
        stream_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'interrupted', 'done', 'error')),
        terminal_event TEXT,
        terminal_data TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_stream_sessions_user ON ai_stream_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_ai_stream_sessions_expires ON ai_stream_sessions(expires_at);
    `);
  },
  down: (db) => {
    db.exec('DROP TABLE IF EXISTS ai_stream_sessions');
  },
};

export default migration;
