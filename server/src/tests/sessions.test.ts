import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, url, createUser, createStudent, createFollowUp } from './helpers.js';
import { buildPrompt } from '../services/ai.js';
import { normalizeSessionCount } from '../utils/mappers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('session-teacher');
});
after(async () => {
  await stopServer();
});

describe('课次数 · 存储', () => {
  test('不传时默认 1 次课', async () => {
    const f = await createFollowUp(token);
    assert.equal(f.sessionCount, 1);
  });

  test('可保存 2 次课与 3 次课', async () => {
    for (const n of [2, 3]) {
      const f = await createFollowUp(token, { sessionCount: n, topic: n + '次课测试' });
      assert.equal(f.sessionCount, n);
    }
  });

  test('非法值被收敛到 1-3 区间', async () => {
    const cases: [unknown, number][] = [
      [0, 1],
      [-5, 1],
      [99, 3],
      ['abc', 1],
      [null, 1],
      [undefined, 1],
      ['2', 2],
      [2.7, 2],
    ];

    for (const [input, expected] of cases) {
      const f = await createFollowUp(token, { sessionCount: input, topic: '边界-' + String(input) });
      assert.equal(f.sessionCount, expected, '输入 ' + String(input) + ' 应归一为 ' + expected);
    }
  });

  test('更新时可修改课次数', async () => {
    const f = await createFollowUp(token, { sessionCount: 1, topic: '待改为3次课' });
    assert.equal(f.sessionCount, 1);

    const res = await req('PUT', '/api/followups/' + f.id, {
      token,
      body: {
        topic: f.topic,
        performance: f.performance,
        mastery: f.mastery,
        sessionCount: 3,
        content: f.content,
        images: [],
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.followup.sessionCount, 3);
  });

  test('更新时不传课次数则保持原值', async () => {
    const f = await createFollowUp(token, { sessionCount: 3, topic: '保持原值' });

    const res = await req('PUT', '/api/followups/' + f.id, {
      token,
      body: { topic: '改主题不改课次', performance: f.performance, mastery: f.mastery, content: f.content, images: [] },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.followup.sessionCount, 3, '不应被重置为 1');
  });

  test('列表与统计接口都返回课次数', async () => {
    const fresh = await createUser('session-list');
    await createFollowUp(fresh, { sessionCount: 3 });

    const list = await req('GET', '/api/followups', { token: fresh });
    assert.equal(list.body.followups[0].sessionCount, 3);

    const stats = await req('GET', '/api/followups/stats', { token: fresh });
    assert.equal(stats.body.recent[0].sessionCount, 3);
  });
});

describe('课次数 · normalizeSessionCount 单元', () => {
  test('边界与非法值', () => {
    assert.equal(normalizeSessionCount(1), 1);
    assert.equal(normalizeSessionCount(3), 3);
    assert.equal(normalizeSessionCount(0), 1);
    assert.equal(normalizeSessionCount(4), 3);
    assert.equal(normalizeSessionCount('2'), 2);
    assert.equal(normalizeSessionCount('x'), 1);
    assert.equal(normalizeSessionCount(undefined), 1);
    assert.equal(normalizeSessionCount(NaN), 1);
  });
});

describe('课次数 · Prompt 自适应', () => {
  const base = {
    studentName: '李小明',
    grade: '小学五年级',
    subject: '数学',
    topic: '分数加减法运算',
    performance: '专注度较高',
    mastery: 'good',
    images: [],
  };

  test('单次课使用「本次课」措辞，且不出现阶段性描述', () => {
    const p = buildPrompt({ ...base, sessionCount: 1 });

    assert.match(p, /涵盖课次：本次课/);
    assert.ok(!p.includes('最近 3 次课'));
    assert.ok(!p.includes('作为一个阶段'), '单次课不应出现阶段性表述');
    assert.match(p, /说明本节课讲授的知识点/);
  });

  test('多次课明确要求按阶段整体反馈，而非逐次罗列', () => {
    const p = buildPrompt({ ...base, sessionCount: 3 });

    assert.match(p, /涵盖最近 3 次课/);
    assert.match(p, /作为一个阶段来整体反馈/);
    assert.match(p, /而不是逐次罗列流水账/);
    assert.match(p, /涵盖课次：最近 3 次课/);
    // 三段要求也要体现多次课
    assert.match(p, /说明这 3 次课讲授的知识点/);
    assert.match(p, /这 3 次课中的进步轨迹/);
    assert.match(p, /针对这 3 次课的综合情况/);
  });

  test('2 次课与 3 次课措辞各自正确', () => {
    assert.match(buildPrompt({ ...base, sessionCount: 2 }), /最近 2 次课/);
    assert.match(buildPrompt({ ...base, sessionCount: 2 }), /这 2 次课/);
    assert.match(buildPrompt({ ...base, sessionCount: 3 }), /这 3 次课/);
  });

  test('段标题与字数要求不受课次数影响', () => {
    for (const n of [1, 2, 3]) {
      const p = buildPrompt({ ...base, sessionCount: n });
      assert.match(p, /【课堂内容】/);
      assert.match(p, /【学生收获】/);
      assert.match(p, /【课后任务】/);
      assert.match(p, /150-500 字之间/);
    }
  });
});

describe('课次数 · 导出', () => {
  /** 导出返回的是纯文本，不能用 req（它会 JSON 解析） */
  async function fetchText(path: string): Promise<string> {
    const res = await fetch(url(path), { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(res.status, 200);
    return res.text();
  }

  test('Markdown 标注每条记录的涵盖课次', async () => {
    const s = await createStudent(token, { name: '课次MD' });
    await createFollowUp(token, { studentId: s.id, studentName: '课次MD', sessionCount: 3, topic: '三次课合集' });
    await createFollowUp(token, { studentId: s.id, studentName: '课次MD', sessionCount: 1, topic: '单次课' });

    const text = await fetchText('/api/students/' + s.id + '/export');

    assert.match(text, /\*\*涵盖课次\*\*：3 次课/);
    assert.match(text, /\*\*涵盖课次\*\*：本次课/, '单次课应标注为「本次课」');
  });

  test('CSV 新增涵盖课次列且有表头', async () => {
    const s = await createStudent(token, { name: '课次CSV' });
    await createFollowUp(token, { studentId: s.id, studentName: '课次CSV', sessionCount: 2 });

    const csv = await fetchText('/api/students/' + s.id + '/export?format=csv');

    assert.match(csv, /课程主题,上课日期,课程类型,涵盖课次,/);
    assert.match(csv, /,2 次课,/);
  });
});
