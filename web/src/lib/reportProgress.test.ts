import { describe, expect, it } from 'vitest';
import { computeTrajectory, summarizeTrajectory, type TrajectoryInput } from './reportProgress';
import type { ReportItem, ReportItemKind } from '../types/reports';

let seq = 0;
function item(kind: ReportItemKind, content: string, courseId: number | null = null): ReportItem {
  return {
    id: ++seq,
    report_id: 0,
    kind,
    seq,
    content,
    type: '',
    score: '',
    difficulty: '',
    scheduled_at: '',
    attendance: '',
    notes_done: '',
    mistakes_done: '',
    homework_done: '',
    exam: '',
    course_id: courseId,
    sort: seq,
    created_at: '',
    updated_at: '',
  };
}

function month(yearMonth: string, items: ReportItem[], term = '秋季'): TrajectoryInput {
  return { yearMonth, term, items };
}

describe('computeTrajectory', () => {
  it('没有报告时返回空数组', () => {
    expect(computeTrajectory([])).toEqual([]);
  });

  it('只有一个月（首月）时：无基准，总结全算额外补上，完成率为 null', () => {
    const rows = computeTrajectory([month('2026-09', [item('summary', '空气的成分')])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].baseMonth).toBeNull();
    expect(rows[0].planned).toBe(0);
    expect(rows[0].summaryCount).toBe(1);
    expect(rows[0].completed).toBe(0);
    expect(rows[0].rate).toBeNull();
    expect(rows[0].extraTaught).toEqual(['空气的成分']);
    expect(rows[0].missed).toEqual([]);
  });

  it('按 course_id 对上规划与总结：完成 + 漏上 + 额外都能算对', () => {
    const rows = computeTrajectory([
      month('2026-08', [item('plan', '金属活动性', 4), item('plan', '酸碱盐', 5)]),
      month('2026-09', [item('summary', '金属活动性', 4), item('summary', '氧气', 2)]),
    ]);
    // 输出倒序：最新月份在前
    expect(rows[0].yearMonth).toBe('2026-09');
    expect(rows[0].baseMonth).toBe('2026-08');
    expect(rows[0].planned).toBe(2);
    expect(rows[0].completed).toBe(1);
    expect(rows[0].rate).toBe(50);
    expect(rows[0].missed).toEqual(['酸碱盐']);
    expect(rows[0].extraTaught).toEqual(['氧气']);
    // 上月那行是首月：无基准
    expect(rows[1].yearMonth).toBe('2026-08');
    expect(rows[1].rate).toBeNull();
  });

  it('手输的课没有 course_id，按内容文本也能对上', () => {
    const rows = computeTrajectory([
      month('2026-08', [item('plan', '圆的基础性质')]),
      month('2026-09', [item('summary', '圆的基础性质')]),
    ]);
    expect(rows[0].completed).toBe(1);
    expect(rows[0].missed).toEqual([]);
    expect(rows[0].extraTaught).toEqual([]);
    expect(rows[0].rate).toBe(100);
  });

  it('course_id 优先：同名课程 id 不同不算对上，id 相同名字变了也算对上', () => {
    const rows = computeTrajectory([
      month('2026-08', [item('plan', '空气的成分', 11), item('plan', '氧气', 2)]),
      // 11 号课内容改了名（比如补写说明），仍然按 id 对上；同名但 id 是 12 的算另一门
      month('2026-09', [item('summary', '空气的成分（复习）', 11), item('summary', '氧气', 12)]),
    ]);
    expect(rows[0].completed).toBe(1);
    expect(rows[0].missed).toEqual(['氧气']);
    expect(rows[0].extraTaught).toEqual(['氧气']);
  });

  it('跳月时以实际存在的上一份报告为基准', () => {
    const rows = computeTrajectory([
      month('2026-06', [item('plan', '有理数', 1)]),
      month('2026-09', [item('summary', '有理数', 1)]),
    ]);
    expect(rows[0].baseMonth).toBe('2026-06');
    expect(rows[0].completed).toBe(1);
    expect(rows[0].rate).toBe(100);
  });

  it('空行和空白内容不参与统计；阶测单独计数', () => {
    const rows = computeTrajectory([
      month('2026-08', [item('plan', '  '), item('plan', '水', 3), item('exam', '阶测安排：第一次月考')]),
      month('2026-09', [item('summary', ''), item('summary', '水', 3), item('exam', '阶测安排：期中考')]),
    ]);
    expect(rows[0].planned).toBe(1);
    expect(rows[0].completed).toBe(1);
    expect(rows[0].summaryCount).toBe(1);
    expect(rows[0].examCount).toBe(1);
    // 上月那行的阶测数也单独数
    expect(rows[1].examCount).toBe(1);
  });

  it('同一门课在规划里出现两次、总结只上了一次，只对上一个', () => {
    const rows = computeTrajectory([
      month('2026-08', [item('plan', '氧气', 2), item('plan', '氧气', 2)]),
      month('2026-09', [item('summary', '氧气', 2)]),
    ]);
    expect(rows[0].planned).toBe(2);
    expect(rows[0].completed).toBe(1);
    expect(rows[0].missed).toEqual(['氧气']);
    expect(rows[0].rate).toBe(50);
  });
});

describe('summarizeTrajectory', () => {
  it('汇总各月数字，总完成率按规划总数算', () => {
    const rows = computeTrajectory([
      month('2026-08', [item('plan', '金属活动性', 4), item('plan', '酸碱盐', 5)]),
      month('2026-09', [item('summary', '金属活动性', 4), item('summary', '氧气', 2)]),
      month('2026-09', [item('plan', '氧气', 2)]),
    ]);
    const s = summarizeTrajectory(rows);
    expect(s.months).toBe(3);
    expect(s.planned).toBe(2);
    expect(s.completed).toBe(1);
    expect(s.rate).toBe(50);
    expect(s.missed).toBe(1);
    expect(s.extraTaught).toBe(1);
  });

  it('完全没有规划基准时总完成率为 null', () => {
    const rows = computeTrajectory([month('2026-09', [item('summary', '空气的成分')])]);
    const s = summarizeTrajectory(rows);
    expect(s.planned).toBe(0);
    expect(s.rate).toBeNull();
  });
});
