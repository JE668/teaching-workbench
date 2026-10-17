import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';

let token = '';
let otherToken = '';
let teacherId = 0;

before(async () => {
  await startServer();
  token = await createUser('stats-a');
  otherToken = await createUser('stats-b');
});
after(async () => {
  await stopServer();
});

async function makeTeacher(name: string, subject?: string) {
  const r = await req('POST', '/api/teachers', { token, body: { name, subject } });
  assert.equal(r.status, 200);
  return r.body.teacher.id as number;
}
async function makeObs(overrides: Record<string, any> = {}) {
  const r = await req('POST', '/api/observations', { token, body: { topic: 'T', ...overrides } });
  assert.equal(r.status, 200);
  return r.body.observation.id as number;
}

describe('按被听课老师统计', () => {
  test('聚合听课次数 / 等级分布 / 最近听课 + 零次老师', async () => {
    teacherId = await makeTeacher('王老师', '数学');
    const idle = await makeTeacher('李老师'); // 无听课记录
    await makeObs({ teacherId, observedAt: '2026-10-01', overallGrade: 'excellent' });
    await makeObs({ teacherId, observedAt: '2026-10-15', overallGrade: 'pass' });
    await makeObs({ teacherId, observedAt: '2026-10-10' }); // 未评

    const r = await req('GET', '/api/observations/teacher-stats', { token });
    assert.equal(r.status, 200);
    const list = r.body.teachers as any[];
    const wang = list.find((x) => x.teacherId === teacherId);
    const li = list.find((x) => x.teacherId === idle);
    assert.ok(wang && li);
    assert.equal(wang.obsCount, 3);
    assert.equal(wang.grades.excellent, 1);
    assert.equal(wang.grades.pass, 1);
    assert.equal(wang.grades.ungraded, 1);
    assert.equal(wang.grades.good, 0);
    assert.equal(wang.lastObservedAt, '2026-10-15');
    assert.equal(li.obsCount, 0, '无记录的也应列出且次数为 0');
  });

  test('数据隔离：他人老师/记录不出现', async () => {
    const r = await req('GET', '/api/observations/teacher-stats', { token: otherToken });
    assert.equal(r.status, 200);
    const names = (r.body.teachers as any[]).map((x) => x.teacherName);
    assert.ok(!names.includes('王老师'), '统计不能跨用户');
    assert.equal(names.length, 0);
  });
});

describe('老师统计：老师 / 时间窗过滤', () => {
  test('按老师过滤只返回该老师及其记录', async () => {
    const t1 = await makeTeacher('张老师', '语文');
    const t2 = await makeTeacher('刘老师', '英语');
    await makeObs({ teacherId: t1, observedAt: '2026-10-20', overallGrade: 'good' });
    await makeObs({ teacherId: t1, observedAt: '2026-10-21', overallGrade: 'excellent' });
    await makeObs({ teacherId: t2, observedAt: '2026-10-22', overallGrade: 'pass' });

    const r = await req('GET', '/api/observations/teacher-stats?teacherId=' + t1, { token });
    assert.equal(r.status, 200);
    const list = r.body.teachers as any[];
    assert.equal(list.length, 1);
    assert.equal(list[0].teacherId, t1);
    assert.equal(list[0].teacherName, '张老师');
    assert.equal(list[0].obsCount, 2);
    assert.equal(list[0].grades.good, 1);
    assert.equal(list[0].grades.excellent, 1);
  });

  test('按时间窗过滤：只统计窗内记录，窗口外不计入', async () => {
    const t = await makeTeacher('陈老师', '数学');
    await makeObs({ teacherId: t, observedAt: '2026-09-01', overallGrade: 'excellent' });
    await makeObs({ teacherId: t, observedAt: '2026-10-12', overallGrade: 'good' });
    await makeObs({ teacherId: t, observedAt: '2026-10-16', overallGrade: 'pass' });

    const r = await req('GET', '/api/observations/teacher-stats?from=2026-10-01&to=2026-10-31', { token });
    assert.equal(r.status, 200);
    const row = (r.body.teachers as any[]).find((x) => x.teacherId === t);
    assert.ok(row, '窗口内有的老师要出现');
    assert.equal(row.obsCount, 2, '9 月那条不能算进来');
    assert.equal(row.grades.good, 1);
    assert.equal(row.grades.pass, 1);
    assert.equal(row.grades.excellent, 0);
    assert.equal(row.lastObservedAt, '2026-10-16');
  });

  test('时间窗内无记录的不出现在结果里', async () => {
    const t = await makeTeacher('孙老师');
    await makeObs({ teacherId: t, observedAt: '2026-01-05' });

    const r = await req('GET', '/api/observations/teacher-stats?from=2026-10-01&to=2026-10-31', { token });
    assert.ok(
      !(r.body.teachers as any[]).some((x) => x.teacherId === t),
      '窗口内没听课的老师不应占一行零记录'
    );
  });

  test('不传任何过滤时保持原行为（含零次老师）', async () => {
    const t = await makeTeacher('周老师'); // 无记录
    const r = await req('GET', '/api/observations/teacher-stats', { token });
    assert.ok((r.body.teachers as any[]).some((x) => x.teacherId === t && x.obsCount === 0));
  });
});

describe('回复闭环待办汇总', () => {
  test('pending / awaiting / replied 与 total 口径一致（回复优先）', async () => {
    // 本文件前面的用例会留下大量记录，所以取前后差值来断言
    const t = await makeTeacher('钱老师');
    const before = await req('GET', '/api/observations/reply-metrics', { token });
    const base = before.body;

    await makeObs({ teacherId: t, status: 'draft' }); // 待反馈
    await makeObs({ teacherId: t, status: 'sent' }); // 已反馈未回
    await makeObs({ teacherId: t, status: 'sent', teacherReply: '' }); // 空回复也算未回
    await makeObs({ teacherId: t, status: 'sent', teacherReply: '收到，我会改' }); // 已回
    await makeObs({ teacherId: t, status: 'draft', teacherReply: '已经改好' }); // 有回复 → 算已回，不算待反馈

    const after = await req('GET', '/api/observations/reply-metrics', { token });
    const delta = (k: string) => after.body[k] - base[k];
    assert.equal(delta('pending'), 1);
    assert.equal(delta('awaiting'), 2);
    assert.equal(delta('replied'), 2);
    assert.equal(delta('total'), 5);
    assert.equal(
      delta('pending') + delta('awaiting') + delta('replied'),
      delta('total'),
      '三桶互斥且相加等于总数'
    );
  });

  test('数据隔离：他人记录不计入', async () => {
    const r = await req('GET', '/api/observations/reply-metrics', { token: otherToken });
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.equal(r.body.pending + r.body.awaiting + r.body.replied, 0);
  });

  test('空数据返回全 0 而不是 null', async () => {
    const empty = await createUser('stats-empty');
    const r = await req('GET', '/api/observations/reply-metrics', { token: empty });
    assert.deepEqual(r.body, { pending: 0, awaiting: 0, replied: 0, total: 0 });
  });
});
