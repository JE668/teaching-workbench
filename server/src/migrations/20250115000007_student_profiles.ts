import { Migration } from '../migrations/runner.js';

export const up: Migration['up'] = (db) => {
  // 学生画像表
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL UNIQUE,
      profile_json TEXT NOT NULL,
      source_summary TEXT,
      confidence REAL DEFAULT 0,
      generated_at TEXT DEFAULT (datetime('now', '+8 hours')),
      confirmed_by_teacher BOOLEAN DEFAULT 0,
      teacher_notes TEXT
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_student_profiles_user ON student_profiles(user_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_student_profiles_student ON student_profiles(student_id);
  `);
};

export const down: Migration['down'] = (db) => {
  db.exec('DROP INDEX IF EXISTS idx_student_profiles_student;');
  db.exec('DROP INDEX IF EXISTS idx_student_profiles_user;');
  db.exec('DROP TABLE IF EXISTS student_profiles;');
};

const migration: Migration = {
  version: '20250115000007',
  description: '学生长期画像',
  up,
  down,
};

export default migration;
