import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent } from './helpers.js';

let token = '';
let s1: any;
let s2: any;

const GROUP_BODY = (over: Record<string, any> = {}) => ({
  grade: '小学三年级',
  subject: '数学',
  topic: '分数加减法',
  performance: '整体专注度高',
  mastery: 'good',
  content:
    '【课堂内容】本节课讲了分数加减法。' +
    '【学生收获】同学们整体进步明显。' +
    '【课后任务】完成练习册第10页。',
  courseType: 'group',
  studentIds: [s1.id, s2.id],
  images: [],
  ...over,
});

before(async () => {
  await startServer();
  token = await createUser('batch-teacher');
  s1 = await createStudent(token, { name: '甲', grade: '小学三年级', subject: '数学' });
  s2 = await createStudent(token, { name: '乙', grade: '小学三年级', subject: '数学' });
});
after(async () => {
  await stopServer();
});

test('小组课创建为每个学生各存一条，且共享同一 batch_id', async () => {
  const res = await req('POST', '/api/followups', { token, body: GROUP_BODY() });
  assert.equal(res.status, 200);
  assert.equal(res.body.created, 2);
  assert.ok(res.body.batchId, '应返回 batchId');

  // 两条记录的 batchId 相同
  const a = await req('GET', '/api/followups/' + res.body.followups[0].id, { token });
  const b = await req('GET', '/api/followups/' + res.body.followups[1].id, { token });
  assert.equal(a.body.followup.batchId, res.body.batchId);
  assert.equal(b.body.followup.batchId, res.body.batchId);
  assert.equal(a.body.followup.batchId, b.body.followup.batchId);
});

test('1对1 创建 batch_id 为 null', async () => {
  const res = await req('POST', '/api/followups', {
    token,
    body: {
      studentId: s1.id,
      studentName: '甲',
      grade: '小学三年级',
      subject: '数学',
      topic: '一对一主题',
      performance: '表现好',
      mastery: 'good',
      content: '【课堂内容】x【学生收获】y【课后任务】z',
      images: [],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.followup.batchId, null);
});

test('GET /:id/batch 返回整批成员', async () => {
  const create = await req('POST', '/api/followups', { token, body: GROUP_BODY() });
  const id = create.body.followups[0].id;
  const res = await req('GET', '/api/followups/' + id + '/batch', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.batch.size, 2);
  assert.equal(res.body.batch.id, create.body.batchId);
  assert.equal(res.body.batch.followups.length, 2);
});

test('GET /:id/batch 对 1对1 返回 null', async () => {
  const one = await req('POST', '/api/followups', {
    token,
    body: {
      studentId: s1.id,
      studentName: '甲',
      grade: '小学三年级',
      subject: '数学',
      topic: 't',
      performance: 'p',
      mastery: 'good',
      content: '【课堂内容】a【学生收获】b【课后任务】c',
      images: [],
    },
  });
  const res = await req('GET', '/api/followups/' + one.body.followup.id + '/batch', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.batch, null);
});

test('PUT syncBatch=true 同步更新整批，各条 student 不变', async () => {
  const create = await req('POST', '/api/followups', { token, body: GROUP_BODY() });
  const id = create.body.followups[0].id;
  const other = create.body.followups[1].id;

  const up = await req('PUT', '/api/followups/' + id, {
    token,
    body: { topic: '改后主题', syncBatch: true },
  });
  assert.equal(up.status, 200);
  assert.equal(up.body.batchSynced, 2, '应同步 2 条');

  // 两条的 topic 都变了，但各自 student 保持不同
  const a = await req('GET', '/api/followups/' + id, { token });
  const b = await req('GET', '/api/followups/' + other, { token });
  assert.equal(a.body.followup.topic, '改后主题');
  assert.equal(b.body.followup.topic, '改后主题');
  // 同步只改共享字段；两条仍保持各自不同的学生（不串号）
  assert.notEqual(a.body.followup.studentName, b.body.followup.studentName);
  // 两条的 batchId 仍一致
  assert.equal(a.body.followup.batchId, b.body.followup.batchId);
});

test('PUT 不传 syncBatch 时只改当前一条（不破坏整批）', async () => {
  const create = await req('POST', '/api/followups', { token, body: GROUP_BODY() });
  const id = create.body.followups[0].id;
  const other = create.body.followups[1].id;

  await req('PUT', '/api/followups/' + id, { token, body: { topic: '只改我这条' } });

  const a = await req('GET', '/api/followups/' + id, { token });
  const b = await req('GET', '/api/followups/' + other, { token });
  assert.equal(a.body.followup.topic, '只改我这条');
  assert.notEqual(a.body.followup.topic, b.body.followup.topic, '另一条应未受影响');
});
