import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { env } from './env.js';
import { log } from '../utils/logger.js';

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
  log.info({ table, column, default: definition }, '数据库迁移：添加列');
}

/**
 * 建索引；如果同名索引已经存在但**列组成不同**，先删掉再按新列重建。
 *
 * 用途：#40 把课程目录改成全局共享后，`courseFilter` 不再带 `user_id`，
 * 一批 `user_id` 打头的旧索引就全成了死索引 —— 查询用不上，但每次写入
 * （尤其是批量灌 3589 条内置目录）都要白更新几棵 B-tree。
 * 这里复用旧索引名、按新列重建，幂等且能自愈，不用留一次性迁移标记。
 */
function ensureIndexShape(name: string, table: string, columns: string[]): void {
  const existing = (db.prepare('PRAGMA index_info(' + name + ')').all() as any[]).map(
    (c) => c.name
  );
  if (existing.join(',') === columns.join(',')) return;
  db.exec('DROP INDEX IF EXISTS ' + name);
  db.exec('CREATE INDEX IF NOT EXISTS ' + name + ' ON ' + table + '(' + columns.join(',') + ')');
  log.info({ name, table, columns }, '数据库迁移：调整索引列组成');
}

/**
 * 存量数据时区订正（一次性迁移）。
 *
 * 事故：SQLite 的 datetime('now','localtime') 依赖容器时区，而 Docker 默认时区是 UTC，
 * 于是线上库里所有时间戳都存成了 UTC —— 界面上比真实时间慢 8 小时。
 * 本地开发跑在 macOS 上时区正确，所以本地完全看不出这个问题。
 *
 * 现在所有写入都改成显式 '+8 hours'，不再依赖容器时区；
 * 这个迁移负责把旧库里已经写坏的存量数据补回来。
 *
 * 三重保护，避免误伤：
 *   1) schema_migrations 留痕 —— 只跑一次
 *   2) 自动判定 —— 只有能确认库里存的是 UTC 才动手；已经是对的库直接跳过
 *   3) MIGRATE_TZ_FORCE=1 强制执行 —— 数据太旧无法判定时用这个兜底
 */
const TZ_FIX_VERSION = '2026_10_18_shift_utc_to_beijing';

/** 需要订正的列：只含服务端自动生成的时间戳。
 * 注意 observations.observed_at 是用户手填的日期，绝不能挪。 */
export const SERVER_GENERATED_TIMES: Array<[string, string]> = [
  ['users', 'created_at'],
  ['students', 'created_at'],
  ['students', 'updated_at'],
  ['followups', 'created_at'],
  ['followups', 'updated_at'],
  ['drafts', 'updated_at'],
  ['settings_user', 'updated_at'],
  ['groups', 'created_at'],
  ['teachers', 'created_at'],
  ['observations', 'created_at'],
  ['observations', 'updated_at'],
  ['observations', 'report_at'],
];

/** 库里存的最新时间戳，相对「当前 UTC 时刻」的偏差（毫秒）。
 * 存的是 UTC → 偏差点（刚写过的记录几乎为 0）
 * 存的是北京时间 → 负 8 小时（把北京时间当 UTC 解析会超前 8 小时） */
function latestUtcSkewMs(): number | null {
  let latest: string | null = null;
  for (const [table, column] of SERVER_GENERATED_TIMES) {
    const row = db.prepare('SELECT MAX(' + column + ") AS m FROM " + table).get() as any;
    const m = row?.m ? String(row.m) : null;
    if (m && (!latest || m > latest)) latest = m;
  }
  if (!latest) return null; // 空库，无需订正

  const asUtc = Date.parse(latest.replace(' ', 'T') + 'Z');
  if (Number.isNaN(asUtc)) return null;
  return Date.now() - asUtc;
}

export function migrateTimestampsUtcToLocal(): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

  if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(TZ_FIX_VERSION)) {
    return;
  }

  const skew = latestUtcSkewMs();
  // 判定门槛：偏差在 0~12 小时之间才认定「库里是 UTC」。
  // 超过 12 小时说明最后一条记录太旧，无法和「本地库 + 长时间未使用」区分，宁可不动。
  const shift = process.env.MIGRATE_TZ_FORCE === '1' || (skew !== null && skew >= 0 && skew < 12 * 3600 * 1000);

  if (!shift) {
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run(TZ_FIX_VERSION);
    log.info({ skewMs: skew, forced: process.env.MIGRATE_TZ_FORCE }, '时区迁移：库内时间戳已是北京时间，跳过订正');
    return;
  }

  let rows = 0;
  const tx = db.transaction(() => {
    for (const [table, column] of SERVER_GENERATED_TIMES) {
      const info = db
        .prepare(
          'UPDATE ' + table + ' SET ' + column +
            " = datetime(" + column + ", '+8 hours')" +
            " WHERE " + column + ' IS NOT NULL AND ' + column + " != ''" +
            // datetime() 解析不了会返回 NULL，不能拿 NULL 把原值盖掉
            " AND datetime(" + column + ", '+8 hours') IS NOT NULL"
        )
        .run();
      rows += info.changes;
    }
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run(TZ_FIX_VERSION);
  });
  tx();
  log.warn({ rows, skewMs: skew, forced: process.env.MIGRATE_TZ_FORCE === '1' }, '时区迁移：已把存量时间戳从 UTC 订正为北京时间');
}

// 初始化表结构
/**
 * 全局 settings → per-user 的一次性迁移。
 *
 * 旧版 settings 表（key 全局唯一）是全机构共用一份配置；改成按账号独立后，
 * 首次启动把旧值复制给每一个已有账号，每人一份起点相同的副本，之后各自演化。
 * 拷贝完成后旧表重命名为 settings_global_backup 留档（幂等：改名后不再进这个分支）。
 */
function migrateSettingsPerUser(): void {
  const hasLegacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
    .get();
  if (!hasLegacy) return;

  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
    if (rows.length > 0) {
      const users = db.prepare('SELECT id FROM users').all() as any[];
      const insert = db.prepare(
        `INSERT OR IGNORE INTO settings_user (user_id, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now', '+8 hours'))`
      );
      const copy = db.transaction(() => {
        for (const u of users) {
          for (const r of rows) insert.run(u.id, r.key, r.value);
        }
      });
      copy();
    }
    // 留档 + 幂等标记：改名后上面的 hasLegacy 检测不再命中
    db.exec('ALTER TABLE settings RENAME TO settings_global_backup');
  } catch (err: any) {
    console.warn('[MIGRATE] settings → settings_user 迁移失败: ' + err.message);
  }
}

export function initDatabase() {
  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      preferences TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
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
      module TEXT NOT NULL DEFAULT 'class_summary',
      images TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
    )
  `);

  // 创建默认管理员账号
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get(env.DEFAULT_ADMIN_USER);
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync(env.DEFAULT_ADMIN_PASS, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(env.DEFAULT_ADMIN_USER, hashedPassword);
    log.warn({ user: env.DEFAULT_ADMIN_USER }, '默认管理员已创建（弱口令，请尽快在 .env 中修改 DEFAULT_ADMIN_PASS）');
  }

  // 进行中的回访草稿（跨设备实时同步的服务端副本，每人一份）
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      user_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 进行中的听评课草稿（跨设备实时同步，按记录 ID 隔离）
  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_drafts (
      user_id INTEGER NOT NULL,
      observation_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      PRIMARY KEY (user_id, observation_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE
    )
  `);

  // 应用级设置（可在前端设置页修改，覆盖 .env 的默认值）。
  // per-user：每个账号一份独立配置（AI 服务商/模型/Key 各自管理）。
  // 旧版是全局单份（settings 表），首次启动由 migrateSettingsPerUser 拆给所有账号。
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings_user (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      PRIMARY KEY (user_id, key)
    )
  `);

  // 小组课分组预设（如"周六上午三年级班"）
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      student_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 被听课老师（听评课模块用；下拉选择、可统计"评过哪些老师"）
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      subject TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 听评课记录（独立于课后回访）
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      teacher_id INTEGER,
      topic TEXT NOT NULL,
      lesson_type TEXT NOT NULL DEFAULT 'other',
      observed_at TEXT,
      grade TEXT,
      subject TEXT,
      level TEXT,
      student_name TEXT,
      class_notes TEXT NOT NULL DEFAULT '',
      report TEXT NOT NULL DEFAULT '',
      report_at TEXT,
      overall_grade TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      teacher_reply TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
    )
  `);

  // 全年课程体系目录（从老师维护的 Excel 批量导入，供课程总结/课程规划取数）
  // 一次导入 = 一行 catalog_imports，导入的课程明细挂在 course_catalog.import_id 上
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      band TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      courses_total INTEGER NOT NULL DEFAULT 0,
      courses_imported INTEGER NOT NULL DEFAULT 0,
      courses_duplicated INTEGER NOT NULL DEFAULT 0,
      failed_sheets TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS course_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      import_id INTEGER,
      band TEXT NOT NULL,
      term TEXT NOT NULL,
      grade TEXT NOT NULL,
      subject TEXT NOT NULL,
      track TEXT NOT NULL DEFAULT '',
      seq INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      score TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      impact TEXT NOT NULL DEFAULT '',
      textbook TEXT NOT NULL DEFAULT '',
      section TEXT NOT NULL DEFAULT '',
      sheet TEXT NOT NULL DEFAULT '',
      source_row INTEGER NOT NULL DEFAULT 0,
      -- 掌握星级：AI 先给一档，用户可手改
      mastery_star INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (import_id) REFERENCES catalog_imports(id) ON DELETE SET NULL
    )
  `);

  // 月度总结与课程规划。
  // 一条 monthly_reports = 一个学生一个月的「总结 + 规划」两块内容；
  // 明细行放 report_items，kind 区分：summary（已上的课，带出勤/笔记/错题/作业/考试）、
  // plan（下月要上的课，只有课程属性 + 计划上课时间）、exam（阶测安排，插在规划中间）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      year_month TEXT NOT NULL,
      term TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      summary_enabled INTEGER NOT NULL DEFAULT 1,
      plan_enabled INTEGER NOT NULL DEFAULT 1,
      summary_intro TEXT NOT NULL DEFAULT '',
      plan_intro TEXT NOT NULL DEFAULT '',
      farewell TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      score TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT NOT NULL DEFAULT '',
      attendance TEXT NOT NULL DEFAULT '',
      notes_done TEXT NOT NULL DEFAULT '',
      mistakes_done TEXT NOT NULL DEFAULT '',
      homework_done TEXT NOT NULL DEFAULT '',
      exam TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES monthly_reports(id) ON DELETE CASCADE
    )
  `);

  // ========== 增量迁移 ==========
  // CREATE TABLE IF NOT EXISTS 不会给已存在的表补字段，因此需要显式检查。
  ensureColumn('users', 'preferences', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('followups', 'session_count', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('followups', 'course_type', "TEXT NOT NULL DEFAULT 'one_on_one'");
  // 流程打卡类型（常规类 / 非常规类）；存量记录归到「课堂总结」
  ensureColumn('followups', 'module', "TEXT NOT NULL DEFAULT 'class_summary'");
  // 小组课批量一致性：同一次小组课拆出的 N 条记录共享一个 batch_id，
  // 编辑时可同步更新整批，避免 8 人里 1 条和其余不一致。
  ensureColumn('followups', 'batch_id', 'TEXT');

  // 目录 ↔ 报告打通：从课程目录取课时记下来源课程，
  // 于是目录里能看出「这门课已经给几个学生上过了 / 计划给几个学生上」。
  // 允许为空 —— 手输的课程内容没有对应目录条目。
  ensureColumn('report_items', 'course_id', 'INTEGER');
  // 听评课记录关联到的目录课时（可空：课题手输、目录里查不到时留空）
  ensureColumn('observations', 'course_id', 'INTEGER');

  // 内置课程目录标记：机构级参考数据随镜像发版，所有账号共享，不能被删除
  ensureColumn('catalog_imports', 'is_builtin', 'INTEGER NOT NULL DEFAULT 0');

  // 创建索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id)');

  // 存量数据时区订正（一次性）
  migrateTimestampsUtcToLocal();

  // 全局 settings → per-user：一次性把旧表拆给所有账号，每人一份独立副本
  migrateSettingsPerUser();
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_user ON followups(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_student ON followups(student_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_created ON followups(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_batch ON followups(batch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_teachers_user ON teachers(user_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_user_name ON teachers(user_id, name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_observations_user ON observations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_observations_date ON observations(observed_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_imports_user ON catalog_imports(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_imports_sha ON catalog_imports(user_id, file_sha256)');
  // 目录 #40 后全局共享，courseFilter 不带 user_id：旧的 user_id 打头索引全是死索引
  // （查询用不上，批量灌内置目录时每条还要白更新几棵 B-tree）。这里按新口径重建。
  db.exec('DROP INDEX IF EXISTS idx_course_catalog_user');
  ensureIndexShape('idx_course_catalog_filter', 'course_catalog', ['grade', 'subject', 'term']);
  ensureIndexShape('idx_course_catalog_content', 'course_catalog', [
    'band',
    'grade',
    'subject',
    'track',
    'term',
    'seq',
  ]);
  // 目录改为全局共享后，导入去重不再按 user_id 圈范围，单独建一个不带 user_id 的索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_course_catalog_dedupe ON course_catalog(band, grade, subject, track, term, seq, content)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_reports_user ON monthly_reports(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_reports_student ON monthly_reports(user_id, student_id, year_month DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id, sort)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_report_items_user ON report_items(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_report_items_course ON report_items(user_id, course_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_observations_course ON observations(user_id, course_id)');
}
