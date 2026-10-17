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
