import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { log } from '../utils/logger.js';

/**
 * 续费看板数据库（renewal.db）—— 独立于业务库 teaching.db。
 *
 * 设计（2026-11 重构，替代旧 bi.db 多表底座）：
 *   - 数据源收敛为单一 xlsx（用户在 Excel 里已做好的续费统计汇总表）
 *   - 上传一次 = 一个 report 批次，可整批删除重传
 *   - 学生网格颜色状态在上传解析时用 TS 复刻 Excel 条件格式算好存库
 *   - 与 teaching.db 分库：整表重建写入量大，避免业务库写锁竞争
 */

const renewalDbPath = path.join(env.DATA_DIR, 'renewal.db');

const dbDir = path.dirname(renewalDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const renewalDb = new Database(renewalDbPath);

renewalDb.pragma('journal_mode = WAL');
renewalDb.pragma('foreign_keys = ON');
renewalDb.pragma('busy_timeout = 5000');
renewalDb.pragma('synchronous = NORMAL');
renewalDb.pragma('cache_size = -16000');

log.info({ path: renewalDbPath }, '续费看板数据库已连接');

/** 上传文件临时目录 */
export const RENEWAL_UPLOAD_DIR = path.join(env.DATA_DIR, 'renewal_uploads');
if (!fs.existsSync(RENEWAL_UPLOAD_DIR)) {
  fs.mkdirSync(RENEWAL_UPLOAD_DIR, { recursive: true });
}

/**
 * 时间戳统一用 UTC+8（与主库 migrate 约定一致，避免容器时区差异）。
 *
 * 注意：作为列默认值使用时必须再用一层圆括号包裹，即 DEFAULT (datetime('now', '+8 hours'))。
 * SQLite 对非字面量的列默认值强制要求括号，裸写会直接报 near "(": syntax error，
 * 且错误只在 CREATE TABLE 执行时暴露 —— 表现为 initRenewalDb 一调就打崩整个 createApp。
 */
export const SQL_NOW = "datetime('now', '+8 hours')";

/**
 * 幂等初始化续费看板表结构。服务启动时调用。
 */
export function initRenewalDb(database: Database.Database = renewalDb): void {
  const sql = `
  -- 上传批次（一次上传一份汇总表 xlsx）
  CREATE TABLE IF NOT EXISTS renewal_report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    file_hash TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    stat_month TEXT,
    center_name TEXT,
    uploaded_by INTEGER,
    uploaded_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    row_count INTEGER,
    error_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing',
    note TEXT
  );

  -- 教师统计表系列（4 个 tab 共用一张表，tab 区分）
  -- tab: incentive(激励) | stage(学段) | mentor(学管) | hours(课时)
  CREATE TABLE IF NOT EXISTS teacher_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    teacher_name TEXT,
    teacher_no TEXT,
    subject_group TEXT,
    base_count INTEGER,
    prepaid_count INTEGER,
    prepaid_rate REAL,
    renewed_count INTEGER,
    renew_rate REAL,
    incentive_gap INTEGER,
    extra_json TEXT,
    student_count INTEGER,
    sort_order INTEGER DEFAULT 0,
    source_row INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_teacher_stats_report ON teacher_stats(report_id, tab);
  CREATE INDEX IF NOT EXISTS idx_teacher_stats_group ON teacher_stats(report_id, subject_group);

  -- 学生网格明细（每个老师的学生 + 颜色状态）
  -- status: renewed(绿/已续费) | prepaid(紫/已预存) | stopped(橙/停课)
  --       | closed(红/结课) | grade3(高三) | normal(无标记)
  CREATE TABLE IF NOT EXISTS grid_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    teacher_name TEXT,
    subject_group TEXT,
    teacher_stat_id INTEGER,
    student_id TEXT,
    student_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'normal',
    slot_index INTEGER,
    source_row INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_grid_students_report ON grid_students(report_id, tab);
  CREATE INDEX IF NOT EXISTS idx_grid_students_teacher ON grid_students(report_id, teacher_name);

  -- 学管业绩统计表
  CREATE TABLE IF NOT EXISTS manager_perf (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
    manager_name TEXT,
    renew_1v1 REAL, renew_1vN REAL, renew_small REAL, renew_other REAL, renew_total REAL,
    newsign_1v1 REAL, newsign_1vN REAL, newsign_small REAL, newsign_other REAL, newsign_total REAL,
    renewed_count REAL,
    tutored_count REAL,
    renew_rate REAL,
    task_amount REAL,
    cashflow_total REAL,
    completion_rate REAL,
    actual_students REAL,
    per_student REAL,
    avg_order REAL,
    gap_80 REAL,
    source_row INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_manager_perf_report ON manager_perf(report_id);

  -- 学管任务的人工覆盖值；NULL 表示该字段沿用 Excel 或保持未设置。
  -- user_id 是隔离键的一部分，同一报表被不同用户访问时也绝不会串用任务设置。
  CREATE TABLE IF NOT EXISTS renewal_manager_target (
    report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    manager_name TEXT NOT NULL,
    target_amount REAL,
    one2one_target REAL,
    one2many_target REAL,
    small_target REAL,
    other_target REAL,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW}),
    PRIMARY KEY (report_id, user_id, manager_name)
  );
  CREATE INDEX IF NOT EXISTS idx_renewal_manager_target_user
    ON renewal_manager_target(user_id, report_id);

  -- 续生率明细（漏斗 + 风险清单数据源）
  CREATE TABLE IF NOT EXISTS student_funnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
    manager_name TEXT,
    student_id TEXT,
    student_name TEXT,
    grade TEXT,
    first_enroll_date TEXT,
    enroll_days INTEGER,
    coef REAL,
    type TEXT,
    course_product TEXT,
    class_last1 INTEGER,
    class_last2 INTEGER,
    renewed INTEGER,
    source_row INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_student_funnel_report ON student_funnel(report_id);

  -- 导入错误明细
  CREATE TABLE IF NOT EXISTS renewal_import_error (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES renewal_report(id) ON DELETE CASCADE,
    sheet_name TEXT,
    row_number INTEGER,
    column_number INTEGER,
    field_name TEXT,
    error_type TEXT NOT NULL DEFAULT 'parse_error',
    severity TEXT NOT NULL DEFAULT 'error',
    error_message TEXT NOT NULL,
    details_json TEXT
  );
  `;
  database.exec(sql);

  // 老库通过补列升级；所有新增列都允许已有行保留空值/默认值。
  const ensureColumn = (table: string, column: string, definition: string): void => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) return;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  ensureColumn('grid_students', 'teacher_stat_id', 'INTEGER');
  ensureColumn('grid_students', 'student_id', 'TEXT');
  ensureColumn('renewal_report', 'file_hash', 'TEXT');
  ensureColumn('renewal_import_error', 'error_type', "TEXT NOT NULL DEFAULT 'parse_error'");
  ensureColumn('renewal_import_error', 'severity', "TEXT NOT NULL DEFAULT 'error'");
  ensureColumn('renewal_import_error', 'column_number', 'INTEGER');
  ensureColumn('renewal_import_error', 'field_name', 'TEXT');
  ensureColumn('renewal_import_error', 'details_json', 'TEXT');

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_grid_students_teacher_stat ON grid_students(teacher_stat_id);
    CREATE INDEX IF NOT EXISTS idx_grid_students_student_id ON grid_students(student_id);
    DROP INDEX IF EXISTS idx_renewal_report_file_hash;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_report_file_hash
      ON renewal_report(uploaded_by, file_hash)
      WHERE file_hash IS NOT NULL AND uploaded_by IS NOT NULL;
  `);
  log.info('续费看板表结构已初始化');
}
