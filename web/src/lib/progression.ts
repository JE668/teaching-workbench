/**
 * 学生掌握程度纵向对比。
 *
 * 从已有回访记录里按时间序列比较"掌握程度"，算出这个学生是在进步还是退步。
 * 纯前端计算：档案接口本来就返回了该学生的全部回访，不需要新增端点。
 *
 * 设计上的两个取舍：
 *  1. 用**前半段均值 vs 后半段均值**而不是"第一条 vs 最后一条"——
 *     单点容易被一次偶然的评分带偏，两段均值更稳。
 *  2. 不在这里做文案拼装，只给结构化结果。文案和样式由页面决定。
 */

/** 掌握程度 → 分值。未识别的值给 null，比较时跳过，不计入分母 */
export const MASTERY_SCORE: Record<string, number> = {
  excellent: 4,
  good: 3,
  average: 2,
  needs_improvement: 1,
};

export type Trend = 'up_strong' | 'up' | 'flat' | 'down' | 'down_strong' | 'insufficient';

export interface ProgressionPoint {
  /** 回访时间（ISO 字符串） */
  date: string;
  topic: string;
  mastery: string;
  /** 未识别的掌握程度为 null */
  score: number | null;
}

export interface Progression {
  /** 已按时间升序（从早到晚）排好的点 */
  points: ProgressionPoint[];
  firstAvg: number | null;
  lastAvg: number | null;
  /** lastAvg - firstAvg */
  delta: number;
  trend: Trend;
  /** 参与计算（分值不为空）的点数量 */
  scored: number;
}

export const TREND_META: Record<Trend, { label: string; tone: 'emerald' | 'green' | 'slate' | 'amber' | 'rose' }> = {
  up_strong: { label: '明显提升', tone: 'emerald' },
  up: { label: '稳步提升', tone: 'green' },
  flat: { label: '基本持平', tone: 'slate' },
  down: { label: '略有下滑', tone: 'amber' },
  down_strong: { label: '明显下滑', tone: 'rose' },
  insufficient: { label: '数据不足', tone: 'slate' },
};

function avg(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function classify(delta: number): Trend {
  // 分值区间是 1-4，全跨度 3 档。
  // 差 1 档算"稳步"，差 1.5 档及以上才算"明显"
  if (delta >= 1.5) return 'up_strong';
  if (delta >= 0.5) return 'up';
  if (delta > -0.5) return 'flat';
  if (delta > -1.5) return 'down';
  return 'down_strong';
}

export function buildProgression(
  followups: { id?: number; createdAt: string; topic: string; mastery: string }[]
): Progression {
  // 同一时刻的多条回访（同一天补录很常见）用 id 兜底排序，
  // 这样无论后端返回顺序如何，"先录的那条"始终被当作更早的一次
  const points: ProgressionPoint[] = [...followups]
    .sort(
      (a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt)) ||
        (a.id ?? 0) - (b.id ?? 0)
    )
    .map((f) => ({
      date: f.createdAt,
      topic: f.topic,
      mastery: f.mastery,
      score: MASTERY_SCORE[f.mastery] ?? null,
    }));

  const scored = points.length;
  const empty: Progression = {
    points,
    firstAvg: null,
    lastAvg: null,
    delta: 0,
    trend: 'insufficient',
    scored,
  };

  const valid = points.filter((p): p is ProgressionPoint & { score: number } => p.score !== null);
  // 至少两段各一条，才谈得上"变化"
  if (valid.length < 2) return empty;

  const half = Math.ceil(valid.length / 2);
  const firstAvg = avg(valid.slice(0, half).map((p) => p.score));
  const lastAvg = avg(valid.slice(half).map((p) => p.score));
  if (firstAvg === null || lastAvg === null) return empty;

  const delta = lastAvg - firstAvg;
  return { points, firstAvg, lastAvg, delta, trend: classify(delta), scored };
}
