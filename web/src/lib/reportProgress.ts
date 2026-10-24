/**
 * 跨月进度分析：把一个学生的月度报告序列，换算成「上月规划 → 本月总结」的达成轨迹。
 *
 * 纯函数、无 IO，方便单测。匹配规则两轮：
 *   1. 优先按来源课程 course_id 对（从课程目录取的课两侧都有 id）；
 *   2. 没对上的再按辅导内容文本精确匹配（手输的课没有 id）。
 * 对上的算「已完成」，上月规划里没对上的算「漏上」，本月总结里不在规划里的算「额外补上」。
 */

import type { ReportItem, ReportItemKind } from '../types/reports';

export interface TrajectoryInput {
  yearMonth: string;
  term: string;
  items: ReportItem[];
}

export interface MonthTrajectory {
  /** 这份报告的月份，形如 2026-09 */
  yearMonth: string;
  term: string;
  /** 对比基准：上一份报告的月份。首月没有基准，为 null */
  baseMonth: string | null;
  /** 基准月规划里的有效课程数（内容非空） */
  planned: number;
  /** 本月总结里的有效课程数 */
  summaryCount: number;
  /** 与基准月规划对上的课程数 */
  completed: number;
  /** 完成率（0-100 的整数）。没有规划基准（首月或基准月没规划课）时为 null */
  rate: number | null;
  /** 基准月规划了、本月没总结的课（漏上） */
  missed: string[];
  /** 本月总结里超出基准月规划的课（额外补上） */
  extraTaught: string[];
  /** 本月阶测条数 */
  examCount: number;
}

export interface TrajectorySummary {
  months: number;
  planned: number;
  completed: number;
  /** 总完成率；基准课程数为 0 时为 null */
  rate: number | null;
  missed: number;
  extraTaught: number;
}

/** 取某个板块里内容非空的明细（空行是「加空行」加出来的，不参与统计） */
function effectiveItems(items: ReportItem[], kind: ReportItemKind): ReportItem[] {
  return items.filter((i) => i.kind === kind && (i.content || '').trim().length > 0);
}

/**
 * 计算跨月轨迹。输入不需要按月排序，输出按月份倒序（最新的月份在最前）。
 * 对比基准是「上一份报告」——月份连续时就是上个自然月；跳月时以实际存在的上一份为准。
 */
export function computeTrajectory(months: TrajectoryInput[]): MonthTrajectory[] {
  const sorted = [...months].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const rows: MonthTrajectory[] = [];

  for (let idx = 0; idx < sorted.length; idx++) {
    const cur = sorted[idx];
    const summary = effectiveItems(cur.items, 'summary');
    const exams = effectiveItems(cur.items, 'exam');
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const plan = prev ? effectiveItems(prev.items, 'plan') : [];

    // 规划侧：标记每门课是否被本月总结对上
    const planHits = plan.map((p) => ({ item: p, hit: false }));
    let completed = 0;
    const extraTaught: string[] = [];

    for (const s of summary) {
      // 第一轮：按 course_id 对
      let target = s.course_id != null ? planHits.find((p) => !p.hit && p.item.course_id === s.course_id) : undefined;
      // 第二轮：按内容文本对
      if (!target) {
        const text = (s.content || '').trim();
        target = planHits.find((p) => !p.hit && p.item.course_id == null && (p.item.content || '').trim() === text);
      }
      if (target) {
        target.hit = true;
        completed++;
      } else {
        extraTaught.push((s.content || '').trim());
      }
    }

    const missed = planHits.filter((p) => !p.hit).map((p) => (p.item.content || '').trim());

    rows.push({
      yearMonth: cur.yearMonth,
      term: cur.term,
      baseMonth: prev ? prev.yearMonth : null,
      planned: plan.length,
      summaryCount: summary.length,
      completed,
      rate: plan.length > 0 ? Math.round((completed / plan.length) * 100) : null,
      extraTaught,
      missed,
      examCount: exams.length,
    });
  }

  return rows.reverse();
}

/** 轨迹的整体汇总（用于弹窗顶部那一排数字） */
export function summarizeTrajectory(rows: MonthTrajectory[]): TrajectorySummary {
  const planned = rows.reduce((n, r) => n + r.planned, 0);
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const missed = rows.reduce((n, r) => n + r.missed.length, 0);
  const extraTaught = rows.reduce((n, r) => n + r.extraTaught.length, 0);
  return {
    months: rows.length,
    planned,
    completed,
    rate: planned > 0 ? Math.round((completed / planned) * 100) : null,
    missed,
    extraTaught,
  };
}
