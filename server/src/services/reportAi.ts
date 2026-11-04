import { runChatOnce, runChatStream, type ChatMessage, type ChatOptions } from './ai/index.js';
import { deriveNickname } from '../utils/nickname.js';
import { monthLabel, nextYearMonth } from '../utils/reportMonth.js';
import { SUMMARY_SECTION_TITLES, PLAN_SECTION_TITLES, SUMMARY_WORD_RANGE, planWordRange } from '../shared/reportTemplate.js';
import { COMMON_RULES } from '../shared/promptTemplates.js';
import { recordAiMetrics } from './aiMetrics.js';

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
  /**
   * 出勤（仅总结行的课有）：'✅️' 正常 / '请假' 请假 / '补' 补课 / '/' 其它。
   * 供事实预聚合统计出勤，喂给模型的事实而非让它猜。
   */
  attendance?: string;
  /** 笔记整理完成度（仅总结行）：'✅️' 视为完成 */
  notes_done?: string;
  /** 错题整理完成度（仅总结行） */
  mistakes_done?: string;
  /** 作业完成度（仅总结行） */
  homework_done?: string;
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
  /**
   * 近几个月（最多 6 个月）的总结，用于识别「反复出现的问题」——
   * 家长最想看到「这个不足连续三个月了」，单月/双月对比给不出来，
   * 得纵向聚合。按月份倒序，text 是该月 summary_intro 全文。
   */
  recentSummaries?: { yearMonth: string; text: string }[];

  /**
   * ③ 观察记录素材：当月听评课记录，供总结/规划参考课堂细节
   * 老师不需要重复回忆，AI 直接用观察记录里的 class_notes / report 写总结
   */
  observations?: {
    topic: string;
    classNotes: string;
    report: string;
    observedAt: string;
    grade: string;
    subject: string;
    lessonType: string;
  }[];
}

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

// ============ 事实预聚合（方向 A + D） ============
// 以前「本月上了几次课」「请假几次」全靠模型自己从课程清单里数，
// 模型经常数错或含糊（「本月计划 x 次课」写错就是家长一眼能看出的硬伤）。
// 这里在代码里把这些确定的事实算好，作为「已核实事实」喂给模型，
// 模型只负责把它们组织成温暖的话，不再承担计数的活。
//
// 注意：笔记/错题/作业不做"完成率"统计。前端这三项只有 ✅️(完成) 和 /(不适用)
// 两种取值，✅️ 还是新加课的默认值 —— 数据里区分不了「没做」和「本来就不适用」，
// 硬算完成率会造出错误事实让模型照抄。所以这里只聚合课次数和出勤分解这类硬事实。

export interface ReportFacts {
  /** 实际上过的课次数（总结用）；或计划上的课次数（规划用） */
  courseCount: number;
  /** 出勤统计：正常上课次数 */
  present: number;
  /** 请假次数 */
  leave: number;
  /** 补课次数 */
  makeup: number;
}

/** 出勤取值 → 归类。'✅️' 正常，'请假' 请假，'补' 补课，其它不计 */
function classifyAttendance(v: string | undefined): 'present' | 'leave' | 'makeup' | null {
  const s = (v || '').trim();
  if (s.includes('✅')) return 'present';
  if (s.includes('请假')) return 'leave';
  if (s === '补' || s.includes('补')) return 'makeup';
  return null;
}

/**
 * 从课程明细聚合出确定的事实。只统计有 content 的行（跟 courseLines 口径一致）。
 * 出勤只有总结行的课才有；规划行的课这个字段为空，聚合出来是 0，
 * 调用方按 field 决定要不要把这些事实写进 prompt。
 */
export function aggregateReportFacts(courses: ReportAiCourse[]): ReportFacts {
  const rows = courses.filter((c) => (c.content || '').trim());
  const facts: ReportFacts = {
    courseCount: rows.length,
    present: 0,
    leave: 0,
    makeup: 0,
  };
  for (const c of rows) {
    const att = classifyAttendance(c.attendance);
    if (att === 'present') facts.present++;
    else if (att === 'leave') facts.leave++;
    else if (att === 'makeup') facts.makeup++;
  }
  return facts;
}

/**
 * 把事实渲染成一段「已核实事实」文本，作为给模型的硬依据。
 * 出勤不完整（如全月满勤）就只写有意义的部分，避免凑字。
 *
 * 注意：笔记/错题/作业不做"完成率"统计。前端这三项只有 ✅️(完成) 和 /(不适用)
 * 两种取值，✅️ 还是新加课的默认值 —— 数据里区分不了「没做」和「本来就不适用」，
 * 硬算完成率会造出错误事实让模型照抄。这里只保留课次数和出勤分解这类硬事实。
 */
export function renderReportFacts(f: ReportFacts): string[] {
  if (f.courseCount === 0) return [];
  const lines: string[] = [];
  lines.push(`本月实际上课 ${f.courseCount} 次`);
  const att: string[] = [];
  if (f.present) att.push(`正常出勤 ${f.present} 次`);
  if (f.leave) att.push(`请假 ${f.leave} 次`);
  if (f.makeup) att.push(`补课 ${f.makeup} 次`);
  if (att.length) lines.push('出勤情况：' + att.join('，'));

  return lines;
}

function followUpLines(items: ReportAiFollowUp[]): string {
  if (!items.length) return '（没有回访记录）';
  return items
    .map((f) => '【' + ((f.topic || '').trim() || '课后回访') + '】\n' + (f.content || '').trim())
    .join('\n\n');
}

/** 观察记录素材：听评课记录的课堂细节 */
function observationsLines(items: ReportAiParams['observations']): string {
  if (!items?.length) return '（没有观察记录）';
  return items
    .map((o) => {
      const parts = [];
      if (o.topic) parts.push('主题：' + o.topic);
      if (o.classNotes) parts.push('课堂记录：' + o.classNotes);
      if (o.report) parts.push('听课报告：' + o.report);
      if (o.lessonType) parts.push('课型：' + o.lessonType);
      if (o.observedAt) parts.push('听课时间：' + o.observedAt.slice(0, 10));
      return '【听评课】' + parts.join(' | ');
    })
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

/**
 * 近几个月总结区块（方向 C 纵向趋势）。核心价值是识别「反复出现的问题」——
 * 家长最想看到「这个不足连续三个月了」，单月甚至双月对比都给不出来，得纵向聚合。
 * 只喂最近几个月的原文让模型自己归纳趋势，不做关键词匹配（那会是伪信号）。
 * 明确要求：只从给定材料归纳，不臆造没出现过的趋势；没发现反复项就别硬凑。
 */
function recentSummariesSection(recent?: { yearMonth: string; text: string }[]): string[] {
  const rows = (recent || []).filter((r) => (r.text || '').trim() && (r.yearMonth || '').trim());
  if (!rows.length) return [];
  return [
    '# 近几个月的报告总结（只用于识别跨月趋势，不要照抄）',
    '下面是这个学生最近几个月的总结，按月份从近到远排列。家长手上可能有这些历史总结，因此：',
    '- 【要】横向对比，找出「反复出现的不足」或「持续在进步的点」，在总结的不足/进步段落里点出来',
    '  （例如"独立性这个月又被提到了，已经是连续第三个月"或"专注力连续两个月在改善"）',
    '- 【不要】臆造材料里没出现的趋势，也不要把单月的事说成反复',
    '- 【不要】照抄这些月份的句子或数据，本段只写本月发生的事，趋势只用来定位反复项',
    '',
    ...rows.map((r) => '【' + r.yearMonth + '】\n' + r.text.trim()),
    '',
  ];
}

/** 写给家长的月度总结：7 个 emoji 段落，跟输入框占位符一一对应 */
export function buildReportSummaryMessages(p: ReportAiParams): ChatMessage[] {
  const w = who(p);
  const month = monthLabel(p.yearMonth);
  // 事实预聚合：出勤 / 完成度 / 课次由代码算好，作为已核实事实喂给模型，
  // 模型只负责组织成温暖的话，不再自己数课次、算比率（以前经常数错或含糊）。
  const facts = aggregateReportFacts(p.summaryCourses);
  const factLines = renderReportFacts(facts);
  const user = [
    '请写这一块报告的本月总结。',
    '',
    '# 学生情况',
    w + '，' + [p.grade, p.subject, p.term].filter(Boolean).join('·'),
    '总结月份：' + (p.yearMonth || '') + suffix(month),
    '',
    '# ' + (month || '本月') + '上过的内容',
    courseLines(p.summaryCourses),
    ...(factLines.length
      ? [
          '',
          '# 已核实的课堂事实（代码从课程明细统计而来，务必照用，不要改动数字，也不要自己重新数）',
          ...factLines,
        ]
      : []),
    '',
    '# 这个学生最近的课后回访（收获 / 进步 / 不足的素材）',
    followUpLines(p.followUps),
    '',
    // ③ 观察记录素材：当月听评课记录，提供课堂细节素材
    '# 这个学生当月的听评课记录（课堂细节素材）',
    observationsLines(p.observations),
    '',
    ...prevSummarySection(p.prevSummary),
    ...recentSummariesSection(p.recentSummaries),
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

  // 规划侧的事实预聚合：规划最该针对的是「上月有请假、进度可能落下」。
  // 由代码算成确定事实喂进来，规划就能点名补进度，而不是泛泛而谈。
  // （笔记/错题/作业不做"未完成"检测 —— 前端这三项只有 ✅️ 和 / 两种取值，
  //   区分不了「没做」和「不适用」，硬算会是伪信号。）
  const summaryFacts = aggregateReportFacts(p.summaryCourses);
  const gaps: string[] = [];
  if (summaryFacts.leave > 0) gaps.push(`本月请假 ${summaryFacts.leave} 次${summaryFacts.makeup > 0 ? `（已补 ${summaryFacts.makeup} 次）` : ''}，下月需留意进度衔接`);

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
    ...(gaps.length
      ? [
          '# 已核实的本月完成度缺口（代码统计而来，下月规划务必针对性安排，不要改动数字）',
          ...gaps,
          '',
        ]
      : []),
    // 趋势用进规划：规划不只针对本月不足，还针对「近几个月反复出现的不足」
    // 给更有针对性的安排（比如独立性连续三个月不足，下月就该安排独立性训练）
    ...recentSummariesSection(p.recentSummaries),
    // ③ 观察记录素材：当月听评课记录，提供课堂细节素材给规划参考
    '# 这个学生当月的听评课记录（课堂细节素材，规划时可参考）',
    observationsLines(p.observations),
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
    ...(p.recentSummaries && p.recentSummaries.some((r) => (r.text || '').trim())
      ? ['4. 上面「近几个月的报告总结」里若有反复出现的不足，下月规划要针对它给具体的改进安排（如安排专项练习、调整教学节奏），不要只重复本月内容。']
      : []),
    followUpImages.length > 0
      ? '5. 若图片素材中可见具体题型/错题/薄弱点，请在规划中针对性安排对应练习或讲解。'
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
  const endpoint = p.field === 'plan' ? 'report_plan_stream' : 'report_summary_stream';
  const { getAiConfig, getClient, countWords } = await import('./ai/index.js');
  const config = getAiConfig(userId);
  const start = Date.now();
  let fullContent = '';
  let recorded = false;
  try {
    for await (const delta of runChatStream(userId, buildReportAiMessages(p), optionsFor(p.field))) {
      fullContent += delta;
      yield delta;
    }
    recorded = true;
    await recordAiMetrics({
      userId,
      provider: config.provider,
      model: config.model,
      endpoint,
      latencyMs: Date.now() - start,
      status: 'success',
      wordCount: countWords(fullContent),
    });
  } catch (error: any) {
    if (!recorded) {
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint,
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
    }
    throw error;
  }
}

/** 非流式，供单测与兜底。correction 为字数纠偏指令（重试时用，追加为一条 user 消息） */
export async function generateReportAiOnce(
  userId: number,
  p: ReportAiParams,
  correction?: string
): Promise<string> {
  const endpoint = p.field === 'plan' ? 'report_plan_once' : 'report_summary_once';
  const { getAiConfig, countWords } = await import('./ai/index.js');
  const config = getAiConfig(userId);
  const start = Date.now();
  try {
    const content = await runChatOnce(userId, buildReportAiMessages(p, correction), optionsFor(p.field));
    await recordAiMetrics({
      userId,
      provider: config.provider,
      model: config.model,
      endpoint,
      latencyMs: Date.now() - start,
      status: 'success',
      wordCount: countWords(content),
    });
    return content;
  } catch (error: any) {
    await recordAiMetrics({
      userId,
      provider: config.provider,
      model: config.model,
      endpoint,
      latencyMs: Date.now() - start,
      status: 'error',
      errorMessage: error.message,
    });
    throw error;
  }
}
