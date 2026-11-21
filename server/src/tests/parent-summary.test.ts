import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeParentViewData } from '../services/ai/parentSummary.js';

const source = {
  type: 'followup' as const,
  id: 1,
  studentName: '李小明',
  subject: '数学',
  content: '本节课学习分数通分。',
  createdAt: '2026-11-01 10:00:00',
};

describe('家长摘要规则校验', () => {
  it('清理空白并严格保留三条进步、两条配合和一条下周关注', () => {
    const result = normalizeParentViewData({
      key_progress: [' 已掌握通分 ', '能独立约分', '计算正确率提升', '多余条目'],
      focus_areas: [' 每日口算 ', '主动检查', '多余条目'],
      action_for_parent: ' 下周检查错题整理 ',
      teacher_note: ' 继续保持主动提问 ',
    }, source);

    assert.deepEqual(result, {
      key_progress: ['已掌握通分', '能独立约分', '计算正确率提升'],
      focus_areas: ['每日口算', '主动检查'],
      action_for_parent: '下周检查错题整理',
      teacher_note: '继续保持主动提问',
    });
  });

  it('模型漏项或返回空内容时使用完整兜底摘要', () => {
    for (const invalid of [
      null,
      { key_progress: ['只有一条'], focus_areas: ['配合一', '配合二'], action_for_parent: '下周关注', teacher_note: '加油' },
      { key_progress: ['一', '二', '三'], focus_areas: ['配合一', '配合二'], action_for_parent: '   ', teacher_note: '加油' },
      { key_progress: ['一', '二', '三'], focus_areas: ['配合一', '配合二'], action_for_parent: '下周关注' },
    ]) {
      const result = normalizeParentViewData(invalid, source);
      assert.equal(result.key_progress.length, 3);
      assert.equal(result.focus_areas.length, 2);
      assert.ok(result.action_for_parent.trim());
      assert.ok(result.teacher_note.includes(source.studentName));
    }
  });
});
