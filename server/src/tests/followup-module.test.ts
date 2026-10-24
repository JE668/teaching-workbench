import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser, createStudent, createFollowUp } from './helpers.js';
import { buildPrompt, MODULE_GUIDANCE, FollowUpGenerateParams, followUpWordRange } from '../services/ai.js';
import { normalizeFollowUpModule, normalizeFollowUpModules, FOLLOWUP_MODULES } from '../utils/mappers.js';
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
  test('非法或缺失一律回落到课堂内容总结', () => {
    // 存量数据没有 module 列，读出来是 undefined，必须能安全兜住
    assert.equal(normalizeFollowUpModule(undefined), 'class_content');
    assert.equal(normalizeFollowUpModule(null), 'class_content');
    assert.equal(normalizeFollowUpModule(''), 'class_content');
    assert.equal(normalizeFollowUpModule('乱写的值'), 'class_content');
  });

  test('拆「课堂总结」之前的老值 class_summary 回落到课堂内容总结', () => {
    // DB 默认值与存量数据里都是 class_summary，不改 schema，靠映射兜住
    assert.equal(normalizeFollowUpModule('class_summary'), 'class_content');
    assert.deepEqual(normalizeFollowUpModules('class_summary'), ['class_content']);
    assert.deepEqual(normalizeFollowUpModules('["class_summary","preview"]'), [
      'class_content',
      'preview',
    ]);
  });

  test('十六个类型全部被接受', () => {
    for (const m of FOLLOWUP_MODULES) {
      assert.equal(normalizeFollowUpModule(m), m);
    }
    assert.equal(FOLLOWUP_MODULES.length, Object.keys(MODULE_GUIDANCE).length, '前后端类型清单必须一一对应');
  });
});

describe('流程打卡类型 · 提示词', () => {
  test('不传 module 时默认课堂内容总结，且不追加模块专属要求', () => {
    const p = buildPrompt(base);
    assert.match(p, /- 打卡类型：常规类 · 课堂内容总结/);
    assert.match(p, /# 本次打卡类型：常规类 · 课堂内容总结/);
    assert.ok(!p.includes('本模块专属要求'), '课堂内容总结没有专属要求，不应输出空标题');
  });

  test('十六种类型都写进提示词，且三段标题保持完整', () => {
    for (const m of FOLLOWUP_MODULES) {
      const p = buildPrompt({ ...base, module: m });
      const g = MODULE_GUIDANCE[m];
      assert.match(p, new RegExp('- 打卡类型：' + g.group + ' · ' + g.label), m + ' 课堂信息');
      assert.match(p, new RegExp('# 本次打卡类型：' + g.group + ' · ' + g.label), m + ' 场景块');
      // 课堂内容总结是通用模块，没有专属要求；其余 15 种必须各有一条针对性约束
      if (m === 'class_content') {
        assert.equal(g.rules.length, 0);
        assert.ok(!p.includes('本模块专属要求'), '课堂内容总结不应输出空的专属要求块');
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

  test('多选板块：每块单独成段，标题一字不差，字数区间按板块数放宽', () => {
    const mods: FollowUpModule[] = [
      'homework_review',
      'class_content',
      'class_performance',
      'note_trace',
      'homework_assign',
    ];
    const p = buildPrompt({ ...base, modules: mods });
    for (const m of mods) {
      assert.match(p, new RegExp('【' + MODULE_GUIDANCE[m].label + '】'), m + ' 应有独立段标题');
    }
    assert.match(p, /【学生收获】/);
    assert.match(p, /【课后任务】/);
    const r = followUpWordRange(mods.length);
    assert.match(p, new RegExp(r.min + '-' + r.max + ' 字之间'));
    assert.ok(!p.includes('【课堂内容】'), '多板块模式不应再出现旧的课堂内容段标题');
    assert.ok(p.includes('# 各板块专属要求'));
  });

  test('板块清单归一化：兼容 JSON 串、老单值、非法值丢弃', () => {
    assert.deepEqual(normalizeFollowUpModules('["preview","class_content"]'), ['preview', 'class_content']);
    assert.deepEqual(normalizeFollowUpModules('class_content'), ['class_content']);
    assert.deepEqual(normalizeFollowUpModules(null), ['class_content']);
    assert.deepEqual(normalizeFollowUpModules(undefined), ['class_content']);
    assert.deepEqual(normalizeFollowUpModules(['preview', '乱写的值', 'preview']), ['preview']);
    assert.deepEqual(normalizeFollowUpModules(['乱写的值']), ['class_content']);
  });

  test('常规类九种齐全，非常规类七种齐全', () => {
    const groups = FOLLOWUP_MODULES.map((m) => MODULE_GUIDANCE[m].group);
    assert.equal(groups.filter((g) => g === '常规类').length, 9);
    assert.equal(groups.filter((g) => g === '非常规类').length, 7);
    // 学校清单里的「课堂总结」已拆成两个环节
    for (const m of ['class_content', 'class_performance'] as FollowUpModule[]) {
      assert.ok(FOLLOWUP_MODULES.includes(m), '拆分后的板块必须在清单里');
    }
  });

  test('不同模块的写法确实不同，不会互相串词', () => {
    const homework = buildPrompt({ ...base, module: 'homework_review' });
    const preview = buildPrompt({ ...base, module: 'preview' });
    assert.match(homework, /批改的作业范围/);
    assert.match(preview, /预习资料覆盖了哪些知识点/);
    assert.ok(!homework.includes('预习资料覆盖了哪些知识点'), '作业批改不应出现预习资料的措辞');
    assert.ok(!preview.includes('批改的作业范围'), '预习资料不应出现作业批改的措辞');
  });

  test('课堂内容总结在 1对1 与小组课下的措辞各自正确', () => {
    const one = buildPrompt({ ...base, module: 'class_content' });
    const group = buildPrompt({ ...base, module: 'class_content', courseType: 'group' });
    assert.match(one, /从内容掌握角度写：.*描述小明本节课的进步与亮点/);
    assert.match(group, /从内容掌握角度写：.*描述同学们在本节课的整体进步与亮点/);
    assert.ok(!group.includes('小明本节课的进步与亮点'), '小组课文案不能出现学生称呼');
    assert.ok(!group.includes('小明本节课的进步与亮点'), '小组课文案不能出现学生称呼');
    // 模块模板里的 {call} 占位符必须替换成「孩子们」，不能残留花括号
    const noteTraceGroup = buildPrompt({ ...base, module: 'note_trace', courseType: 'group' });
    assert.match(noteTraceGroup, /描述孩子们做笔记时的状态/);
    assert.ok(!/(\{[a-zA-Z]+\})/.test(noteTraceGroup), '提示词里不应残留未替换的占位符');
  });

  test('多次课的递进措辞在课堂内容总结里保留', () => {
    const p = buildPrompt({ ...base, module: 'class_content', sessionCount: 3 });
    assert.match(p, /体现知识之间的递进关系/);
    assert.match(p, /针对这 3 次课的综合情况布置巩固练习/);
  });

  test('课堂表现总结只写课堂状态，不写知识点进度', () => {
    const p = buildPrompt({ ...base, module: 'class_performance' });
    assert.match(p, /【课堂表现总结】/);
    assert.match(p, /注意力持续多久、愿不愿意主动发言/);
    assert.match(p, /哪一步开始跟不上/);
    assert.match(p, /要写具体的课堂行为细节/);
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
  test('不传 module 时保存为课堂内容总结', async () => {
    const f = await createFollowUp(token);
    assert.equal(f.module, 'class_content');
  });

  test('传 module 会被保存并回显', async () => {
    for (const m of ['homework_review', 'stage_test', 'makeup_plan'] as FollowUpModule[]) {
      const f = await createFollowUp(token, { module: m });
      assert.equal(f.module, m);
    }
  });

  test('非法 module 回落课堂内容总结而不是报错', async () => {
    const f = await createFollowUp(token, { module: '乱写的值' });
    assert.equal(f.module, 'class_content');
  });

  test('存量数据里的老值 class_summary 读出来回落到课堂内容总结', async () => {
    // DB 默认值是 class_summary，老记录整列都是它，读出必须能安全映射
    const f = await createFollowUp(token, { module: 'class_summary' as any });
    assert.equal(f.module, 'class_content');
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
