import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';
import { buildPrompt } from '../services/ai.js';
import { deriveNickname } from '../utils/nickname.js';
import { normalizeCourseType } from '../utils/mappers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('course-type-teacher');
});
after(async () => {
  await stopServer();
});

const BASE_BODY = {
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法',
  performance: '专注度较高',
  mastery: 'good',
  images: [],
  content: '【课堂内容】测试内容。',
};

describe('课程类型 · 1对1（默认）', () => {
  test('不传 courseType 时按 1对1 处理', async () => {
    const f = await createFollowUp(token);
    assert.equal(f.courseType, 'one_on_one');
  });

  test('显式传 courseType 会被保存', async () => {
    const f = await createFollowUp(token, { courseType: 'one_on_one' });
    assert.equal(f.courseType, 'one_on_one');
  });

  test('非法 courseType 归一为 1对1', () => {
    assert.equal(normalizeCourseType(undefined), 'one_on_one');
    assert.equal(normalizeCourseType('group'), 'group');
    assert.equal(normalizeCourseType('GROUP'), 'one_on_one');
    assert.equal(normalizeCourseType('xyz'), 'one_on_one');
    assert.equal(normalizeCourseType(null), 'one_on_one');
  });
});

describe('课程类型 · 小组课批量归档', () => {
  test('一次保存为多个学生各建一条记录，内容一致', async () => {
    const a = await createStudent(token, { name: '小组甲' });
    const b = await createStudent(token, { name: '小组乙' });
    const c = await createStudent(token, { name: '小组丙' });

    const res = await req('POST', '/api/followups', {
      token,
      body: {
        ...BASE_BODY,
        courseType: 'group',
        studentIds: [a.id, b.id, c.id],
        content: '【课堂内容】小组课通用内容，不涉及具体学生。',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.created, 3, '应为 3 个学生各建一条');
    assert.equal(res.body.followups.length, 3);

    // 每条都挂到对应学生，且都标记为小组课
    const names = res.body.followups.map((f: any) => f.studentName).sort();
    assert.deepEqual(names, ['小组丙', '小组乙', '小组甲'].sort());

    for (const f of res.body.followups) {
      assert.equal(f.courseType, 'group');
      assert.ok(f.studentId, '应关联到学生');
      assert.equal(f.content, '【课堂内容】小组课通用内容，不涉及具体学生。');
    }

    // 三条内容必须完全一致（同一条群发文案）
    const contents = new Set(res.body.followups.map((f: any) => f.content));
    assert.equal(contents.size, 1);
  });

  test('每个学生的档案里都能查到这条记录', async () => {
    const s = await createStudent(token, { name: '档案可见性' });

    await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, courseType: 'group', studentIds: [s.id] },
    });

    const list = await req('GET', '/api/followups?studentId=' + s.id, { token });
    assert.equal(list.body.followups.length, 1);
    assert.equal(list.body.followups[0].courseType, 'group');
  });

  test('未选择学生时返回 400', async () => {
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, courseType: 'group', studentIds: [] },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /至少选择一名学生/);
  });

  test('包含不存在/他人的学生时整批拒绝', async () => {
    const mine = await createStudent(token, { name: '我的学生' });
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, courseType: 'group', studentIds: [mine.id, 999999] },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /不存在或无权访问/);

    // 整批回滚：不应有任何记录被写入
    const list = await req('GET', '/api/followups?studentId=' + mine.id, { token });
    assert.equal(list.body.followups.length, 0, '失败时不应产生半截数据');
  });

  test('同一学生重复传入只建一条', async () => {
    const s = await createStudent(token, { name: '重复传入' });
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, courseType: 'group', studentIds: [s.id, s.id, s.id] },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.created, 1);
  });

  test('小组课不需要 studentName', async () => {
    const s = await createStudent(token, { name: '无姓名小组' });
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, courseType: 'group', studentIds: [s.id] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.followup.studentName, '无姓名小组', '记录里应用该学生的姓名');
  });
});

describe('学生自动匹配与建档', () => {
  test('手输姓名命中已有学生时直接关联', async () => {
    const existing = await createStudent(token, { name: '既有学生' });

    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, studentId: null, studentName: '既有学生' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.followup.studentId, existing.id);
    assert.equal(res.body.createdStudent, false, '不应重复建档');
  });

  test('手输姓名未命中时自动建档', async () => {
    const marker = '自动建档' + Date.now();

    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, studentId: null, studentName: marker },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.createdStudent, true);
    assert.ok(res.body.followup.studentId, '应关联到新建的学生');

    // 学生库里应能查到
    const list = await req('GET', '/api/students/search?keyword=' + encodeURIComponent(marker), { token });
    assert.equal(list.body.students.length, 1);
    assert.equal(list.body.students[0].name, marker);
    // 建档时继承表单里的年级/学科
    assert.equal(list.body.students[0].grade, '小学五年级');
  });

  test('归位历史记录：同名且未关联的回访被补挂到档案', async () => {
    const marker = '归位测试' + Date.now();

    // 先造两条「没关联学生」的历史记录（模拟以前手输姓名直接保存）
    for (let i = 0; i < 2; i++) {
      const r = await req('POST', '/api/followups', {
        token,
        body: { ...BASE_BODY, studentId: null, studentName: marker, topic: '历史-' + i },
      });
      assert.equal(r.status, 200);
      // 第一次会自动建档并归位，因此这里改为直接插入以模拟真正的历史数据
    }

    // 直接往库里塞一条真正「未关联」的历史记录
    const { db } = await import('../config/database.js');
    const uid = (await req('GET', '/api/auth/me', { token })).body.user.id;
    db.prepare(
      'INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, session_count, images, content, word_count) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)'
    ).run(uid, marker, '小学五年级', '数学', '真正历史', '专注', 'good', '[]', '【课堂内容】历史内容。', 20);

    // 触发一次保存，应把上面那条归位
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, studentId: null, studentName: marker },
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.backfilled >= 1, '应至少归位 1 条历史记录，实际: ' + res.body.backfilled);

    const studentId = res.body.followup.studentId;
    for (const topic of ['真正历史']) {
      const row = db.prepare('SELECT student_id FROM followups WHERE user_id = ? AND topic = ?').get(uid, topic) as any;
      assert.equal(row.student_id, studentId, '历史记录「' + topic + '」应已挂到档案');
    }
  });

  test('已关联别的学生的记录不会被抢走', async () => {
    const other = await createStudent(token, { name: '占有者' });

    // 一条已明确关联到 other 的记录
    await createFollowUp(token, { studentId: other.id, studentName: '占有者', topic: '已归属' });

    // 手输同名触发匹配
    const res = await req('POST', '/api/followups', {
      token,
      body: { ...BASE_BODY, studentId: null, studentName: '占有者' },
    });

    const { db } = await import('../config/database.js');
    const row = db
      .prepare('SELECT student_id FROM followups WHERE topic = ? AND student_name = ?')
      .get('已归属', '占有者') as any;
    assert.equal(row.student_id, other.id);
    assert.equal(res.body.followup.studentId, other.id);
  });
});

describe('Prompt · 称呼 / emoji / 照片措辞 / 小组课', () => {
  const base = {
    grade: '小学五年级',
    subject: '数学',
    topic: '分数加减法',
    performance: '专注',
    mastery: 'good',
    images: [],
  };

  test('1对1 使用亲切称呼而非全名', () => {
    const p = buildPrompt({ ...base, studentName: '李一一' });
    assert.match(p, /对学生的称呼：一一/);
    assert.match(p, /不要反复使用全名「李一一」/);
  });

  test('两字姓名不做危险缩短', () => {
    const p = buildPrompt({ ...base, studentName: '李一' });
    assert.match(p, /对学生的称呼：李一/);
  });

  test('自定义称呼优先于自动推导', () => {
    const p = buildPrompt({ ...base, studentName: '李一一', nickname: '小一' });
    assert.match(p, /对学生的称呼：小一/);
  });

  test('给出 emoji 使用指引', () => {
    const p = buildPrompt({ ...base, studentName: '李一一' });
    assert.match(p, /emoji/);
    assert.match(p, /2-4 个/);
  });

  test('有图片时明确禁止「图中」这类指代', () => {
    const p = buildPrompt({ ...base, studentName: '李一一', images: ['1/a.png'] });
    assert.match(p, /严禁/);
    assert.match(p, /图中/);
    assert.match(p, /家长看不到这些照片/);
    // 硬性要求里也要再强调一次
    assert.match(p, /7\. 【严禁】出现"图中"/);
  });

  test('无图片时不输出照片相关禁令（避免无意义指令）', () => {
    const p = buildPrompt({ ...base, studentName: '李一一', images: [] });
    assert.match(p, /本次没有课堂照片/);
    assert.ok(!p.includes('家长看不到这些照片'));
  });

  test('小组课：完全不含学生姓名，且强制通用称呼', () => {
    const p = buildPrompt({ ...base, studentName: '李一一', courseType: 'group' });

    assert.ok(!p.includes('李一一'), '小组课提示词不应出现学生姓名');
    assert.ok(!p.includes('对学生的称呼'), '小组课不应有称呼字段');
    assert.match(p, /小组课最高优先级要求/);
    assert.match(p, /分别私发给多位家长/);
    assert.match(p, /严禁】出现任何学生姓名/);
    assert.match(p, /孩子们.*同学们/);
    // 硬性要求也要有姓名禁令
    assert.match(p, /8\. 【严禁】出现任何学生姓名/);
  });

  test('小组课的段落要求改为面向全班', () => {
    const p = buildPrompt({ ...base, studentName: '李一一', courseType: 'group' });
    assert.match(p, /描述同学们在/);
    assert.match(p, /对全班的整体评价/);
  });

  test('段标题与字数要求不受课程类型影响', () => {
    for (const courseType of ['one_on_one', 'group'] as const) {
      const p = buildPrompt({ ...base, studentName: '李一一', courseType });
      assert.match(p, /【课堂内容】/);
      assert.match(p, /【学生收获】/);
      assert.match(p, /【课后任务】/);
      assert.match(p, /150-500 字之间/);
    }
  });
});

describe('称呼推导 · 单元', () => {
  test('常见姓名', () => {
    assert.equal(deriveNickname('李一一'), '一一');
    assert.equal(deriveNickname('李小明'), '小明');
    assert.equal(deriveNickname('欧阳娜娜'), '娜娜');
    assert.equal(deriveNickname('欧阳明'), '明');
    assert.equal(deriveNickname('司马光'), '光');
  });

  test('无法安全缩短时保持原样', () => {
    assert.equal(deriveNickname('李一'), '李一');
    assert.equal(deriveNickname('Tommy'), 'Tommy');
    assert.equal(deriveNickname(''), '');
    assert.equal(deriveNickname('   '), '');
  });
});
