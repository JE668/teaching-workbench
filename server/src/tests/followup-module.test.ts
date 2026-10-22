import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';
import { buildPrompt, MODULE_GUIDANCE, FollowUpGenerateParams } from '../services/ai.js';
import { normalizeFollowUpModule, FOLLOWUP_MODULES } from '../utils/mappers.js';
import type { FollowUpModule } from '../types/index.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('followup-module-teacher');
});
after(async () => {
  await stopServer();
});

const base: FollowUpGenerateParams = {
  studentName: '李小明',
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法运算',
  performance: '专注度较高',
  mastery: 'good',
  images: [],
};

describe('流程打卡类型 · 归一化', () => {
  test('非法或缺失一律回落到课堂总结', () => {
    // 存量数据没有 module 列，读出来是 undefined，必须能安全兜住
    assert.equal(normalizeFollowUpModule(undefined), 'class_summary');
    assert.equal(normalizeFollowUpModule(null), 'class_summary');
    assert.equal(normalizeFollowUpModule(''), 'class_summary');
    assert.equal(normalizeFollowUpModule('乱写的值'), 'class_summary');
  });

  test('八个类型全部被接受', () => {
    for (const m of FOLLOWUP_MODULES) {
      assert.equal(normalizeFollowUpModule(m), m);
    }
    assert.equal(FOLLOWUP_MODULES.length, Object.keys(MODULE_GUIDANCE).length, '前后端类型清单必须一一对应');
  });
});

describe('流程打卡类型 · 提示词', () => {
  test('不传 module 时默认课堂总结，且不追加模块专属要求', () => {
    const p = buildPrompt(base);
    assert.match(p, /- 打卡类型：常规类 · 课堂总结/);
    assert.match(p, /# 本次打卡类型：常规类 · 课堂总结/);
    assert.ok(!p.includes('本模块专属要求'), '课堂总结没有专属要求，不应输出空标题');
  });

  test('八种类型都写进提示词，且三段标题保持完整', () => {
    for (const m of FOLLOWUP_MODULES) {
      const p = buildPrompt({ ...base, module: m });
      const g = MODULE_GUIDANCE[m];
      assert.match(p, new RegExp('- 打卡类型：' + g.group + ' · ' + g.label), m + ' 课堂信息');
      assert.match(p, new RegExp('# 本次打卡类型：' + g.group + ' · ' + g.label), m + ' 场景块');
      // 课堂总结是通用模块，没有专属要求；其余 7 种必须各有一条针对性约束
      if (m === 'class_summary') {
        assert.equal(g.rules.length, 0);
        assert.ok(!p.includes('本模块专属要求'), '课堂总结不应输出空的专属要求块');
      } else {
        assert.ok(g.rules.length > 0, m + ' 应有专属要求');
        assert.ok(p.includes('# 本模块专属要求（' + g.label + '）'), m + ' 专属要求应写进提示词');
      }
      assert.match(p, /【课堂内容】/);
      assert.match(p, /【学生收获】/);
      assert.match(p, /【课后任务】/);
      assert.match(p, /140-200 字之间/);
    }
  });

  test('常规类五种齐全，非常规类三种齐全', () => {
    const groups = FOLLOWUP_MODULES.map((m) => MODULE_GUIDANCE[m].group);
    assert.equal(groups.filter((g) => g === '常规类').length, 5);
    assert.equal(groups.filter((g) => g === '非常规类').length, 3);
  });

  test('不同模块的写法确实不同，不会互相串词', () => {
    const homework = buildPrompt({ ...base, module: 'homework_review' });
    const firstLesson = buildPrompt({ ...base, module: 'first_lesson' });
    assert.match(homework, /批改的作业范围/);
    assert.match(firstLesson, /后续教学计划/);
    assert.ok(!homework.includes('后续教学计划'), '作业批改不应出现新生首课的措辞');
    assert.ok(!firstLesson.includes('批改的作业范围'), '新生首课不应出现作业批改的措辞');
  });

  test('课堂总结在 1对1 与小组课下的措辞各自正确', () => {
    const one = buildPrompt({ ...base, module: 'class_summary' });
    const group = buildPrompt({ ...base, module: 'class_summary', courseType: 'group' });
    assert.match(one, /描述小明本节课的进步与亮点/);
    assert.match(group, /描述同学们在本节课的整体进步与亮点/);
    assert.ok(!group.includes('小明本节课的进步与亮点'), '小组课文案不能出现学生称呼');
    // 模块模板里的 {call} 占位符必须替换成「孩子们」，不能残留花括号
    const firstLessonGroup = buildPrompt({ ...base, module: 'first_lesson', courseType: 'group' });
    assert.match(firstLessonGroup, /描述孩子们的状态与性格特点/);
    assert.ok(!/(\{[a-zA-Z]+\})/.test(firstLessonGroup), '提示词里不应残留未替换的占位符');
  });

  test('多次课的递进措辞在课堂总结里保留', () => {
    const p = buildPrompt({ ...base, module: 'class_summary', sessionCount: 3 });
    assert.match(p, /体现知识之间的递进关系/);
    assert.match(p, /在这 3 次课中的进步轨迹/);
    assert.match(p, /针对这 3 次课的综合情况布置巩固练习/);
  });

  test('所有占位符都被替换，任何模块都不残留花括号', () => {
    for (const m of FOLLOWUP_MODULES) {
      for (const courseType of ['one_on_one', 'group'] as const) {
        for (const sessionCount of [1, 2, 3]) {
          const p = buildPrompt({ ...base, module: m, courseType, sessionCount });
          assert.ok(!/(\{[a-zA-Z]+\})/.test(p), m + '/' + courseType + '/' + sessionCount + ' 残留占位符');
        }
      }
    }
  });
});

describe('流程打卡类型 · 持久化', () => {
  test('不传 module 时保存为课堂总结', async () => {
    const f = await createFollowUp(token);
    assert.equal(f.module, 'class_summary');
  });

  test('传 module 会被保存并回显', async () => {
    for (const m of ['homework_review', 'stage_test', 'makeup_plan'] as FollowUpModule[]) {
      const f = await createFollowUp(token, { module: m });
      assert.equal(f.module, m);
    }
  });

  test('非法 module 回落课堂总结而不是报错', async () => {
    const f = await createFollowUp(token, { module: '乱写的值' });
    assert.equal(f.module, 'class_summary');
  });

  test('小组课拆出的每条记录都带上同一个 module', async () => {
    const s1 = await createStudent(token, { name: '模块甲', grade: '小学三年级', subject: '语文' });
    const s2 = await createStudent(token, { name: '模块乙', grade: '小学三年级', subject: '语文' });
    const res = await req('POST', '/api/followups', {
      token,
      body: {
        studentIds: [s1.id, s2.id],
        studentName: '',
        grade: '小学三年级',
        subject: '语文',
        topic: '生字词语积累',
        performance: '课堂参与积极',
        mastery: 'good',
        courseType: 'group',
        module: 'preview',
        images: [],
        content: '【课堂内容】本次发放了生字预习单。【学生收获】孩子们对预习流程有了基本认识。【课后任务】完成预习单第1-3页。',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 2);
    for (const f of res.body.followups) {
      assert.equal(f.module, 'preview');
    }
  });
});
