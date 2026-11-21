import type { Database } from 'better-sqlite3';

export default {
  version: '20250115000004',
  description: '创建 ai_stream_chunks 表用于 SSE 流式断点续传',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_stream_chunks (
        stream_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        delta TEXT NOT NULL,
        phase TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (stream_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_stream_chunks_stream_id ON ai_stream_chunks(stream_id);
    `);
  },
  down: (db: Database) => {
    db.exec('DROP TABLE IF EXISTS ai_stream_chunks;');
  },
};
