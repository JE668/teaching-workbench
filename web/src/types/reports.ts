/** 月度总结与课程规划的类型定义 */

export type ReportItemKind = 'summary' | 'plan' | 'exam';

export interface MonthlyReport {
  id: number;
  student_id: number;
  student_name: string;
  year_month: string;
  term: string;
  grade: string;
  subject: string;
  summary_enabled: boolean;
  plan_enabled: boolean;
  summary_intro: string;
  plan_intro: string;
  farewell: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReportItem {
  id: number;
  report_id: number;
  kind: ReportItemKind;
  seq: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  scheduled_at: string;
  attendance: string;
  notes_done: string;
  mistakes_done: string;
  homework_done: string;
  exam: string;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface CatalogCourseOption {
  id: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  textbook: string;
  track: string;
}

export interface ExamSuggestion {
  date: string;
  ordinal: string;
  prefix: string;
  content: string;
}

/** 学期选项（对齐课程体系目录里的取值） */
export const TERM_OPTIONS = ['暑假', '秋季', '寒假', '春季', '一轮复习', '二轮复习', '三轮复习'];

/** 出勤 / 笔记整理 / 错题整理 / 作业完成的常用取值 */
export const ATTENDANCE_OPTIONS = ['✅️', '请假', '补', '/'];

/** 学习难度常用取值 */
export const DIFFICULTY_OPTIONS = ['★', '★★', '★★★', '★★★★', '★★★★★', '/'];

/** 课程类型常用取值 */
export const COURSE_TYPE_OPTIONS = ['专题', '同步', '预习', '复习', '一轮复习', '二轮复习', '复习+预习'];

/** '2026-10' → '2026年10月' */
export function formatYearMonth(ym: string): string {
  const m = String(ym).match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}年${Number(m[2])}月` : ym;
}

/** '2026-10-13' → '10.13' */
export function formatShortDate(iso: string): string {
  const m = String(iso).match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}.${m[2]}` : iso;
}
