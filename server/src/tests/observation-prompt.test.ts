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
