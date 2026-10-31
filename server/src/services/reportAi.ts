import { runChatStream, runChatOnce, type ChatMessage, type ChatOptions } from './ai.js';
import { deriveNickname } from '../utils/nickname.js';
import { monthLabel, nextYearMonth } from '../utils/reportMonth.js';
import { SUMMARY_SECTION_TITLES, PLAN_SECTION_TITLES, SUMMARY_WORD_RANGE, planWordRange } from '../../shared/reportTemplate.js';

/**
 * 月度总结与课程规划的 AI 编写。
 *
 * 材料只有两样：这块报告自己填的课程明细，和这个学生最近的课后回访正文。
 * 课程明细负责「上了什么 / 打算上什么」，回访正文负责「孩子哪里好、哪里要补」——
 * 这两样合起来才够写一份家长看得下去的总结，只给课程内容清单写出来是干瘪的。
 */

export type ReportAiField = 'summary' | 'plan';

export interface ReportAiCourse {
  content: string;
  type?: string;
  difficulty?: string;
}

export interface ReportAiFollowUp {
  topic: string;
  content: string;
  images?: string[];
}

export interface ReportAiParams {
  field: ReportAiField;
  studentName: string;
  /** 前端设置里的称呼；缺省从姓名推导 */
  nickname?: string;
  grade: string;
  subject: string;
  term: string;
  yearMonth: string;
  summaryCourses: ReportAiCourse[];
  planCourses: ReportAiCourse[];
  followUps: ReportAiFollowUp[];
  /**
   * 上一个月的报告总结。没有它，月度总结只能是孤立的单月陈述——
   * 家长最想看的"上个月的问题这个月解决了吗"就写不出来。
   */
  prevSummary?: string;
}

/** 1对1 + 家长视角的公共红线，回访 / 月度总结口径一致 */
const COMMON_RULES = [
  '2. 只有一对一教学。严禁出现「小组讨论」「小组合作」「同学们」「多名学生」「全班」等集体表述。',
  '3. 不要出现学生的全名，也不要出现别的学生。',
  '4. 只写上面给到的内容。不要编造具体分数、考试排名、名次变化、课堂纪律细节，' +
    '没有回访记录时收获和不足就只依据课程内容清单来写。',
  '5. 收获和进步要落到具体课程内容上，不足要写成家长可以配合的动作，不要情绪化、不要指责孩子。',
  '6. 直接输出正文，不要前言、不要「以下是」这类话，不要重复段落小标题以外的任何说明。',
];

function who(p: ReportAiParams): string {
  const name = (p.studentName || '').trim();
  return (p.nickname && p.nickname.trim()) || deriveNickname(name) || name || '孩子';
}

/** '9月' → '（9月）'；空串原样返回 */
function suffix(month: string): string {
  return month ? '\uFF08' + month + '\uFF09' : '';
}

function courseLines(courses: ReportAiCourse[]): string {
  const rows = courses.map((c) => ({ ...c, content: (c.content || '').trim() })).filter((c) => c.content);
  if (!rows.length) return '（没有课程内容）';
  return rows
    .map((c, i) => {
      const attrs = [c.type, c.difficulty].map((v) => (v || '').trim()).filter(Boolean);
      return (i + 1) + '. ' + c.content + (attrs.length ? '（' + attrs.join('，') + '）' : '');
    })
    .join('\n');
}

function followUpLines(items: ReportAiFollowUp[]): string {
  if (!items.length) return '（没有回访记录）';
  return items
    .map((f) => '【' + ((f.topic || '').trim() || '课后回访') + '】\n' + (f.content || '').trim())
    .join('\n\n');
}

/**
 * 上月总结区块。核心价值是「连续叙事」：上个月提过的问题，
 * 这个月有没有改善——这是家长最关心的，也是单月素材给不出来的。
 * 明确禁止照抄上月原文，只要求呼应进展。
 */
function prevSummarySection(prevSummary?: string): string[] {
  const text = (prevSummary || '').trim();
  if (!text) return [];
  return [
    '# 上个月的报告总结（只用于呼应进展，不要照抄）',
    '下面是一段连续叙事，家长手上会有上个月的那份总结，因此：',
    '- 如果上个月提到的问题，本月确实有改善，【要】明确点出来（例如"上个月提到的……这个月已经能独立完成了"）',
    '- 如果上个月的问题本月仍然存在，【要】如实说明并请家长配合，不要为了好看而说改善',
    '- 【不要】照抄上个月的句子或数据，本段只写本月发生的事',
    '',
    text,
    '',
  ];
}

/** 写给家长的月度总结：7 个 emoji 段落，跟输入框占位符一一对应 */
export function buildReportSummaryMessages(p: ReportAiParams): ChatMessage[] {
  const w = who(p);
  const month = monthLabel(p.yearMonth);
  const user = [
    '请写这一块报告的本月总结。',
    '',
    '# 学生情况',
    w + '，' + [p.grade, p.subject, p.term].filter(Boolean).join('·'),
    '总结月份：' + (p.yearMonth || '') + suffix(month),
    '',
    '# ' + (month || '本月') + '上过的内容',
    courseLines(p.summaryCourses),
    '',
    '# 这个学生最近的课后回访（收获 / 进步 / 不足的素材）',
    followUpLines(p.followUps),
    '',
    ...prevSummarySection(p.prevSummary),
    '# 硬性要求',
    '1. 全程中文，纯文本。**禁止**任何 Markdown 标记（#、*、-、>、反引号）、代码块、表格。emoji 只用在段落开头的小标题上。',
    ...COMMON_RULES,
    '',
    '# 输出格式（务必按此排版，正好 7 行，每行一个段落，总长 ' + SUMMARY_WORD_RANGE.min + '-' + SUMMARY_WORD_RANGE.max + ' 字）',
    ...SUMMARY_SECTION_TITLES,
  ].join('\n');

  return [
    { role: 'system', content: '你是一位1对1教育培训机构的教学顾问，写给家长的月度总结要温暖、具体、有分寸。' },
    { role: 'user', content: user },
  ];
}

/** 写给家长的课程规划：结构化模板（目标 + 内容），不带 emoji，针对上月不足给对策 */
export function buildReportPlanMessages(p: ReportAiParams): ChatMessage[] {
  const w = who(p);
  const month = monthLabel(nextYearMonth(p.yearMonth));
  const planCount = p.planCourses.filter((c) => (c.content || '').trim()).length;
  const wordRange = planWordRange(planCount);
  
  // 收集回访中的图片路径（用于 OCR/图片理解素材）
  const followUpImages = p.followUps
    .flatMap(f => f.images || [])
    .filter((img): img is string => Boolean(img && img.trim()));
  
  const user = [
    '请写这一块报告的课程规划说明。',
    '',
    '# 学生情况',
    w + '，' + [p.grade, p.subject, p.term].filter(Boolean).join('·'),
    '规划月份：' + nextYearMonth(p.yearMonth) + suffix(month),
    '',
    '# ' + (month || '下月') + '计划上的课程内容',
    courseLines(p.planCourses),
    '',
    '# 本月总结里已写的收获和不足（规划要针对性回应，不要只列课程）',
    p.prevSummary && p.prevSummary.trim()
      ? p.prevSummary.trim()
      : p.summaryCourses.length
        ? '本月上过：\n' + courseLines(p.summaryCourses)
        : '（本月还没有内容）',
    '',
    followUpImages.length > 0 ? [
      '# 本月回访中的图片素材（作业、试卷、练习本等，供针对性规划参考）',
      followUpImages.map((img, i) => `${i + 1}. ${img}`).join('\n'),
      '',
    ].join('\n') : '',
    '# 硬性要求',
    '1. 全程中文，纯文本。**禁止**任何 Markdown 标记（#、*、-、>、反引号）、代码块、表格，也**不要用 emoji**。',
    '2. 必须针对上月「不足/建议」给出本月的具体教学安排，不能只罗列课程名称。',
    '3. 每条内容要写清「要让孩子会什么、练到什么程度」，拒绝空泛表述。',
    followUpImages.length > 0
      ? '4. 若图片素材中可见具体题型/错题/薄弱点，请在规划中针对性安排对应练习或讲解。'
      : '',
    ...COMMON_RULES,
    '',
    '# 输出格式（务必按此排版，总长 ' + wordRange.min + '-' + wordRange.max + ' 字）',
    ...PLAN_SECTION_TITLES,
    '   1. [课程1] —— 让孩子会什么、练到什么程度',
    '   2. [课程2] —— ……',
    '（只有 1 点时不要加序号，直接写内容）',
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: '你是一位1对1教育培训机构的教学顾问，写给家长的课程规划要简短、可执行、有针对性。' },
    { role: 'user', content: user },
  ];
}

export function buildReportAiMessages(p: ReportAiParams, correction?: string): ChatMessage[] {
  const msgs =
    p.field === 'plan' ? buildReportPlanMessages(p) : buildReportSummaryMessages(p);
  // 字数纠偏：追加为一条 user 消息，让模型在原素材基础上补/删，而不是重写
  if (correction && correction.trim()) {
    msgs.push({ role: 'user', content: correction });
  }
  return msgs;
}

// 两种任务的温度不同：总结必须贴住事实、稳定不漂移，所以更低；
// 规划是前瞻建议，允许多一点表达弹性。之前两者共用 0.7。
const SUMMARY_OPTIONS: ChatOptions = { temperature: 0.5, maxTokens: 1400 };
const PLAN_OPTIONS: ChatOptions = { temperature: 0.75, maxTokens: 1400 };
const optionsFor = (field: ReportAiField): ChatOptions =>
  field === 'plan' ? PLAN_OPTIONS : SUMMARY_OPTIONS;

/**
 * 字数区间，与 buildReport*Messages 里 prompt 的「总长 240-340 字 / 90-160 字」一致。
 * 路由用它做门禁：首轮流式输出落在区间外时，追加纠偏指令重试一次（对齐回访的做法），
 * 否则模型输出 400 字或 50 字都照单全收，家长看到的总结质量就没保障。
 * 规划按课次数动态放宽：基础 90-160 字，每超 3 门课放宽 15 字上限。
 */
export const REPORT_WORD_RANGE: Record<ReportAiField, { min: number; max: number }> = {
  summary: { min: 240, max: 340 },
  plan: { min: 90, max: 160 },
};

export function reportWordRange(field: ReportAiField, courseCount?: number): { min: number; max: number } {
  const base = REPORT_WORD_RANGE[field];
  if (field === 'plan' && courseCount && courseCount > 3) {
    // 每超 3 门课，上限放宽 15 字（下限不变，保证精炼）
    const extra = Math.floor((courseCount - 1) / 3) * 15;
    return { min: base.min, max: base.max + extra };
  }
  return base;
}

export function isWordCountOk(n: number, min: number, max: number): boolean {
  return n >= min && n <= max;
}

/** 流式产出总结 / 规划的正文增量 */
export async function* streamReportAi(userId: number, p: ReportAiParams): AsyncGenerator<string> {
  yield* runChatStream(userId, buildReportAiMessages(p), optionsFor(p.field));
}

/** 非流式，供单测与兜底。correction 为字数纠偏指令（重试时用，追加为一条 user 消息） */
export async function generateReportAiOnce(
  userId: number,
  p: ReportAiParams,
  correction?: string
): Promise<string> {
  return runChatOnce(userId, buildReportAiMessages(p, correction), optionsFor(p.field));
}
