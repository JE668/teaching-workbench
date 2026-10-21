import { getSharedClient, withAiSlot, acquireAiSlot, releaseAiSlot, describeAiError } from './ai.js';
import { getAiConfig } from '../config/settings.js';
import { OVERALL_GRADE_LABELS } from '../utils/mappers.js';
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

/** 总体评价等级（与 web 端 OverallGrade 保持一致） */
export type Grade = 'excellent' | 'good' | 'pass' | 'needs_work';

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
  /** 学生姓名（仅供档案存储与列表展示；**不进入 AI 提示词**，报告统一称"学生"） */
  studentName?: string | null;
  /** 老师提供的课后课堂情况记录（评课的核心依据；可含课堂实录，也常是老师课后回访的内容） */
  classNotes: string;
  /** 生成前用户已选定的总体评价等级；AI 据此调整内容口径，不再自行判断 */
  overallGrade?: Grade | null;
}

/** 各等级对应的内容口径 —— 选等级不只是改一行结论，整份评课的详略都要跟它走 */
const GRADE_TONE: Record<Grade, string> = {
  excellent: '优秀：8 个维度以具体亮点为主，"有待优化的部分"只写 1 点，且属于打磨层面的提升、措辞轻微。',
  good: '良好：亮点与不足大体平衡，"有待优化的部分"写 1-2 点，教学建议与之对应。',
  pass: '合格：优点点到为止，"有待优化的部分"写 2 点并具体到做法，教学建议要可落地。',
  needs_work: '有待提高：优点只用一句话带过，"有待优化的部分"写 2 点、直指问题所在，教学建议要具体、充分、可逐步执行。',
};

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
 *
 * 输入实际是老师提供的课后回访记录，不是逐句课堂实录，
 * 所以要求 AI 据其还原课堂情况，但产出必须读起来像
 * 「坐在听课现场当场写下」的评课，不能出现任何"回访/反馈"口径。
 *
 * 1对1 课堂：全程禁用"小组/合作/同学们/多名学生"等集体口径。
 */
export function buildObservationPrompt(p: ObservationReportParams): string {
  // 注意：学生姓名有意不放进提示词 —— 报告统一称"学生"。
  // 传进去模型很容易顺着写具体名字，尤其报告会被打印进 Word 表。
  const ctx: string[] = [];
  ctx.push('- 被听课老师：' + (p.teacherName || '（未填）'));
  ctx.push('- 课题：' + p.topic);
  ctx.push('- 课型：' + p.lessonTypeLabel);
  if (p.observedAt) ctx.push('- 听课时间：' + p.observedAt);
  if (p.grade) ctx.push('- 年级：' + p.grade);
  if (p.subject) ctx.push('- 科目：' + p.subject);
  if (p.level) ctx.push('- 学生水平：' + p.level);

  const notes = p.classNotes || '（课堂情况记录为空：请依据课题、课型与学生水平，给出与该课型常规情形相符的评价，不要声明信息缺失）';

  // 用户已在生成前选定总体评价等级时，整份评课的内容口径都要跟它走，
  // 而不是照常让 AI 自行判断、最后只改一行结论。
  const gradeLabel = p.overallGrade ? OVERALL_GRADE_LABELS[p.overallGrade] : null;
  const gradeBlock: string[] = gradeLabel
    ? [
        '# 总体评价等级（你已确定，不要改判）',
        '这节课的总体评价等级为「' + gradeLabel + '」。',
        GRADE_TONE[p.overallGrade!],
        '',
      ]
    : [];

  return [
    '# 角色',
    '你是一位经验丰富的教研员，擅长旁听 1对1 课堂并现场书写专业、具体、可落地的评课意见。',
    '',
    '# 任务',
    '根据下面老师提供的课后课堂情况记录，还原并评价这节课的实际授课情况。',
    '评价必须具体点出老师在该项的实际表现，避免"较好""基本合理"这类空泛套话。',
    '整份报告假定是你坐在听课现场、依据自己对这节课的观察当场写下的评课。',
    '',
    '# 听课信息',
    ...ctx,
    '',
    '# 老师提供的课堂情况记录（评课的主要依据）',
    notes,
    '',
    ...gradeBlock,
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
    '1. 这是 1对1 课堂（仅 1 名老师 + 1 名学生），全程严禁出现"小组讨论、小组合作、同学们、多名学生、全班"等集体口径。',
    '2. 报告中统一称"学生"，不要出现任何具体学生姓名。',
    '3. 严禁出现"记录中未体现""但记录中未体现""未提及""从记录无法判断""信息不足"这类自我声明缺失的说法。' +
      '某个维度缺少具体细节时，依据整节课的总体表现和总体评价等级合理补充一句建设性评价，不要声明缺失。',
    '4. 报告只围绕课堂本身展开。不要出现"回访""反馈""沟通""课后回访""据回访""根据老师记录"等字样，' +
      '也不要引用老师提供的记录作为信息来源 —— 所有结论都要写成你自己在课堂上观察到的。',
    '5. 措辞专业、就事论事、以改进为目的。避免对学生施加心理压力的表述，' +
      '避免带有指责或情绪化色彩的措辞（如"实在不应该""不应该出现"）。',
    '6. 只输出纯文本：**禁止**任何 Markdown 标记（#、*、-、>、`）、代码块、表情符号。',
    '7. 前 8 个维度每项只写**一句话**，句首带维度名与全角冒号（如"教学目标：……"）。',
    '8. 综合评价与建议分四小点：本节课亮点、有待优化的部分、教学建议、总体评价等级。' +
      '前三块每块**默认只写 1 点**，一句话讲透就够；确实有必要才补第 2 点，每点单独一行并单独编号（1. / 2.），' +
      '不要挤进同一句、也不要用「一、二、三」等二级标题。' +
      (gradeLabel
        ? '总体评价等级直接填「' + gradeLabel + '」，不要改判，也不要另行判断。'
        : '总体评价等级从 优秀 / 良好 / 合格 / 有待提高 中选一个。'),
    '9. 直接输出正文，不要任何前言、结语或额外说明，全程中文。',
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
    '四、总体评价等级：' + (gradeLabel ? gradeLabel : '（优秀 / 良好 / 合格 / 有待提高 中填一个）'),
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
  return withAiSlot(async () => {
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
  });
}

/** 流式生成：逐块产出评课文本增量（SSE 用），不含字数窗口 */
export async function* streamObservationGeneration(
  p: ObservationReportParams
): AsyncGenerator<string> {
  // 占位直到流读完：一次评课生成可持续几十秒
  await acquireAiSlot();
  try {
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
      stream: true,
    };
    const stream = (await ai.chat.completions.create(body)) as any;
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) yield delta as string;
    }
  } finally {
    releaseAiSlot();
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
