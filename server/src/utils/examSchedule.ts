/**
 * 阶测安排自动生成。
 *
 * 规则（教学负责人定）：
 *   - 学期（秋季 / 春季 / 高三复习轮次）：每 3 周一次
 *   - 寒暑假（暑假 / 寒假）：每 2 周一次
 *
 * 起始日期与截止日期取「本次规划里课程的计划上课时间」的最小值与最大值，
 * 也就是这个月的排课跨度，第一个阶测落在 起始 + 间隔 的位置上。
 *
 * 用 {@link generateExamScheduleWithCourses} 还能算出每场阶测覆盖哪些课：
 * 第 N 场覆盖第 (N-1) 场结束到本场之间的课，方便老师确认这次考的是哪几节。
 */

export type TermKind = 'term' | 'break';

/** 规划里的一节课：只带推算阶测需要的两列 */
export interface PlanCourse {
  /** YYYY-MM-DD */
  date: string;
  /** 课程内容 */
  content: string;
}

export interface ExamSuggestion {
  /** YYYY-MM-DD */
  date: string;
  /** 第几次：第一次 / 第二次 …… */
  ordinal: string;
  /** 学期前缀：秋季度 / 春季度 / 暑假 / 寒假 / 一轮复习 …… */
  prefix: string;
  /** 直接可写进阶测行的文案，末尾留了「：」让老师自己补考试时间 */
  content: string;
  /** 这次阶测覆盖的课，按上课时间先后排好 */
  courses: PlanCourse[];
  /** 覆盖课数 */
  courseCount: number;
  /** 覆盖文案：覆盖A、B（共2课）/ 覆盖A、B、C 等 6 课；没匹配到课就是空串 */
  coverage: string;
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
 * 生成阶测安排。不关心每场阶测覆盖哪些课，只算日期。
 * 需要课对应的用 {@link generateExamScheduleWithCourses}。
 *
 * @param term      学期（暑假 / 秋季 / 寒假 / 春季 / 一轮复习 ……）
 * @param startDate 规划里最早的一次课，YYYY-MM-DD
 * @param endDate   规划里最晚的一次课，YYYY-MM-DD
 */
export function generateExamSchedule(term: string, startDate: string, endDate: string): ExamSuggestion[] {
  return generateExamScheduleWithCourses(term, startDate, endDate, []);
}

/**
 * 生成阶测安排，并算出每场阶测覆盖的课。
 *
 * 第 N 场阶测落在「起始 + N×间隔」上，覆盖的正是第 (N-1) 场结束到本场之间的课；
 * 第一场从起始那天起算（含），之后左开右闭，同一天不会被两场重复统计。
 * 落在起始之前或截止之后的课不挂任何一场 —— 那部分不在本次推算的跨度里。
 *
 * 没传课程时行为和 {@link generateExamSchedule} 完全一致：覆盖是空的，
 * 阶测行文案也不变，这样老的阶测记录和旧导出都不受影响。
 *
 * @param courses 规划里带上课时间的课（date 非法或为空的会被忽略）
 */
export function generateExamScheduleWithCourses(
  term: string,
  startDate: string,
  endDate: string,
  courses: PlanCourse[]
): ExamSuggestion[] {
  const startD = parseISO(startDate);
  const endD = parseISO(endDate);
  if (startD == null || endD == null) return [];

  // 统一换算成「相对起始的天数」，日期加减不吃夏令时那一小时的坑
  const step = intervalDays(term);
  const days = (t: number) => Math.round((t - startD) / DAY);
  const total = days(endD);
  if (total < step) return [];

  // 课程按上课时间排好序；没填课程内容的行不参与覆盖统计（列不进文案）
  const sorted = courses
    .map((c) => {
      const t = parseISO(String(c.date || ''));
      return t == null ? null : { date: toISO(new Date(t)), content: String(c.content || '').trim(), day: days(t) };
    })
    .filter((c): c is { date: string; content: string; day: number } => !!c && !!c.content && c.day >= 0 && c.day <= total)
    .sort((a, b) => a.day - b.day);

  const prefix = examPrefix(term);
  const out: ExamSuggestion[] = [];
  for (let n = 1; n * step <= total; n++) {
    const hi = n * step;
    const lo = (n - 1) * step;
    // 第一场含起始当天，之后左开右闭
    const covered = sorted.filter((c) => (n === 1 ? c.day >= 0 : c.day > lo) && c.day <= hi);
    const names = covered.map((c) => c.content);
    const coverage = formatCoverage(names);
    const d = new Date(startD);
    d.setDate(d.getDate() + n * step);
    out.push({
      date: toISO(d),
      ordinal: cnOrdinal(n),
      prefix,
      content: buildExamContent(prefix, cnOrdinal(n), d, coverage),
      courses: covered.map((c) => ({ date: c.date, content: c.content })),
      courseCount: names.length,
      coverage,
    });
  }
  return out;
}

/** 覆盖文案：前 3 门列出来，超过 3 门只列 3 门加总课数；一门都没有返回空串 */
function formatCoverage(names: string[]): string {
  if (!names.length) return '';
  if (names.length <= 3) return `覆盖${names.join('、')}（共${names.length}课）`;
  return `覆盖${names.slice(0, 3).join('、')}等${names.length}课`;
}

/** 阶测行文案。没覆盖信息时保持老格式，老的阶测行不用改 */
function buildExamContent(prefix: string, ordinal: string, d: Date, coverage: string): string {
  const time = `时间${d.getMonth() + 1}月${d.getDate()}日：`;
  return coverage ? `${prefix}${ordinal}阶测安排：${coverage}；${time}` : `${prefix}${ordinal}阶测安排：${time}`;
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
