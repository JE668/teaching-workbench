/**
 * 20250115000010 - AI 备课助手
 *
 * 保存老师生成的结构化教案。学生与课程均可选：未选学生的通用备课、
 * 未关联目录的临时备课也应能长期保留。
 */

import type { Database } from 'better-sqlite3';

const migration = {
  version: '20250115000010',
  description: 'AI 备课助手结构化教案',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lesson_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        student_id INTEGER,
        course_id INTEGER,
        title TEXT NOT NULL,
        month TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 45,
        week_count INTEGER NOT NULL DEFAULT 1,
        requirements TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
        confirmed_at TEXT,
        plan_json TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        model_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
        FOREIGN KEY (course_id) REFERENCES course_catalog(id) ON DELETE SET NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_lesson_plans_user_updated
        ON lesson_plans(user_id, updated_at DESC)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_lesson_plans_user_student
        ON lesson_plans(user_id, student_id)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_lesson_plans_user_course
        ON lesson_plans(user_id, course_id)
    `);
  },
  down: (db: Database) => {
    db.exec('DROP TABLE IF EXISTS lesson_plans');
  },
};

export default migration;
