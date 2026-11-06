/**
 * 20240101010000 - 时区修正迁移
 * 
 * 将存量 UTC 时间戳修正为北京时间（+8 小时）
 * 仅在检测到库内时间戳为 UTC 时执行
 */
import type { Migration } from './runner.js';

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

function latestUtcSkewMs(db: any): number | null {
  for (const [table, column] of SERVER_GENERATED_TIMES) {
    try {
      const row = db.prepare(`SELECT MAX(${column}) AS max_val FROM ${table}`).get();
      if (row?.max_val) {
        const utcTime = new Date(row.max_val + 'Z').getTime();
        const localTime = new Date(row.max_val).getTime();
        const skew = localTime - utcTime;
        if (skew !== 0) return skew;
      }
    } catch {}
  }
  return null;
}

const migration = {
  version: '20240101010000',
  description: '时区修正 - UTC 转北京时间',
  up: (db: any) => {
    const TZ_FIX_VERSION = 'tz_fix_v1';
    
    // 检查是否已应用
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get('tz_fix_v1')) {
      console.log('时区迁移：已应用，跳过');
      return;
    }

    // 计算偏移
    let skew = 0;
    for (const [table, column] of SERVER_GENERATED_TIMES) {
      try {
        const row = db.prepare(`SELECT MAX(${column}) AS max_val FROM ${table}`).get();
        if (row?.max_val) {
          const utcTime = new Date(row.max_val + 'Z').getTime();
          const localTime = new Date(row.max_val).getTime();
          const skewMs = localTime - utcTime;
          if (skewMs !== 0) {
            skew = skewMs;
            break;
          }
        }
      } catch {}
    }

    // 判定门槛：偏差在 0~12 小时之间才认定「库里是 UTC」
    const shift = skew >= 0 && skew < 12 * 3600 * 1000;

    if (!shift) {
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run('tz_fix_v1');
      console.log('时区迁移：库内时间戳已是北京时间，跳过订正');
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
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime(\'now\', \'+8 hours\'))').run('tz_fix_v1');
    });
    tx();
    console.log(`时区迁移：已把存量时间戳从 UTC 订正为北京时间，影响 ${rows} 行`);
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
      db.prepare('DELETE FROM schema_migrations WHERE name = ?').run('tz_fix_v1');
    });
    tx();
    console.log('时区迁移：已回滚，时间戳减去 8 小时');
  },
  irreversible: false,
};

export default migration;