import './setup.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDatabase, migrateTimestampsUtcToLocal, SERVER_GENERATED_TIMES } from '../config/database.js';

const MARKER = '2026_10_18_shift_utc_to_beijing';
const HOUR = 3600 * 1000;

/** 把 YYYY-MM-DD HH:MM:SS 按 UTC 解析成毫秒（存的就是裸时间串，不带时区） */
function toMs(s: string): number {
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

function utcNowStr(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function resetMarker() {
  db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(MARKER);
}

/** 让整个库看起来像「旧版 UTC 容器」写出来的：所有时间戳回退 8 小时，
 * 再插一条当前 UTC 时间的记录，使 MAX 落在 UTC 区间，触发订正判定。 */
function makeDbUtcBased() {
  for (const [table, column] of SERVER_GENERATED_TIMES) {
    db.prepare('UPDATE ' + table + ' SET ' + column + " = datetime(" + column + ", '-8 hours')").run();
  }
  // INSERT OR REPLACE：同一测试文件里多个用例都会调这个函数，username 唯一约束会撞
  db.prepare("INSERT OR REPLACE INTO users (username, password, created_at) VALUES ('tz-probe', 'x', datetime('now'))").run();
  resetMarker();
}

function seedUser(username: string): number {
  const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, 'x');
  return Number(info.lastInsertRowid);
}

before(() => {
  initDatabase();
});

describe('时区迁移（UTC → 北京时间）', () => {
  test('库里存的是 UTC → 各表时间戳统一 +8 小时', () => {
    const before = utcNowStr();
    makeDbUtcBased();

    migrateTimestampsUtcToLocal();

    const row = db.prepare('SELECT created_at FROM users WHERE username = ?').get('tz-probe') as any;
    assert.ok(row, '探针记录应存在');
    const drift = toMs(row.created_at) - toMs(before);
    assert.ok(Math.abs(drift - 8 * HOUR) < 5000, '应偏移 8 小时，实际 ' + Math.round(drift / HOUR) + ' 小时');
  });

  test('已是北京时间的库 → 不重复偏移', () => {
    const uid = seedUser('tz-already-local');
    const before = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at;

    // 清掉标记后重跑：库里最新的记录是北京时间，判定应跳过
    resetMarker();
    migrateTimestampsUtcToLocal();

    const after = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at;
    assert.equal(after, before, '已是北京时间的记录不应被再次偏移');
  });

  test('标记留痕 → 只跑一次', () => {
    const uid = seedUser('tz-once');
    resetMarker();
    migrateTimestampsUtcToLocal();

    const once = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at;
    // 再跑一次，无论数据处于什么状态都不应再动
    migrateTimestampsUtcToLocal();
    const twice = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at;
    assert.equal(twice, once, '第二次运行不应改动任何数据');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?').get(MARKER) as any).n, 1);
  });

  test('observed_at 是用户手填的日期，绝不参与订正', () => {
    const uid = seedUser('tz-observed');
    db.prepare("INSERT INTO observations (user_id, topic, observed_at) VALUES (?, ?, '2026-10-17')").run(uid, '时区探针');
    makeDbUtcBased();

    migrateTimestampsUtcToLocal();

    const row = db.prepare('SELECT observed_at FROM observations WHERE topic = ?').get('时区探针') as any;
    assert.equal(row.observed_at, '2026-10-17', '用户手填的听课日期必须原样保留');
  });

  test('格式异常的值不会被 NULL 盖掉', () => {
    // 正常情况不会出现（服务端时间戳都由 datetime() 生成），但迁移不该赌这一点。
    // 用 '0000-00-00 00:00:00'：既会让 datetime() 返回 NULL，又比任何真实日期小，
    // 不会顶掉 MAX、干扰「库里是不是 UTC」的自动判定。
    const uid = seedUser('tz-bad-format');
    makeDbUtcBased();
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run('0000-00-00 00:00:00', uid);

    migrateTimestampsUtcToLocal();

    const row = db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any;
    assert.equal(row.created_at, '0000-00-00 00:00:00', '无法解析的值必须原样保留');
  });

  test('MIGRATE_TZ_FORCE=1 强制订正（数据太旧无法判定时兜底）', () => {
    const uid = seedUser('tz-force');
    // 手工写一条 30 天前的 UTC 时间：skew 远超 12 小时，自动判定会跳过
    db.prepare('UPDATE users SET created_at = datetime(created_at, \'-8 hours\', \'-30 days\') WHERE id = ?').run(uid);
    const before = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at;
    resetMarker();

    const old = process.env.MIGRATE_TZ_FORCE;
    process.env.MIGRATE_TZ_FORCE = '1';
    try {
      migrateTimestampsUtcToLocal();
    } finally {
      if (old === undefined) delete process.env.MIGRATE_TZ_FORCE;
      else process.env.MIGRATE_TZ_FORCE = old;
    }

    const after = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at;
    assert.notEqual(after, before, '强制模式应无条件偏移');
    assert.ok(Math.abs(toMs(after) - toMs(before) - 8 * HOUR) < 5000, '强制偏移应正好 8 小时');
  });
});

describe('新增时间戳的时区正确性', () => {
  test('INSERT 默认值写入的是北京时间，不是 UTC', () => {
    const uid = seedUser('tz-insert');
    const stored = (db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid) as any).created_at as string;

    // 与当前北京时间比较，而不是与 UTC 比较
    const storedAsLocalMs = Date.parse(stored.replace(' ', 'T'));
    const diff = Math.abs(Date.now() - storedAsLocalMs);
    assert.ok(diff < 60 * 1000, '存的时间应与北京时间一致，偏差 ' + Math.round(diff / 1000) + ' 秒');

    // 反向校验：把北京时间当 UTC 解析，应超前 8 小时
    const asUtcMs = toMs(stored);
    assert.ok(Math.abs(asUtcMs - Date.now() - 8 * HOUR) < 60 * 1000, '按 UTC 解析应超前 8 小时');
  });

  test('datetime 多修饰符写法仍然可用（待回访的天数窗口）', () => {
    const sixDaysAgo = db.prepare("SELECT datetime('now', '+8 hours', '-6 days') AS d").get() as any;
    assert.match(sixDaysAgo.d, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const dayAgo = db.prepare("SELECT datetime('now', '+8 hours', '-1 day') AS d").get() as any;
    // '-1 day' 比 '-6 days' 更晚：待回访窗口靠这个大小关系判断
    assert.ok(toMs(dayAgo.d) > toMs(sixDaysAgo.d), '天数越小的偏移越靠近当前');
  });
});
