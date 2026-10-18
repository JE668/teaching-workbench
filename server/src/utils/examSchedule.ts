/**
 * 阶测安排自动生成。
 *
 * 规则（教学负责人定）：
 *   - 学期（秋季 / 春季 / 高三复习轮次）：每 3 周一次
 *   - 寒暑假（暑假 / 寒假）：每 2 周一次
 *
 * 起始日期与截止日期取「本次规划里课程的计划上课时间」的最小值与最大值，
 * 也就是这个月的排课跨度，第一个阶测落在 起始 + 间隔 的位置上。
 */

export type TermKind = 'term' | 'break';

export interface ExamSuggestion {
  /** YYYY-MM-DD */
  date: string;
  /** 第几次：第一次 / 第二次 …… */
  ordinal: string;
  /** 学期前缀：秋季度 / 春季度 / 暑假 / 寒假 / 一轮复习 …… */
  prefix: string;
  /** 直接可写进阶测行的文案，末尾留了「：」让老师自己补考试时间 */
  content: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** 判断这个学期是「学期」还是「寒暑假」，决定间隔周数 */
export function termKind(term: string): TermKind {
  return /暑假|寒假/.test(term) ? 'break' : 'term';
}

/** 间隔天数：学期 21 天，寒暑假 14 天 */
export function intervalDays(term: string): number {
  return (termKind(term) === 'break' ? 2 : 3) * 7;
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 中文数字（1-99），用于「第一次 / 第十一次 / 第二十次」 */
export function cnNum(n: number): string {
  if (n < 0) return '';
  if (n < 10) return CN_NUM[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + CN_NUM[n % 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return (tens === 1 ? '' : CN_NUM[tens]) + '十' + (ones ? CN_NUM[ones] : '');
  }
  return String(n);
}

/** 1 → 第一次，11 → 第十一次，25 → 第二十五次 */
export function cnOrdinal(n: number): string {
  return n <= 0 ? '' : '第' + cnNum(n) + '次';
}

/** 学期前缀：秋季 → 秋季度；一轮复习 → 一轮复习 */
export function examPrefix(term: string): string {
  if (/暑假|寒假/.test(term)) return term;
  const m = term.match(/([一二三])轮复习/);
  if (m) return m[1] + '轮复习';
  if (/春季/.test(term)) return '春季度';
  if (/秋季/.test(term)) return '秋季度';
  return term ? term + '季度' : '';
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 把 'YYYY-MM-DD' 当成本地零点解析，避免跨时区串日 */
function parseISO(s: string): number | null {
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * 生成阶测安排。
 *
 * @param term      学期（暑假 / 秋季 / 寒假 / 春季 / 一轮复习 ……）
 * @param startDate 规划里最早的一次课，YYYY-MM-DD
 * @param endDate   规划里最晚的一次课，YYYY-MM-DD
 */
export function generateExamSchedule(
  term: string,
  startDate: string,
  endDate: string
): ExamSuggestion[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (start == null || end == null) return [];

  // 用「天偏移」而不是毫秒累加，避开夏令时那一小时的坑
  const step = intervalDays(term);
  const total = Math.round((end - start) / DAY);
  if (total < step) return [];

  const prefix = examPrefix(term);
  const out: ExamSuggestion[] = [];
  for (let offset = step, i = 1; offset <= total; offset += step, i++) {
    const d = new Date(start + offset * DAY);
    out.push({
      date: toISO(d),
      ordinal: cnOrdinal(i),
      prefix,
      content: `${prefix}${cnOrdinal(i)}阶测安排：时间${d.getMonth() + 1}月${d.getDate()}日：`,
    });
  }
  return out;
}

/** 从一批计划上课时间里取跨度；无效日期忽略 */
export function dateSpan(dates: string[]): { startDate: string; endDate: string } | null {
  let min: number | null = null;
  let max: number | null = null;
  let minISO = '';
  let maxISO = '';
  for (const d of dates) {
    const t = parseISO(d);
    if (t == null) continue;
    if (min == null || t < min) {
      min = t;
      minISO = toISO(new Date(t));
    }
    if (max == null || t > max) {
      max = t;
      maxISO = toISO(new Date(t));
    }
  }
  return minISO && maxISO ? { startDate: minISO, endDate: maxISO } : null;
}
