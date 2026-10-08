import './setup.js';
import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';
import { setFollowUpGenerator, resetFollowUpGenerator } from '../services/ai.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('fw-teacher');
});
after(async () => {
  await stopServer();
});
beforeEach(() => {
  resetFollowUpGenerator();
});

const VALID_BODY = {
  studentName: '李小明',
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法运算',
  performance: '专注度较高，能主动回答问题',
  mastery: 'good',
  images: [],
};

describe('回访 CRUD', () => {
  test('创建回访并正确计算字数', async () => {
    const f = await createFollowUp(token);
    assert.ok(f.id);
    assert.equal(f.studentName, '李小明');
    assert.ok(f.wordCount > 0, '应计算字数');
    assert.ok(Array.isArray(f.images), 'images 应为数组');
    assert.ok(f.createdAt, 'createdAt 应为 camelCase');
  });

  test('关联不存在的学生返回 400（防越权写入）', async () => {
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...VALID_BODY, studentId: 999999, content: '内容' },
    });
    assert.equal(res.status, 400);
  });

  test('关联他人的学生返回 400', async () => {
    const other = await createUser('fw-other');
    const othersStudent = await createStudent(other, { name: '别人的学生' });
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...VALID_BODY, studentId: othersStudent.id, content: '内容' },
    });
    assert.equal(res.status, 400);
  });

  test('缺少必填项返回 400', async () => {
    const res = await req('POST', '/api/followups', { token, body: { studentName: '缺字段' } });
    assert.equal(res.status, 400);
  });

  // ===== 回归测试：SQLite datetime 双引号导致 UPDATE 500 =====
  test('更新回访应成功（回归：datetime 引号 bug 曾导致 500）', async () => {
    const f = await createFollowUp(token, { topic: '原始主题' });
    const res = await req('PUT', '/api/followups/' + f.id, {
      token,
      body: {
        topic: '修改后的主题',
        performance: '修改后的表现',
        mastery: 'excellent',
        content: '修改后的回访内容',
        images: [],
      },
    });
    assert.equal(res.status, 200, '更新必须成功，不能是 500');
    assert.equal(res.body.followup.topic, '修改后的主题');
    assert.equal(res.body.followup.content, '修改后的回访内容');
    assert.equal(res.body.followup.mastery, 'excellent');
  });

  test('更新时字数随之重算', async () => {
    const f = await createFollowUp(token);
    const res = await req('PUT', '/api/followups/' + f.id, {
      token,
      body: { topic: f.topic, performance: f.performance, mastery: f.mastery, content: '短内容', images: [] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.followup.wordCount, 3, '「短内容」去掉标点后应为 3 字');
  });

  test('删除回访', async () => {
    const f = await createFollowUp(token);
    const del = await req('DELETE', '/api/followups/' + f.id, { token });
    assert.equal(del.status, 200);
    const after = await req('GET', '/api/followups/' + f.id, { token });
    assert.equal(after.status, 404);
  });

  test('过滤：按学科与年级', async () => {
    await createFollowUp(token, { subject: '物理', grade: '高三', topic: '过滤测试' });
    const res = await req('GET', '/api/followups?subject=物理&grade=高三', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.followups.length >= 1);
    assert.ok(res.body.followups.every((f: any) => f.subject === '物理' && f.grade === '高三'));
  });
});

describe('分页', () => {
  test('返回分页元信息', async () => {
    const res = await req('GET', '/api/followups?page=1&pageSize=5', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.pageSize, 5);
    assert.ok(res.body.pagination.total >= 1);
    assert.ok(res.body.pagination.totalPages >= 1);
    assert.ok(res.body.followups.length <= 5);
  });

  test('非法分页参数被安全收敛', async () => {
    const res = await req('GET', '/api/followups?page=-5&pageSize=99999', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.page, 1, '负数页码应收敛为 1');
    assert.equal(res.body.pagination.pageSize, 100, '超限每页数应被截断为 100');
  });

  // ===== 回归测试：created_at 秒级精度会导致分页重复/漏项 =====
  test('同一秒内批量创建后分页不重复、不漏项', async () => {
    const fresh = await createUser('paging-teacher');
    const TOTAL = 25;

    // 快速连续创建，多数记录会落在同一秒
    for (let i = 0; i < TOTAL; i++) {
      await createFollowUp(fresh, { topic: '分页-' + String(i).padStart(2, '0') });
    }

    const seen = new Set<number>();
    let page = 1;
    let guard = 0;

    while (guard++ < 20) {
      const res = await req('GET', '/api/followups?page=' + page + '&pageSize=7', { token: fresh });
      assert.equal(res.status, 200);
      for (const f of res.body.followups) {
        assert.ok(!seen.has(f.id), '分页出现重复记录 id=' + f.id);
        seen.add(f.id);
      }
      if (page >= res.body.pagination.totalPages) break;
      page++;
    }

    assert.equal(seen.size, TOTAL, '分页漏项：期望 ' + TOTAL + ' 条，实际 ' + seen.size + ' 条');
  });
});

describe('统计接口', () => {
  test('返回总量、图片数与最近记录（不受分页影响）', async () => {
    const fresh = await createUser('stats-teacher');
    await createFollowUp(fresh, { images: ['1/a.png', '1/b.png'] });
    await createFollowUp(fresh, { images: ['1/c.png'] });
    await createFollowUp(fresh, { images: [] });

    const res = await req('GET', '/api/followups/stats', { token: fresh });
    assert.equal(res.status, 200);
    assert.equal(res.body.totalFollowUps, 3, '总量应为全部记录数，而非单页长度');
    assert.equal(res.body.totalImages, 3);
    assert.equal(res.body.recent.length, 3, '最近记录应随总量返回');
  });

  test('stats 不会被 /:id 路由抢占', async () => {
    const res = await req('GET', '/api/followups/stats', { token });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.totalFollowUps === 'number', '应返回统计对象而非 404');
  });

  test('新用户统计为 0', async () => {
    const fresh = await createUser('stats-empty');
    const res = await req('GET', '/api/followups/stats', { token: fresh });
    assert.equal(res.body.totalFollowUps, 0);
    assert.equal(res.body.totalImages, 0);
    assert.deepEqual(res.body.recent, []);
  });
});

describe('AI 生成（注入桩实现，不打真实 API）', () => {
  test('缺少必填字段返回 400', async () => {
    const res = await req('POST', '/api/followups/generate', { token, body: { studentName: '李小明' } });
    assert.equal(res.status, 400);
  });

  test('生成成功返回内容与字数', async () => {
    const fake = '【课堂内容】本节课重点讲解分数通分的原理与步骤，通过数轴演示帮助理解。' +
      '【学生收获】李小明专注度较高，能主动回答问题，对通分方法掌握到位，独立完成基础题准确率良好。' +
      '【课后任务】完成练习册第12页第1到8题，巩固通分步骤，每天做10道口算提升计算速度。';

    setFollowUpGenerator(async () => fake);

    const res = await req('POST', '/api/followups/generate', { token, body: VALID_BODY });
    assert.equal(res.status, 200);
    assert.equal(res.body.content, fake);
    assert.ok(res.body.wordCount > 0);
    // 与纯文字计数规则保持一致
    const expected = fake.replace(/[\s\p{P}\p{S}]/gu, '').length;
    assert.equal(res.body.wordCount, expected);
  });

  test('生成器抛错时按类型映射状态码与提示', async () => {
    const cases: { err: any; status: number; match: RegExp }[] = [
      {
        err: Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }),
        status: 504,
        match: /超时/,
      },
      {
        err: Object.assign(new Error('Unauthorized'), { status: 401 }),
        status: 502,
        match: /API Key 无效/,
      },
      {
        err: Object.assign(new Error('Rate limit'), { status: 429 }),
        status: 429,
        match: /频繁|额度/,
      },
      {
        err: Object.assign(new Error('Bad gateway'), { status: 502 }),
        status: 502,
        match: /暂时不可用/,
      },
    ];

    for (const c of cases) {
      setFollowUpGenerator(async () => {
        throw c.err;
      });
      const res = await req('POST', '/api/followups/generate', { token, body: VALID_BODY });
      assert.equal(res.status, c.status, c.err.message + ' 应映射为 ' + c.status);
      assert.match(res.body.error, c.match);
    }
  });

  test('未配置 API Key 时给出明确提示（非笼统的"生成失败"）', async () => {
    setFollowUpGenerator(async () => {
      throw new Error('SENSENOVA_API_KEY 未配置，请在 .env 文件中设置');
    });
    const res = await req('POST', '/api/followups/generate', { token, body: VALID_BODY });
    assert.equal(res.status, 500);
    assert.match(res.body.error, /SENSENOVA_API_KEY 未配置/);
  });
});

describe('回访数据隔离', () => {
  test('看不到他人的回访记录', async () => {
    const other = await createUser('fw-isolated');
    const mine = await createFollowUp(token, { topic: '我的私密回访' });

    const list = await req('GET', '/api/followups?pageSize=100', { token: other });
    assert.ok(!list.body.followups.some((f: any) => f.id === mine.id));

    const single = await req('GET', '/api/followups/' + mine.id, { token: other });
    assert.equal(single.status, 404);
  });

  test('无法修改或删除他人的回访', async () => {
    const other = await createUser('fw-isolated-2');
    const mine = await createFollowUp(token, { topic: '受保护的回访' });

    const put = await req('PUT', '/api/followups/' + mine.id, {
      token: other,
      body: { topic: '篡改', performance: 'x', mastery: 'good', content: 'x', images: [] },
    });
    assert.equal(put.status, 404);

    const del = await req('DELETE', '/api/followups/' + mine.id, { token: other });
    assert.equal(del.status, 404);
  });
});
