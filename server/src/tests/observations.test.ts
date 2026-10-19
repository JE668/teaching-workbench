import './setup.js';
import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';
import {
  setObservationGenerator,
  resetObservationGenerator,
} from '../services/observation.js';

let token = '';
let otherToken = '';

const FAKE_REPORT = [
  '【听课人评价】',
  '教学目标：目标明确，贴合分数加减法课程标准，符合该生实际。',
  '教学内容：内容科学准确，重难点突出，容量适中。',
  '教学方法：以图形演示启发引导，方法与学情贴合。',
  '学生参与度与学习状态：学生主动回应，专注度较高，思维有追问。',
  '教学过程：环节完整，过渡自然，时间分配合理。',
  '教师素养：教态自然大方，语言清晰流畅，板书规范。',
  '教学效果：学生当堂掌握通分步骤，目标达成度良好。',
  '特色与创新：用生活化例子导入，贴合学生兴趣。',
  '',
  '【综合评价与建议】',
  '一、本节课亮点：',
  '1. 导入环节用生活实例唤起兴趣。',
  '二、有待优化的部分：',
  '1. 练习梯度偏单一，可增加层次。',
  '三、教学建议：',
  '1. 分层布置练习，兼顾基础与拓展。',
  '四、总体评价等级：良好',
].join('\n');

before(async () => {
  await startServer();
  token = await createUser('obs-teacher');
  otherToken = await createUser('obs-teacher-2');
});
after(async () => {
  await stopServer();
});
beforeEach(() => {
  resetObservationGenerator();
});

describe('老师（被听课老师）', () => {
  test('新建老师 + 同名复用（不重复建）', async () => {
    const a = await req('POST', '/api/teachers', { token, body: { name: '王老师', subject: '数学' } });
    assert.equal(a.status, 200);
    assert.ok(a.body.teacher.id);

    const b = await req('POST', '/api/teachers', { token, body: { name: '王老师' } });
    assert.equal(b.status, 200);
    assert.equal(b.body.teacher.id, a.body.teacher.id, '同名应复用同一条');

    const list = await req('GET', '/api/teachers', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.teachers.length, 1);
  });

  test('缺姓名 → 400', async () => {
    const r = await req('POST', '/api/teachers', { token, body: { name: '' } });
    assert.equal(r.status, 400);
  });
});

describe('听评课记录 CRUD', () => {
  test('创建记录（关联老师 + 听课记录）', async () => {
    const t = await req('POST', '/api/teachers', { token, body: { name: '张老师' } });
    const r = await req('POST', '/api/observations', {
      token,
      body: {
        teacherId: t.body.teacher.id,
        topic: '分数加减法',
        lessonType: 'new',
        observedAt: '2026-10-17',
        grade: '小学五年级',
        subject: '数学',
        level: '中等',
        studentName: '李小明',
        classNotes: '老师用通分法讲解，学生反应良好，主动回答了三次。',
      },
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.observation.id);
    assert.equal(r.body.observation.teacherName, '张老师');
    assert.equal(r.body.observation.lessonType, 'new');
    assert.equal(r.body.observation.status, 'draft');
    assert.equal(r.body.observation.report, '');
  });

  test('缺课题 → 400', async () => {
    const r = await req('POST', '/api/observations', { token, body: { classNotes: 'xx' } });
    assert.equal(r.status, 400);
  });

  test('关联他人老师 → 自动置空（不串号）', async () => {
    // otherToken 的老老师 id，对 token 而言不存在
    const ot = await req('POST', '/api/teachers', { token: otherToken, body: { name: '赵老师' } });
    const r = await req('POST', '/api/observations', {
      token,
      body: { teacherId: ot.body.teacher.id, topic: 't' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.observation.teacherId, null, '非本人老师应被置空');
  });

  test('列表 + 详情 + 更新状态', async () => {
    const t = await req('POST', '/api/teachers', { token, body: { name: '孙老师' } });
    const created = await req('POST', '/api/observations', {
      token,
      body: { teacherId: t.body.teacher.id, topic: '列方程' },
    });
    const id = created.body.observation.id;

    const list = await req('GET', '/api/observations', { token });
    assert.equal(list.status, 200);
    assert.ok(list.body.observations.some((o: any) => o.id === id));

    const detail = await req('GET', '/api/observations/' + id, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.observation.topic, '列方程');

    const upd = await req('PUT', '/api/observations/' + id, {
      token,
      body: { status: 'sent', teacherReply: '已采纳分层练习建议' },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.observation.status, 'sent');
    assert.equal(upd.body.observation.teacherReply, '已采纳分层练习建议');
  });

  test('删除后 404', async () => {
    const created = await req('POST', '/api/observations', { token, body: { topic: '待删' } });
    const id = created.body.observation.id;
    const del = await req('DELETE', '/api/observations/' + id, { token });
    assert.equal(del.status, 200);
    assert.equal((await req('GET', '/api/observations/' + id, { token })).status, 404);
  });
});

describe('生成评课报告（注入桩实现，不打真实 API）', () => {
  test('生成并落库 + AI 建议等级自动预填', async () => {
    setObservationGenerator(async () => FAKE_REPORT);
    const created = await req('POST', '/api/observations', {
      token,
      body: { topic: '分数加减法', classNotes: '反应良好' },
    });
    const id = created.body.observation.id;

    const r = await req('POST', '/api/observations/' + id + '/report', { token });
    assert.equal(r.status, 200);
    assert.ok(r.body.report.includes('【听课人评价】'));
    assert.equal(r.body.suggestedGrade, 'good', '应从报告解析出"良好"');
    // 用户未手选等级 → 落库为 AI 建议的 good
    const detail = await req('GET', '/api/observations/' + id, { token });
    assert.equal(detail.body.observation.overallGrade, 'good');
    assert.ok(detail.body.observation.reportAt, '应记录报告生成时间');
  });

  test('已手选等级时，AI 建议不覆盖', async () => {
    setObservationGenerator(async () => FAKE_REPORT);
    const created = await req('POST', '/api/observations', {
      token,
      body: { topic: 't', classNotes: 'n', overallGrade: 'excellent' },
    });
    const r = await req('POST', '/api/observations/' + created.body.observation.id + '/report', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.overallGrade, 'excellent', '应保留用户手选的 excellent');
  });

  test('生成失败有可读错误', async () => {
    setObservationGenerator(async () => {
      throw Object.assign(new Error('boom'), { status: 429 });
    });
    const created = await req('POST', '/api/observations', { token, body: { topic: 't', classNotes: 'n' } });
    const r = await req('POST', '/api/observations/' + created.body.observation.id + '/report', { token });
    assert.equal(r.status, 429);
    assert.ok(r.body.error);
  });
});

describe('听评课数据隔离', () => {
  test('他人记录不可见 / 不可访问', async () => {
    const mine = await req('POST', '/api/observations', { token, body: { topic: '我的' } });
    const id = mine.body.observation.id;

    assert.equal((await req('GET', '/api/observations/' + id, { token: otherToken })).status, 404);
    assert.equal((await req('DELETE', '/api/observations/' + id, { token: otherToken })).status, 404);

    const otherList = await req('GET', '/api/observations', { token: otherToken });
    assert.ok(!otherList.body.observations.some((o: any) => o.id === id));
  });

  test('老师列表彼此隔离', async () => {
    const a = await req('POST', '/api/teachers', { token, body: { name: '独占老师' } });
    const b = await req('GET', '/api/teachers', { token: otherToken });
    assert.ok(!b.body.teachers.some((t: any) => t.id === a.body.teacher.id));
  });
});

describe('听评课 ↔ 目录（course_id 关联）', () => {
  test('建记录带 courseId → 回显；非法值落 null；PUT 能改能解绑', async () => {
    // course_id 是软关联（课题手输、目录里查不到时留空），所以不强校验课程存在
    const ok = await req('POST', '/api/observations', {
      token,
      body: { topic: '带目录的课', courseId: 42, lessonType: 'new' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.observation.courseId, 42);

    // 不传 courseId → null
    const plain = await req('POST', '/api/observations', { token, body: { topic: '手输课题' } });
    assert.equal(plain.body.observation.courseId, null);

    // 非法值一律落 null：不是正整数就当没关联，不让脏 id 进库
    for (const bad of [0, -5, 1.5, 'abc', '', null]) {
      const r = await req('POST', '/api/observations', {
        token,
        body: { topic: '非法 id', courseId: bad },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.observation.courseId, null, 'courseId=' + JSON.stringify(bad));
    }

    const id = ok.body.observation.id;

    // PUT 更新关联
    const upd = await req('PUT', '/api/observations/' + id, { token, body: { courseId: 99 } });
    assert.equal(upd.body.observation.courseId, 99);

    // 显式传 null = 解绑
    const clear = await req('PUT', '/api/observations/' + id, { token, body: { courseId: null } });
    assert.equal(clear.body.observation.courseId, null);

    // body 里根本没带 courseId → 保留原值（漏传不该把关联清掉）
    await req('PUT', '/api/observations/' + id, { token, body: { courseId: 7 } });
    const keep = await req('PUT', '/api/observations/' + id, { token, body: { topic: '改个题目' } });
    assert.equal(keep.body.observation.topic, '改个题目');
    assert.equal(keep.body.observation.courseId, 7);
  });
});
