/**
 * 20240101010000 - 时区修正迁移
 *
 * 将存量 UTC 时间戳修正为北京时间（+8 小时）
 * 仅在检测到库内时间戳为 UTC 时执行
 *
 * 【关键】偏差判定必须与进程时区无关：旧实现用 `new Date(s) - new Date(s + 'Z')`
 * 依赖 Node 进程的本地时区 —— 北京时区下碰巧正确（-8h → 跳过），但 UTC 容器/CI
 * 上 skew=0 会落进判定窗口，把已是北京时间的全表数据再 +8 小时（数据损坏）。
 * 现在与 config/database.ts 的 latestUtcSkewMs() 同源：用 SQLite 自己的
 * `datetime('now','+8 hours')` 与库内时间戳做差，判定窗口取 [4h, 12h)。
 */

const SERVER_GENERATED_TIMES: [string, string][] = [
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

const TZ_FIX_VERSION = 'tz_fix_v1';

/**
 * 库内最新时间戳落后「此刻北京时间」多少毫秒。
 * 存的是北京时间 → 接近 0 或小的正数（闲置偏移）；
 * 存的是 UTC → 约 +8 小时。两边基准都来自同一 SQLite 连接，与进程时区无关。
 */
function latestUtcSkewMs(db: any): number | null {
  let latest: string | null = null;
  for (const [table, column] of SERVER_GENERATED_TIMES) {
    try {
      const row = db.prepare(`SELECT MAX(${column}) AS max_val FROM ${table}`).get();
      const m = row?.max_val ? String(row.max_val) : null;
      if (m && (!latest || m > latest)) latest = m;
    } catch {}
  }
  if (!latest) return null; // 空库，无需订正

  const asUtc = Date.parse(latest.replace(' ', 'T') + 'Z');
  if (Number.isNaN(asUtc)) return null;

  const nowRow = db.prepare("SELECT datetime('now', '+8 hours') AS n").get();
  if (!nowRow?.n) return null;
  const beijingNow = Date.parse(String(nowRow.n).replace(' ', 'T') + 'Z');
  if (Number.isNaN(beijingNow)) return null;

  return beijingNow - asUtc;
}

/** 判定门槛：明显落后 4h 以上、又没旧到无法与「闲置很久」区分（12h 内）才认「存的是 UTC」 */
function shouldShift(skew: number | null): boolean {
  if (skew === null) return false;
  const SHIFT_MIN_MS = 4 * 3600 * 1000;
  const SHIFT_MAX_MS = 12 * 3600 * 1000;
  return skew >= SHIFT_MIN_MS && skew < SHIFT_MAX_MS;
}

const migration = {
  version: '20240101010000',
  description: '时区修正 - UTC 转北京时间',
  up: (db: any) => {
    // 检查是否已应用（database.ts 的 migrateTimestampsUtcToLocal 共用同一标记，
    // 两边谁先谁后都不会叠加平移）
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(TZ_FIX_VERSION)) {
      return;
    }

    const skew = latestUtcSkewMs(db);

    if (!shouldShift(skew)) {
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run(TZ_FIX_VERSION);
      return;
    }

    let rows = 0;
    const tx = db.transaction(() => {
      for (const [table, column] of SERVER_GENERATED_TIMES) {
        const info = db.prepare(
          `UPDATE ${table} SET ${column} = datetime(${column}, '+8 hours')` +
          ` WHERE ${column} IS NOT NULL AND ${column} != ''` +
          ` AND datetime(${column}, '+8 hours') IS NOT NULL`
        ).run();
        rows += info.changes;
      }
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run(TZ_FIX_VERSION);
    });
    tx();
    console.log(`时区迁移：已把存量时间戳从 UTC 订正为北京时间，影响 ${rows} 行（skew=${skew}ms）`);
  },

  down: (db: any) => {
    // 回滚：减去 8 小时
    const tx = db.transaction(() => {
      for (const [table, column] of SERVER_GENERATED_TIMES) {
        db.prepare(
          `UPDATE ${table} SET ${column} = datetime(${column}, '-8 hours')` +
          ` WHERE ${column} IS NOT NULL AND ${column} != ''` +
          ` AND datetime(${column}, '-8 hours') IS NOT NULL`
        ).run();
      }
      db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(TZ_FIX_VERSION);
    });
    tx();
    console.log('时区迁移：已回滚，时间戳减去 8 小时');
  },
  irreversible: false,
};

export default migration;