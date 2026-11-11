/**
 * 20240101000000 - 初始数据库架构
 * 
 * 创建所有核心表：
 * - users: 用户账号
 * - students: 学生档案
 * - followups: 课后回访
 * - report_items: 报告明细
 * - monthly_reports: 月度报告
 * - observations: 听评课
 * - teachers: 听课老师
 * - groups: 分组预设
 * - course_catalog: 课程目录
 * - catalog_imports: 目录导入记录
 * - drafts: 回访草稿
 * - observation_drafts: 听评课草稿
 * - draft_history: 草稿历史
 * - settings_user: 用户设置
 * - settings_audit: 设置审计
 * - ai_metrics: AI 指标
 * - schema_migrations: 迁移记录
 */

const migration = {
  version: '20240101000000',
  description: '初始数据库架构',
  up: (db: any) => {
    // 用户表
    db.exec(
      "CREATE TABLE IF NOT EXISTS users (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  username TEXT NOT NULL UNIQUE," +
      "  password TEXT NOT NULL," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))" +
      ")"
    );

    // 学生表
    db.exec(
      "CREATE TABLE IF NOT EXISTS students (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  name TEXT NOT NULL," +
      "  grade TEXT NOT NULL," +
      "  subject TEXT NOT NULL," +
      "  phone TEXT," +
      "  notes TEXT," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 课后回访表
    db.exec(
      "CREATE TABLE IF NOT EXISTS followups (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  student_id INTEGER," +
      "  student_name TEXT NOT NULL," +
      "  grade TEXT NOT NULL," +
      "  subject TEXT NOT NULL," +
      "  topic TEXT NOT NULL," +
      "  performance TEXT NOT NULL," +
      "  mastery TEXT NOT NULL," +
      "  session_count INTEGER NOT NULL DEFAULT 1," +
      "  course_type TEXT NOT NULL DEFAULT 'one_on_one'," +
      "  module TEXT NOT NULL DEFAULT 'class_summary'," +
      "  images TEXT NOT NULL DEFAULT '[]'," +
      "  content TEXT NOT NULL," +
      "  word_count INTEGER NOT NULL DEFAULT 0," +
      "  batch_id TEXT," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE," +
      "  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL" +
      ")"
    );

    // 报告明细表
    db.exec(
      "CREATE TABLE IF NOT EXISTS report_items (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  report_id INTEGER NOT NULL," +
      "  kind TEXT NOT NULL," +
      "  seq INTEGER NOT NULL DEFAULT 0," +
      "  content TEXT NOT NULL DEFAULT ''," +
      "  type TEXT NOT NULL DEFAULT ''," +
      "  score TEXT NOT NULL DEFAULT ''," +
      "  difficulty TEXT NOT NULL DEFAULT ''," +
      "  scheduled_at TEXT NOT NULL DEFAULT ''," +
      "  attendance TEXT NOT NULL DEFAULT ''," +
      "  notes_done TEXT NOT NULL DEFAULT ''," +
      "  mistakes_done TEXT NOT NULL DEFAULT ''," +
      "  homework_done TEXT NOT NULL DEFAULT ''," +
      "  exam TEXT NOT NULL DEFAULT ''," +
      "  sort INTEGER NOT NULL DEFAULT 0," +
      "  course_id INTEGER," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE," +
      "  FOREIGN KEY (report_id) REFERENCES monthly_reports(id) ON DELETE CASCADE" +
      ")"
    );

    // 月度报告表
    db.exec(
      "CREATE TABLE IF NOT EXISTS monthly_reports (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  student_id INTEGER," +
      "  student_name TEXT NOT NULL," +
      "  year_month TEXT NOT NULL," +
      "  term TEXT NOT NULL," +
      "  grade TEXT," +
      "  subject TEXT," +
      "  summary_enabled INTEGER NOT NULL DEFAULT 1," +
      "  plan_enabled INTEGER NOT NULL DEFAULT 1," +
      "  summary_intro TEXT," +
      "  plan_intro TEXT," +
      "  farewell TEXT," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE," +
      "  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE" +
      ")"
    );

    // 听评课表
    db.exec(
      "CREATE TABLE IF NOT EXISTS observations (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  teacher_id INTEGER," +
      "  topic TEXT NOT NULL," +
      "  lesson_type TEXT NOT NULL DEFAULT 'other'," +
      "  observed_at TEXT," +
      "  grade TEXT," +
      "  subject TEXT," +
      "  level TEXT," +
      "  student_name TEXT," +
      "  class_notes TEXT NOT NULL DEFAULT ''," +
      "  report TEXT NOT NULL DEFAULT ''," +
      "  report_at TEXT," +
      "  overall_grade TEXT," +
      "  status TEXT NOT NULL DEFAULT 'draft'," +
      "  teacher_reply TEXT NOT NULL DEFAULT ''," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE," +
      "  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL" +
      ")"
    );

    // 老师表
    db.exec(
      "CREATE TABLE IF NOT EXISTS teachers (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  name TEXT NOT NULL," +
      "  subject TEXT," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 分组预设表
    db.exec(
      "CREATE TABLE IF NOT EXISTS groups (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  name TEXT NOT NULL," +
      "  student_ids TEXT NOT NULL DEFAULT '[]'," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 课程目录表
    db.exec(
      "CREATE TABLE IF NOT EXISTS course_catalog (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  import_id INTEGER," +
      "  band TEXT NOT NULL," +
      "  term TEXT NOT NULL," +
      "  grade TEXT NOT NULL," +
      "  subject TEXT NOT NULL," +
      "  track TEXT NOT NULL DEFAULT ''," +
      "  seq INTEGER NOT NULL DEFAULT 0," +
      "  content TEXT NOT NULL," +
      "  type TEXT NOT NULL DEFAULT ''," +
      "  score TEXT NOT NULL DEFAULT ''," +
      "  difficulty TEXT NOT NULL DEFAULT ''," +
      "  impact TEXT NOT NULL DEFAULT ''," +
      "  textbook TEXT NOT NULL DEFAULT ''," +
      "  section TEXT NOT NULL DEFAULT ''," +
      "  sheet TEXT NOT NULL DEFAULT ''," +
      "  source_row INTEGER NOT NULL DEFAULT 0," +
      "  mastery_star INTEGER," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE," +
      "  FOREIGN KEY (import_id) REFERENCES catalog_imports(id) ON DELETE SET NULL" +
      ")"
    );

    // 目录导入记录表
    db.exec(
      "CREATE TABLE IF NOT EXISTS catalog_imports (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  band TEXT NOT NULL," +
      "  filename TEXT NOT NULL," +
      "  file_sha256 TEXT NOT NULL," +
      "  courses_total INTEGER NOT NULL DEFAULT 0," +
      "  courses_imported INTEGER NOT NULL DEFAULT 0," +
      "  courses_duplicated INTEGER NOT NULL DEFAULT 0," +
      "  courses_updated INTEGER NOT NULL DEFAULT 0," +
      "  failed_sheets TEXT NOT NULL DEFAULT '[]'," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 回访草稿表
    db.exec(
      "CREATE TABLE IF NOT EXISTS drafts (" +
      "  user_id INTEGER PRIMARY KEY," +
      "  payload TEXT NOT NULL," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 听评课草稿表
    db.exec(
      "CREATE TABLE IF NOT EXISTS observation_drafts (" +
      "  user_id INTEGER NOT NULL," +
      "  observation_id INTEGER NOT NULL," +
      "  payload TEXT NOT NULL," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  PRIMARY KEY (user_id, observation_id)," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 草稿历史表
    db.exec(
      "CREATE TABLE IF NOT EXISTS draft_history (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  payload TEXT NOT NULL," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 用户设置表
    db.exec(
      "CREATE TABLE IF NOT EXISTS settings_user (" +
      "  user_id INTEGER NOT NULL," +
      "  key TEXT NOT NULL," +
      "  value TEXT NOT NULL," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  PRIMARY KEY (user_id, key)," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 设置审计表
    db.exec(
      "CREATE TABLE IF NOT EXISTS settings_audit (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  key TEXT NOT NULL," +
      "  old_value TEXT," +
      "  new_value TEXT," +
      "  changed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // AI 指标表
    db.exec(
      "CREATE TABLE IF NOT EXISTS ai_metrics (" +
      "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "  user_id INTEGER NOT NULL," +
      "  provider TEXT NOT NULL," +
      "  model TEXT NOT NULL," +
      "  endpoint TEXT NOT NULL," +
      "  prompt_tokens INTEGER NOT NULL DEFAULT 0," +
      "  completion_tokens INTEGER NOT NULL DEFAULT 0," +
      "  total_tokens INTEGER NOT NULL DEFAULT 0," +
      "  latency_ms INTEGER NOT NULL DEFAULT 0," +
      "  status TEXT NOT NULL," +
      "  error_message TEXT," +
      "  retry_count INTEGER NOT NULL DEFAULT 0," +
      "  word_count INTEGER," +
      "  word_range_min INTEGER," +
      "  word_range_max INTEGER," +
      "  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 迁移记录表（用于记录已应用的迁移）
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "  name TEXT PRIMARY KEY," +
      "  applied_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))" +
      ")"
    );

    // 索引
    db.exec("CREATE INDEX IF NOT EXISTS idx_followups_user ON followups(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_followups_student ON followups(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_followups_created ON followups(created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_followups_user_created_id ON followups(user_id, created_at DESC, id DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_followups_batch ON followups(batch_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_teachers_user ON teachers(user_id)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_user_name ON teachers(user_id, name)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_user ON observations(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_date ON observations(observed_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_ym ON monthly_reports(user_id, year_month)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("DROP INDEX IF EXISTS idx_course_catalog_user");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_filter ON course_catalog(grade, subject, term)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_content ON course_catalog(band, grade, subject, track, term, seq)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_import ON course_catalog(import_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)");

    // 进行中的回访草稿（跨设备实时同步的服务端副本，每人一份）
    db.exec(
      "CREATE TABLE IF NOT EXISTS drafts (" +
      "  user_id INTEGER PRIMARY KEY," +
      "  payload TEXT NOT NULL," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 进行中的听评课草稿（跨设备实时同步，按记录 ID 隔离）
    db.exec(
      "CREATE TABLE IF NOT EXISTS observation_drafts (" +
      "  user_id INTEGER NOT NULL," +
      "  observation_id INTEGER NOT NULL," +
      "  payload TEXT NOT NULL," +
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))," +
      "  PRIMARY KEY (user_id, observation_id)," +
      "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" +
      ")"
    );

    // 迁移记录表（用于记录已应用的迁移）
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "  name TEXT PRIMARY KEY," +
      "  applied_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))" +
      ")"
    );
  },

  down: (db: any) => {
    // 删除所有表（逆序）
    const tables = [
      "schema_migrations", "ai_metrics", "settings_audit", "settings_user",
      "draft_history", "observation_drafts", "drafts",
      "catalog_imports", "course_catalog",
      "groups", "teachers", "observations",
      "monthly_reports", "report_items", "followups",
      "students", "users"
    ];
    for (const table of tables) {
      db.exec("DROP TABLE IF EXISTS " + table);
    }
  },
  irreversible: false,
};

export default migration;