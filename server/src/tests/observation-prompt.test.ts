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
    assert.ok(prompt.includes('听课记录为空'));
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
