import { getSharedClient, describeAiError } from './ai.js';
import { getAiConfig } from '../config/settings.js';
import { log } from '../utils/logger.js';

/**
 * 听评课（独立于课后回访）。
 *
 * 听课人旁听一位老师的 1对1 课，记录课堂实录；本模块据实录生成一份
 * 结构化评课报告，供听课人复制进「星火个性化教学听评课表」Word 文档。
 *
 * 报告刻意输出为**纯文本、无 Markdown、无 emoji**，并严格对齐 Word 表结构：
 *   - 8 个"项目"各一句话（对应 Word 表的评价列）
 *   - 综合评价与建议（亮点 / 待优化 / 建议 / 总体等级）
 * 这样整段复制进 Word 即对齐，不用二次排版。
 */

export interface ObservationReportParams {
  /** 被听课老师姓名 */
  teacherName: string;
  /** 课题 */
  topic: string;
  /** 课型（新授课/复习课/练习课/讲评课/其他） */
  lessonTypeLabel: string;
  /** 听课时间 */
  observedAt?: string | null;
  // —— 以下为 AI 参考（不进 Word 表），帮助模型结合课标准绳 ——
  grade?: string | null;
  subject?: string | null;
  level?: string | null;
  studentName?: string | null;
  /** 听课记录 / 课堂实录（评课的核心依据） */
  classNotes: string;
}

// 8 个评课维度（与 Word 表"项目"列一一对应）
export const OBSERVATION_DIMENSIONS = [
  '教学目标',
  '教学内容',
  '教学方法',
  '学生参与度与学习状态',
  '教学过程',
  '教师素养',
  '教学效果',
  '特色与创新',
] as const;

/**
 * 构建评课提示词。
 * 1对1 课堂：全程禁用"小组/合作/同学们/多名学生"等集体口径。
 */
export function buildObservationPrompt(p: ObservationReportParams): string {
  const ctx: string[] = [];
  ctx.push('- 被听课老师：' + (p.teacherName || '（未填）'));
  ctx.push('- 课题：' + p.topic);
  ctx.push('- 课型：' + p.lessonTypeLabel);
  if (p.observedAt) ctx.push('- 听课时间：' + p.observedAt);
  if (p.grade) ctx.push('- 年级：' + p.grade);
  if (p.subject) ctx.push('- 科目：' + p.subject);
  if (p.level) ctx.push('- 学生水平：' + p.level);
  if (p.studentName) ctx.push('- 学生：' + p.studentName);

  return [
    '# 角色',
    '你是一位经验丰富的教研员，擅长旁听 1对1 课堂并给出专业、具体、可落地的评课意见。',
    '',
    '# 任务',
    '根据下面的听课信息，对这节课的授课老师进行评课。评价必须**具体点出老师在该项的实际表现**（引用听课记录中的细节），避免"较好""基本合理"这类空泛套话。',
    '',
    '# 听课信息',
    ...ctx,
    '',
    '# 听课记录（课堂实录，评课的主要依据）',
    p.classNotes || '（听课记录为空，请基于已知课堂信息谨慎评价，不要臆造未提及的细节）',
    '',
    '# 评课维度（对应 Word 表，需逐项点评）',
    '1、教学目标：是否目标明确、符合课程标准及学生实际；是否体现知识、能力、情感态度与价值观的有机统一。',
    '2、教学内容：是否科学准确、重难点突出；是否联系实际、注重拓展；容量是否适中、安排是否合理。',
    '3、教学方法：是否灵活多样、贴合内容与学情；是否启发引导、调动积极性；信息技术与工具是否恰当。',
    '4、学生参与度与学习状态：1对1 下学生的课堂参与度（主动回应、动手操作、互动）、注意力集中度、思维活跃度（质疑、深入追问）、投入度（听讲、记录、完成度）、情绪状态（兴趣、积极性）。',
    '5、教学过程：环节是否完整、过渡是否自然；师生互动是否良好；时间分配与教学节奏是否恰当。',
    '6、教师素养：教态是否自然大方、语言是否清晰流畅；板书是否规范；应变能力与问题处理是否得当。',
    '7、教学效果：学生知识技能掌握情况、思维能力、课堂目标达成度。',
    '8、特色与创新：本课的独特亮点、在方法或内容设计上的创新。',
    '',
    '# 硬性要求（务必遵守）',
    '1. 这是 1对1 课堂（仅 1 名老师 + 1 名学生），**全程严禁**出现"小组讨论、小组合作、同学们、多名学生、全班"等集体口径。',
    '2. 只输出纯文本：**禁止**任何 Markdown 标记（#、*、-、>、`）、代码块、表情符号。',
    '3. 前 8 个维度每项只写**一句话**，句首带维度名与全角冒号（如"教学目标：……"）。',
    '4. 综合评价与建议分四小点：本节课亮点（分点）、有待优化的部分（分点）、教学建议（1-2 点、可落地）、总体评价等级（从 优秀 / 良好 / 合格 / 有待提高 中选一个）。',
    '5. 直接输出正文，不要任何前言、结语或额外说明，全程中文。',
    '',
    '# 输出格式（务必按此排版）',
    '【听课人评价】',
    OBSERVATION_DIMENSIONS.map((d) => d + '：').join('\n'),
    '',
    '【综合评价与建议】',
    '一、本节课亮点：',
    '1. ……',
    '二、有待优化的部分：',
    '1. ……',
    '三、教学建议：',
    '1. ……',
    '四、总体评价等级：（优秀 / 良好 / 合格 / 有待提高 中填一个）',
  ].join('\n');
}

/** 从生成的报告里解析 AI 建议的总体评价等级，供前端预勾选 */
export function parseSuggestedGrade(report: string): 'excellent' | 'good' | 'pass' | 'needs_work' | null {
  if (!report) return null;
  const m = report.match(/总体评价等级[：:]\s*(优秀|良好|合格|有待提高)/);
  if (!m) return null;
  const map: Record<string, 'excellent' | 'good' | 'pass' | 'needs_work'> = {
    优秀: 'excellent',
    良好: 'good',
    合格: 'pass',
    有待提高: 'needs_work',
  };
  return map[m[1]] ?? null;
}

type ObservationGenerator = (p: ObservationReportParams) => Promise<string>;
let generatorImpl: ObservationGenerator = generateObservationReport;

/** 供测试替换生成实现，避免真实 API 请求 */
export function setObservationGenerator(fn: ObservationGenerator): void {
  generatorImpl = fn;
}
export function resetObservationGenerator(): void {
  generatorImpl = generateObservationReport;
}
/** 路由统一入口 */
export function runObservationGeneration(p: ObservationReportParams): Promise<string> {
  return generatorImpl(p);
}

/** 单次真实生成（不落库、不含字数重试——评课报告比回访长，不设字数窗口） */
export async function generateObservationReport(p: ObservationReportParams): Promise<string> {
  const ai = getSharedClient();
  const config = getAiConfig();
  const body: any = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: '你是一位资深教研员，擅长 1对1 课堂听评课。评价具体、可落地，不空谈。',
      },
      { role: 'user', content: buildObservationPrompt(p) },
    ],
    max_tokens: 4000,
    temperature: 0.5,
    reasoning_effort: config.reasoningEffort,
  };
  const res = await ai.chat.completions.create(body);
  const text = (res.choices[0]?.message?.content || '').trim();
  if (!text) {
    log.warn({}, '评课生成为空');
    throw new Error('AI 未返回评课内容，请重试');
  }
  return text;
}

/** 流式生成：逐块产出评课文本增量（SSE 用），不含字数窗口 */
export async function* streamObservationGeneration(p: ObservationReportParams): AsyncGenerator<string> {
  const ai = getSharedClient();
  const config = getAiConfig();
  const stream = (await ai.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: '你是一位资深教研员，擅长 1对1 课堂听评课。评价具体、可落地，不空谈。',
      },
      { role: 'user', content: buildObservationPrompt(p) },
    ],
    max_tokens: 4000,
    temperature: 0.5,
    reasoning_effort: config.reasoningEffort,
    stream: true,
  })) as any;
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) yield delta as string;
  }
}

/** 流式生成接缝（供测试替换，避免真实 API 请求） */
type ObservationStreamer = (p: ObservationReportParams) => AsyncGenerator<string>;
let streamerImpl: ObservationStreamer = streamObservationGeneration;
export function setObservationStreamer(fn: ObservationStreamer): void {
  streamerImpl = fn;
}
export function resetObservationStreamer(): void {
  streamerImpl = streamObservationGeneration;
}
/** 路由统一流式入口 */
export function runObservationStream(p: ObservationReportParams): AsyncGenerator<string> {
  return streamerImpl(p);
}

/** 暴露错误翻译，供路由复用（与回访一致的用户友好提示） */
export { describeAiError };
