import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('pending-teacher');
});
after(async () => {
  await stopServer();
});

describe('待回访 · 列表', () => {
  test('从未回访的学生一定在列表里', async () => {
    const fresh = await createUser('pending-fresh');
    await createStudent(fresh, { name: '从未回访' });

    const res = await req('GET', '/api/students/needs-followup?days=7', { token: fresh });
    assert.equal(res.status, 200);

    const names = res.body.students.map((s: any) => s.name);
    assert.ok(names.includes('从未回访'), '从未回访的应出现');
    assert.equal(res.body.students[0].daysSince, null, '从未回访 daysSince 应为 null');
  });

  test('刚回访过的学生不在列表里', async () => {
    const fresh = await createUser('pending-recent');
    const s = await createStudent(fresh, { name: '刚回访过' });
    await createFollowUp(fresh, { studentId: s.id, studentName: '刚回访过' });

    const res = await req('GET', '/api/students/needs-followup?days=7', { token: fresh });
    const names = res.body.students.map((x: any) => x.name);
    assert.ok(!names.includes('刚回访过'), '刚回访过的不应出现');
  });

  test('超过阈值天数的学生出现，且给出已过天数', async () => {
    const fresh = await createUser('pending-old');
    const s = await createStudent(fresh, { name: '很久没回访' });
    const f = await createFollowUp(fresh, { studentId: s.id, studentName: '很久没回访' });

    // 把回访时间改到 20 天前
    const { db } = await import('../config/database.js');
    db.prepare("UPDATE followups SET created_at = datetime('now','localtime','-20 days') WHERE id = ?").run(f.id);

    const within7 = await req('GET', '/api/students/needs-followup?days=7', { token: fresh });
    const names7 = within7.body.students.map((x: any) => x.name);
    assert.ok(names7.includes('很久没回访'), '20 天前回访的，7 天阈值下应出现');

    const within30 = await req('GET', '/api/students/needs-followup?days=30', { token: fresh });
    const names30 = within30.body.students.map((x: any) => x.name);
    assert.ok(!names30.includes('很久没回访'), '20 天前回访的，30 天阈值下不该出现');

    const row = within7.body.students.find((x: any) => x.name === '很久没回访');
    assert.ok(row.daysSince >= 19 && row.daysSince <= 21, '应给出约 20 天，实际: ' + row.daysSince);
  });

  test('排序：最久没回访的排在前面，从未回访的最靠前', async () => {
    const fresh = await createUser('pending-order');
    const never = await createStudent(fresh, { name: 'A从未回访' });
    const old = await createStudent(fresh, { name: 'B很久没回访' });

    const f = await createFollowUp(fresh, { studentId: old.id, studentName: 'B很久没回访' });
    const { db } = await import('../config/database.js');
    db.prepare("UPDATE followups SET created_at = datetime('now','localtime','-15 days') WHERE id = ?").run(f.id);

    const res = await req('GET', '/api/students/needs-followup?days=7', { token: fresh });
    const names = res.body.students.map((x: any) => x.name);

    assert.equal(names[0], 'A从未回访', '从未回访的应排最前');
    assert.ok(names.indexOf('A从未回访') < names.indexOf('B很久没回访'));
    assert.ok(!names.includes('刚回访过'), '不应混入最近回访过的');
  });

  test('非法 days 参数被收敛', async () => {
    const fresh = await createUser('pending-days');
    await createStudent(fresh, { name: '参数测试' });

    const a = await req('GET', '/api/students/needs-followup?days=abc', { token: fresh });
    assert.equal(a.status, 200);
    assert.equal(a.body.days, 7, '非法值应回落到 7');

    const b = await req('GET', '/api/students/needs-followup?days=99999', { token: fresh });
    assert.equal(b.body.days, 365, '超大值应被限制');

    const c = await req('GET', '/api/students/needs-followup?days=0', { token: fresh });
    assert.equal(c.body.days, 7, '0 视为非法值，回落到默认 7');
  });

  test('多用户隔离', async () => {
    const a = await createUser('pending-user-a');
    const b = await createUser('pending-user-b');
    await createStudent(a, { name: 'A的学生' });

    const res = await req('GET', '/api/students/needs-followup?days=7', { token: b });
    const names = res.body.students.map((x: any) => x.name);
    assert.ok(!names.includes('A的学生'), '不应看到他人学生');
  });

  test('未登录返回 401', async () => {
    const res = await req('GET', '/api/students/needs-followup');
    assert.equal(res.status, 401);
  });
});

describe('历史联想 · 主题与短语', () => {
  test('从历史里提取高频主题', async () => {
    const fresh = await createUser('suggest-topics');
    for (let i = 0; i < 3; i++) {
      await createFollowUp(fresh, { topic: '分数加减法' });
    }
    await createFollowUp(fresh, { topic: '分数乘法' });

    const res = await req('GET', '/api/followups/suggestions', { token: fresh });
    assert.equal(res.status, 200);

    const topics = res.body.topics.map((t: any) => t.text);
    assert.ok(topics.includes('分数加减法'));
    assert.equal(res.body.topics[0].text, '分数加减法', '出现最多的应排第一');
    assert.equal(res.body.topics[0].count, 3);
  });

  test('把课堂表现拆成短语并按频次排序', async () => {
    const fresh = await createUser('suggest-phrases');
    for (let i = 0; i < 2; i++) {
      await createFollowUp(fresh, { performance: '专注度高，计算粗心' });
    }
    await createFollowUp(fresh, { performance: '专注度高，审题不仔细' });

    const res = await req('GET', '/api/followups/suggestions', { token: fresh });
    const phrases = res.body.phrases.map((p: any) => p.text);

    assert.ok(phrases.includes('专注度高'));
    assert.ok(phrases.includes('计算粗心'));
    assert.ok(phrases.includes('审题不仔细'));
    assert.equal(phrases[0], '专注度高', '出现 3 次的应排第一');

    // 不应把整句当成短语
    assert.ok(!phrases.includes('专注度高，计算粗心'));
  });

  test('过滤掉过短与过长的片段', async () => {
    const fresh = await createUser('suggest-filter');
    await createFollowUp(fresh, {
      performance: '好，' + '很长的一段描述用来测试长度过滤'.repeat(2) + '，专注度高',
    });

    const res = await req('GET', '/api/followups/suggestions', { token: fresh });
    const phrases = res.body.phrases.map((p: any) => p.text);

    assert.ok(!phrases.includes('好'), '单字应被过滤');
    assert.ok(phrases.includes('专注度高'));
    assert.ok(
      phrases.every((p: string) => p.length <= 14),
      '超长片段应被过滤'
    );
  });

  test('指定学生时优先用该学生的历史', async () => {
    const fresh = await createUser('suggest-scoped');
    const s = await createStudent(fresh, { name: '联想学生' });

    await createFollowUp(fresh, { studentId: s.id, studentName: '联想学生', topic: '该学生的主题' });
    await createFollowUp(fresh, { topic: '其他主题' });

    const scoped = await req('GET', '/api/followups/suggestions?studentId=' + s.id, { token: fresh });
    const topics = scoped.body.topics.map((t: any) => t.text);

    assert.ok(topics.includes('该学生的主题'));
    // 全局的也会掺进来，保证新场景也有词可用
    assert.ok(topics.includes('其他主题'));
  });

  test('没有历史时返回空数组而不是报错', async () => {
    const fresh = await createUser('suggest-empty');
    const res = await req('GET', '/api/followups/suggestions', { token: fresh });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.topics, []);
    assert.deepEqual(res.body.phrases, []);
  });

  test('多用户隔离', async () => {
    const a = await createUser('suggest-user-a');
    const b = await createUser('suggest-user-b');
    await createFollowUp(a, { topic: 'A的专属主题' });

    const res = await req('GET', '/api/followups/suggestions', { token: b });
    const topics = res.body.topics.map((t: any) => t.text);
    assert.ok(!topics.includes('A的专属主题'));
  });

  test('未登录返回 401', async () => {
    const res = await req('GET', '/api/followups/suggestions');
    assert.equal(res.status, 401);
  });
});
