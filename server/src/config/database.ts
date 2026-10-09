import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { env } from './env.js';

const dbPath = path.join(env.DATA_DIR, 'teaching.db');

// 确保目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 确保上传目录存在
if (!fs.existsSync(env.UPLOAD_DIR)) {
  fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
}

export const db = new Database(dbPath);

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * 确保某张表存在指定列，缺则补上（SQLite 的简易迁移）。
 * 列定义需自带 DEFAULT，否则 NOT NULL 的新列无法加到已有数据的表上。
 */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare('PRAGMA table_info(' + table + ')').all() as any[];
  if (columns.some((c) => c.name === column)) return;

  db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
  console.log('[DB] 迁移: ' + table + '.' + column + ' 已添加 (默认 ' + definition + ')');
}

// 初始化表结构
export function initDatabase() {
  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      preferences TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 学生表
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      subject TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 课后回访表
  db.exec(`
    CREATE TABLE IF NOT EXISTS followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      student_id INTEGER,
      student_name TEXT NOT NULL,
      grade TEXT NOT NULL,
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      performance TEXT NOT NULL,
      mastery TEXT NOT NULL,
      session_count INTEGER NOT NULL DEFAULT 1,
      course_type TEXT NOT NULL DEFAULT 'one_on_one',
      images TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
    )
  `);

  // 创建默认管理员账号
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get(env.DEFAULT_ADMIN_USER);
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync(env.DEFAULT_ADMIN_PASS, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(env.DEFAULT_ADMIN_USER, hashedPassword);
    console.log(`[DB] 默认管理员已创建: ${env.DEFAULT_ADMIN_USER} / ${env.DEFAULT_ADMIN_PASS}`);
  }

  // 进行中的回访草稿（跨设备实时同步的服务端副本，每人一份）
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      user_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ========== 增量迁移 ==========
  // CREATE TABLE IF NOT EXISTS 不会给已存在的表补字段，因此需要显式检查。
  ensureColumn('users', 'preferences', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('followups', 'session_count', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('followups', 'course_type', "TEXT NOT NULL DEFAULT 'one_on_one'");

  // 创建索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_user ON followups(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_student ON followups(student_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_created ON followups(created_at DESC)');
}
