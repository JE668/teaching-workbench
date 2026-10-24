import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObservationPrompt,
  parseSuggestedGrade,
  OBSERVATION_DIMENSIONS,
} from '../services/observation.js';

describe('评课提示词', () => {
  const p = {
    teacherName: '王老师',
    topic: '分数加减法',
    lessonTypeLabel: '新授课',
    observedAt: '2026-10-17',
    grade: '小学五年级',
    subject: '数学',
    level: '中等',
    studentName: '李小明',
    classNotes: '老师用通分法讲解，学生反应良好。',
  };

  test('包含全部 8 个评课维度', () => {
    const prompt = buildObservationPrompt(p);
    for (const dim of OBSERVATION_DIMENSIONS) {
      assert.ok(prompt.includes(dim), '应包含维度：' + dim);
    }
  });

  test('包含听课信息与 1对1 硬约束', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(prompt.includes('王老师'));
    assert.ok(prompt.includes('分数加减法'));
    assert.ok(prompt.includes('小学五年级'));
    // 1对1 禁集体口径
    assert.ok(prompt.includes('严禁'));
    assert.ok(prompt.includes('小组'));
    assert.ok(prompt.includes('1对1'));
  });

  test('输出格式含两大块 + 四小点综合评价', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(prompt.includes('【听课人评价】'));
    assert.ok(prompt.includes('【综合评价与建议】'));
    assert.ok(prompt.includes('一、本节课亮点'));
    assert.ok(prompt.includes('四、总体评价等级'));
  });

  test('综合三块只写 1 点时直接写内容、不加「1.」，第 2 点起才编号', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(prompt.includes('直接写内容，不要加「1.」这类编号'));
    assert.ok(prompt.includes('此时才从「1.」「2.」开始逐点编号'));
    // 输出格式示例也按不加编号的写法给，避免模型照抄出「1. ……」
    assert.ok(prompt.includes('一、本节课亮点：\n……'));
    assert.ok(!prompt.includes('1. ……'));
  });

  test('空听课记录也给出兜底说明，不臆造', () => {
    const prompt = buildObservationPrompt({ ...p, classNotes: '' });
    assert.ok(prompt.includes('课堂情况记录为空'));
  });

  test('不把学生姓名写进提示词，并要求统一称"学生"', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(!prompt.includes('李小明'), '提示词里不应出现具体学生姓名');
    assert.ok(!prompt.includes('- 学生：'), '不应再以"学生：姓名"的形式给出学生');
    assert.ok(prompt.includes('统一称"学生"'));
    assert.ok(prompt.includes('不要出现任何具体学生姓名'));
  });

  test('禁止"记录中未体现"这类自我声明缺失的说法，改为按等级补充', () => {
    const prompt = buildObservationPrompt(p);
    // 这些词只允许出现在"禁止出现"的那一条条款里
    assert.equal(prompt.split('记录中未体现').length - 1, 2, '"记录中未体现"与"但记录中未体现"各列一次');
    assert.equal(prompt.split('未提及').length - 1, 1);
    assert.equal(prompt.split('从记录无法判断').length - 1, 1);
    assert.equal(prompt.split('信息不足').length - 1, 1);
    assert.ok(prompt.includes('严禁出现'));
    assert.ok(prompt.includes('合理补充'));
    // 旧的"不要臆造未提及的细节"已删除 —— 它与"按等级自行补充"的要求直接冲突
    assert.ok(!prompt.includes('不要臆造'));
  });

  test('输出假定在听评课现场书写，不出现回访/反馈口径', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(prompt.includes('坐在听课现场'));
    assert.ok(prompt.includes('当场写下'));
    for (const banned of ['不要出现"回访"', '不要引用老师提供的记录作为信息来源']) {
      assert.ok(prompt.includes(banned), '缺少条款：' + banned);
    }
  });

  test('措辞要求：不对学生施加心理压力、无指责性表述', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(prompt.includes('避免对学生施加心理压力'));
    assert.ok(prompt.includes('实在不应该'));
  });
});

describe('生成前选定总体评价等级', () => {
  const p = {
    teacherName: '王老师',
    topic: '分数加减法',
    lessonTypeLabel: '新授课',
    classNotes: '老师用通分法讲解，学生反应良好。',
  };

  const CASES = [
    { grade: 'excellent', label: '优秀', tone: '打磨层面的提升' },
    { grade: 'good', label: '良好', tone: '大体平衡' },
    { grade: 'pass', label: '合格', tone: '优点点到为止' },
    { grade: 'needs_work', label: '有待提高', tone: '直指问题所在' },
  ] as const;

  for (const { grade, label, tone } of CASES) {
    test(grade + ' → 提示词写明等级、内容与结论都锁定为「' + label + '」', () => {
      const prompt = buildObservationPrompt({ ...p, overallGrade: grade });

      // 独立成节的强约束
      assert.ok(prompt.includes('# 总体评价等级（你已确定，不要改判）'));
      assert.ok(prompt.includes('这节课的总体评价等级为「' + label + '」'));
      assert.ok(prompt.includes(tone), '应给出该等级对应的内容口径：' + tone);
      // 硬性要求里明确不许改判
      assert.ok(prompt.includes('总体评价等级直接填「' + label + '」，不要改判'));
      // 输出格式模板里直接预填，避免模型自己再选一次
      assert.ok(prompt.includes('四、总体评价等级：' + label));
      // 不该再出现"从中选一个"的自由选项
      assert.ok(!prompt.includes('优秀 / 良好 / 合格 / 有待提高 中填一个'));
    });
  }

  test('四个等级的内容口径互不相同', () => {
    const tones = CASES.map((c) => buildObservationPrompt({ ...p, overallGrade: c.grade }));
    assert.equal(new Set(tones).size, 4);
  });

  test('未选等级：不注入等级约束，保持让 AI 自行判断', () => {
    const prompt = buildObservationPrompt(p);
    assert.ok(!prompt.includes('你已确定，不要改判'));
    assert.ok(prompt.includes('四、总体评价等级：（优秀 / 良好 / 合格 / 有待提高 中填一个）'));
    assert.ok(!prompt.includes('总体评价等级直接填'));
  });
});

describe('建议等级解析', () => {
  test('识别中文等级并映射为代码', () => {
    assert.equal(parseSuggestedGrade('四、总体评价等级：良好'), 'good');
    assert.equal(parseSuggestedGrade('四、总体评价等级：优秀'), 'excellent');
    assert.equal(parseSuggestedGrade('四、总体评价等级：合格'), 'pass');
    assert.equal(parseSuggestedGrade('四、总体评价等级：有待提高'), 'needs_work');
  });

  test('解析不到返回 null（不崩）', () => {
    assert.equal(parseSuggestedGrade('随便一段文字'), null);
    assert.equal(parseSuggestedGrade(''), null);
  });
});
