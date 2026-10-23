import './setup.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database.js';
import { startServer, stopServer, req, createUser } from './helpers.js';
import { FOLLOWUP_TYPES, WEEKLY_FOLLOWUP_QUOTA } from '../utils/mappers.js';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 北京时间串。数据库时间列存的是 datetime('now', '+8 hours') 的裸时间串，
 * 因此这里也用「本地日期 + 小时」拼串，与生产写入保持一致。
 * dayOffset 相对本周一 00:00 偏移天数，-1 即上周日。
 */
function at(dayOffset: number, hour = 10): string {
  const now = new Date();
  const sinceMonday = (now.getDay() + 6) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday + dayOffset);
  d.setHours(hour);
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  );
}

const ISO = (dayOffset: number) => at(dayOffset).slice(0, 10);

let token = '';
let userId = 0;

before(async () => {
  await startServer();
  token = await createUser('followup-weekly-teacher');
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get('followup-weekly-teacher') as any;
  userId = Number(row.id);
});

after(async () => {
  await stopServer();
});

/** 清空本用户的历史记录，避免用例之间互相污染 */
function reset(): void {
  db.prepare('DELETE FROM followups WHERE user_id = ?').run(userId);
}

/** 直插一条回访（需要精确控制 created_at，走 API 做不到） */
function seed(module: string, dayOffset: number, hour = 10): void {
  const ts = at(dayOffset, hour);
  db.prepare(
    `INSERT INTO followups (user_id, student_name, grade, subject, topic, performance, mastery,
                            module, content, word_count, created_at, updated_at)
     VALUES (?, '周测', '小学五年级', '数学', '课题', '专注', 'good', ?, '内容', 100, ?, ?)`
  ).run(userId, module, ts, ts);
}

async function weekly(): Promise<any> {
  const res = await req('GET', '/api/followups/stats', { token });
  assert.equal(res.status, 200);
  return res.body.weekly;
}

describe('本周流程打卡进度 · 口径', () => {
  test('没有记录时 covered 为 0，quota 固定是 5 种', async () => {
    reset();
    const w = await weekly();
    assert.equal(w.quota, WEEKLY_FOLLOWUP_QUOTA);
    assert.equal(WEEKLY_FOLLOWUP_QUOTA, 5);
    assert.equal(w.covered, 0);
    assert.equal(w.records, 0);
    assert.equal(w.types.length, FOLLOWUP_TYPES.length);
    assert.ok(w.types.every((t: any) => t.count === 0), '没有任何记录，每个类型的条数都该是 0');
  });

  test('同一种类型打三次只算覆盖 1 种，不按条数计', async () => {
    reset();
    seed('class_summary', 0);
    seed('class_summary', 1);
    seed('class_summary', 2);
    const w = await weekly();
    assert.equal(w.covered, 1, '三次课堂总结只覆盖 1 种类型');
    assert.equal(w.records, 3, '但打卡条数照实记 3 条');
    assert.equal(w.types.find((t: any) => t.value === 'class_summary').count, 3);
  });

  test('任意 5 种类型各打一次即为达标', async () => {
    reset();
    seed('class_summary', 0);
    seed('homework_review', 1);
    seed('preview', 2);
    seed('note_trace', 3);
    seed('mistake_drill', 4);
    const w = await weekly();
    assert.equal(w.covered, 5);
    assert.equal(w.records, 5);
    assert.ok(w.covered >= w.quota, '覆盖 5 种应达标');
  });

  test('只打 4 种不达标，但非常规类同样计入覆盖种类', async () => {
    reset();
    seed('class_summary', 0);
    seed('homework_review', 1);
    seed('preview', 2);
    seed('note_trace', 3);
    const w4 = await weekly();
    assert.equal(w4.covered, 4, '4 种覆盖不了 5 种的配额');
    assert.ok(w4.covered < w4.quota, '4 种不应达标');

    // 再补 1 条非常规类（阶测反馈），5 种覆盖即达标——两组合并统计
    seed('stage_test', 4);
    const w = await weekly();
    assert.equal(w.covered, 5, '非常规类也计入覆盖种类');
    assert.equal(w.records, 5);
    assert.ok(w.covered >= w.quota, '5 种覆盖应达标');
    const stage = w.types.find((t: any) => t.value === 'stage_test');
    assert.equal(stage.count, 1);
    assert.equal(stage.group, 'unusual');
  });
});

describe('本周流程打卡进度 · 周界', () => {
  test('weekStart / weekEnd 是本北京周一到周日', async () => {
    reset();
    const w = await weekly();
    assert.equal(w.weekStart, ISO(0));
    assert.equal(w.weekEnd, ISO(6));
    // 周一到周日必须是连续的 7 天
    const start = new Date(w.weekStart + 'T00:00:00').getTime();
    const end = new Date(w.weekEnd + 'T00:00:00').getTime();
    assert.equal(end - start, 6 * 24 * 3600 * 1000);
  });

  test('上周的记录不计入本周，即使上周日在打', async () => {
    reset();
    seed('class_summary', -1, 23);
    seed('homework_review', -3);
    const w = await weekly();
    assert.equal(w.covered, 0);
    assert.equal(w.records, 0);
  });

  test('本周一 00:00 与本周日 23:59 都算本周', async () => {
    reset();
    seed('class_summary', 0, 0);
    seed('homework_review', 6, 23);
    seed('preview', 7); // 下一周周一，不算
    const w = await weekly();
    assert.equal(w.covered, 2);
    assert.equal(w.records, 2);
  });

  test('存量记录没有 module 列时归入课堂总结再计数', async () => {
    reset();
    seed('乱写的值', 0);
    const w = await weekly();
    assert.equal(w.covered, 1);
    assert.equal(w.types.find((t: any) => t.value === 'class_summary').count, 1);
  });
});
