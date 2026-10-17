import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';

let token = '';
let otherToken = '';

before(async () => {
  await startServer();
  token = await createUser('last-teacher');
});
after(async () => {
  await stopServer();
});

test('GET /followups/last 返回该学生最近一条回访', async () => {
  const student = await createStudent(token, { name: '张三', grade: '小学三年级', subject: '数学' });
  await createFollowUp(token, {
    studentId: student.id,
    studentName: '张三',
    topic: '第一次：加法',
    mastery: 'good',
  });
  // 同秒内连建两条，id 更大者为"最近"
  await createFollowUp(token, {
    studentId: student.id,
    studentName: '张三',
    topic: '第二次：减法',
    mastery: 'excellent',
  });

  const res = await req('GET', '/api/followups/last?studentId=' + student.id, { token });
  assert.equal(res.status, 200);
  assert.ok(res.body.followup);
  assert.equal(res.body.followup.topic, '第二次：减法');
  assert.equal(res.body.followup.mastery, 'excellent');
  assert.ok(res.body.followup.createdAt);
});

test('GET /followups/last 没有历史时返回 followup: null', async () => {
  const student = await createStudent(token, { name: '李四' });
  const res = await req('GET', '/api/followups/last?studentId=' + student.id, { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.followup, null);
});

test('GET /followups/last 取不到他人学生名下的回访（数据隔离）', async () => {
  otherToken = await createUser('last-other');
  const mine = await createStudent(token, { name: '我的学生' });
  await createFollowUp(token, { studentId: mine.id, studentName: '我的学生' });

  // 另一个用户拿同一个 studentId 查询：其名下没有该学生的回访
  const res = await req('GET', '/api/followups/last?studentId=' + mine.id, { token: otherToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.followup, null);
});

test('GET /followups/last 缺 studentId 返回 400', async () => {
  const res = await req('GET', '/api/followups/last', { token });
  assert.equal(res.status, 400);
});
