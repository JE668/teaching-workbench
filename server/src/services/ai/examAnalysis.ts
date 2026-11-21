/**
 * 阶测错因分析服务：从试卷图片/文本中分析错因、生成复习微计划
 */
import { z } from 'zod';
import { getClient, getAiConfig, withUserAiSlot } from '../ai/index.js';
import { recordAiMetrics } from '../aiMetrics.js';
import { db } from '../../config/database.js';
import { imageToBase64DataUrl } from './utils.js';

/**
 * 错因标签体系（一级: 二级数组）
 */
export const MISTAKE_TAG_TAXONOMY = {
  '概念不清': ['定义记错', '性质混淆', '公式套用错误', '定理条件遗漏'],
  '技巧缺失': ['解题路径不熟', '辅助线不会加', '换元思维不到', '分类讨论不全'],
  '审题失误': ['条件漏读', '单位未换', '问法理解偏', '隐含条件未挖掘'],
  '计算粗心': ['抄写错', '符号漏', '运算失误', '进位/退位错误'],
  '表达不规范': ['步骤跳跃', '格式不符', '单位缺失', '结论未写明'],
  '时间管理': ['易题超时', '难题不放', '卷面分配失衡', '检查时间不足'],
} as const;

export type MistakePrimaryTag = keyof typeof MISTAKE_TAG_TAXONOMY;
export type MistakeSecondaryTag = (typeof MISTAKE_TAG_TAXONOMY)[MistakePrimaryTag][number];

export interface ExamQuestionAnalysis {
  question_index: number;
  question_type: string;
  mistake_tags: string[];
  root_cause: string;
  review_actions: string[];
  confidence: number;
}

export interface ExamAnalysisResult {
  student_id: number;
  exam_id: number;
  analyses: ExamQuestionAnalysis[];
  summary: {
    tag_distribution: Record<string, number>;
    secondary_distribution: Record<string, number>;
    total_questions: number;
    analyzed_questions: number;
  };
}

/**
 * JSON Schema：引导模型输出结构化错因分析
 */
const EXAM_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_index: { type: 'integer', minimum: 1, description: '题号，从1开始' },
          question_type: { type: 'string', description: '题型：选择题/填空题/解答题/证明题/应用题等' },
          mistake_tags: {
            type: 'array',
            items: { type: 'string', description: '错因标签，格式：一级:二级' },
            minItems: 1,
            maxItems: 3,
          },
          root_cause: { type: 'string', description: '核心错因一句话总结' },
          review_actions: {
            type: 'array',
            items: { type: 'string', description: '可执行的复习动作' },
            minItems: 1,
            maxItems: 3,
          },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: '分析置信度' },
        },
        required: ['question_index', 'question_type', 'mistake_tags', 'root_cause', 'review_actions', 'confidence'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 30,
    },
  },
  required: ['analyses'],
  additionalProperties: false,
};


const EXAM_ANALYSIS_RESULT_SCHEMA = z.object({
  analyses: z.array(z.object({
    question_index: z.number().int().positive(),
    question_type: z.string().trim().min(1),
    mistake_tags: z.array(z.string().trim().min(1)).min(1).max(3),
    root_cause: z.string().trim().min(1),
    review_actions: z.array(z.string().trim().min(1)).min(1).max(3),
    confidence: z.number().finite().min(0).max(1),
  }).strict()).min(1).max(30),
}).strict();

/** 图片路径/内容错误属于请求问题；不得把服务器路径交给模型或降级成无图分析。 */
export class ExamAnalysisImageError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ExamAnalysisImageError';
    this.statusCode = statusCode;
  }
}

/** JSON Schema 只是上游约束；本地必须再次验证结构、题号及标签白名单。 */
function parseExamAnalysisModelContent(content: string, questionCount: number): ExamQuestionAnalysis[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('模型返回的不是有效 JSON');
  }

  const parsed = EXAM_ANALYSIS_RESULT_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error('模型返回结构无效: ' + (issue?.message ?? '未知结构错误'));
  }

  const seenQuestions = new Set<number>();
  for (const analysis of parsed.data.analyses) {
    if (analysis.question_index > questionCount) {
      throw new Error('模型返回题号超出试卷范围: ' + analysis.question_index);
    }
    if (seenQuestions.has(analysis.question_index)) {
      throw new Error('模型返回重复题号: ' + analysis.question_index);
    }
    seenQuestions.add(analysis.question_index);

    for (const tag of analysis.mistake_tags) {
      const parts = tag.split(':');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error('模型返回错因标签格式无效: ' + tag);
      }
      const [primary, secondary] = parts;
      if (!Object.prototype.hasOwnProperty.call(MISTAKE_TAG_TAXONOMY, primary)) {
        throw new Error('模型返回白名单外一级错因标签: ' + primary);
      }
      const allowed = MISTAKE_TAG_TAXONOMY[primary as MistakePrimaryTag] as readonly string[];
      if (!allowed.includes(secondary)) {
        throw new Error('模型返回白名单外二级错因标签: ' + tag);
      }
    }
  }

  return parsed.data.analyses;
}

/**
 * 构建阶测分析 prompt
 */
export function buildExamAnalysisPrompt(params: {
  studentName: string;
  subject: string;
  grade: string;
  examName: string;
  questionCount: number;
  context?: string;
}): string {
  const { studentName, subject, grade, examName, context } = params;

  let prompt = '你是一位资深' + subject + '教研组长，擅长试卷错因诊断。请为学生 ' + studentName + '（' + grade + '，' + subject + '）分析 ' + examName + ' 的错因。\n\n';

  if (context) {
    prompt += '【补充背景】\n' + context + '\n\n';
  }

  prompt += '【错因标签体系（必须从此体系中选择，格式：一级:二级）】\n';
  for (const [primary, secondaries] of Object.entries(MISTAKE_TAG_TAXONOMY)) {
    prompt += '- ' + primary + ': ' + secondaries.join('、') + '\n';
  }
  prompt += '\n';

  prompt += '【输出要求】\n';
  prompt += '1. 逐题分析：每道题给出题型、1-3个错因标签、核心错因一句话、1-3条可执行复习动作、置信度\n';
  prompt += '2. 错因标签必须严格从上述体系中选择，不可自造\n';
  prompt += '3. 复习动作要具体可执行（如："重做同类题3道"、"背诵《二次函数性质》定义5遍"、"错题本标注辅助线构造技巧"），避免泛泛而谈\n';
  prompt += '4. 题号从1开始，按顺序输出\n';
  prompt += '5. 只输出 JSON，不要任何额外文字\n';

  return prompt;
}

/**
 * 分析阶测试卷（支持图片 + 文本）
 */
export async function analyzeExam(
  userId: number,
  params: {
    studentId: number;
    examId: number;
    studentName: string;
    subject: string;
    grade: string;
    examName: string;
    questionCount: number;
    images?: string[];
    text?: string;
    context?: string;
  }
): Promise<ExamAnalysisResult> {
  const start = Date.now();
  const imageDataUrls: string[] = [];
  for (const imagePath of params.images ?? []) {
    try {
      imageDataUrls.push(await imageToBase64DataUrl(imagePath, userId));
    } catch (error: any) {
      const message = error?.message || '图片读取失败';
      const statusCode = message.includes('无权访问') || message.includes('当前用户') ? 403 : 400;
      throw new ExamAnalysisImageError(message, statusCode);
    }
  }

  return withUserAiSlot(userId, async () => {
    const config = getAiConfig(userId);
    const client = getClient(userId, config);

    const prompt = buildExamAnalysisPrompt({
      studentName: params.studentName,
      subject: params.subject,
      grade: params.grade,
      examName: params.examName,
      questionCount: params.questionCount,
      context: params.context,
    });

    // 构建多模态用户内容
    const userContent: any[] = [{ type: 'text', text: prompt }];

    if (params.text) {
      userContent.push({ type: 'text', text: '【试题文本/OCR结果】\n' + params.text });
    }

    for (const imageDataUrl of imageDataUrls) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageDataUrl },
      });
    }

    let response;
    try {
      response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: '你是资深教研组长，擅长试卷错因诊断。只输出 JSON，不要任何额外文字。' },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'exam_analysis', schema: EXAM_ANALYSIS_SCHEMA, strict: true } },
        temperature: 0.2,
        max_tokens: 4000,
      });

      const content = (response.choices[0]?.message?.content || '').trim();
      const analyses = parseExamAnalysisModelContent(content, params.questionCount);

      // 计算汇总统计
      const tagDist: Record<string, number> = {};
      const secondaryDist: Record<string, number> = {};
      for (const a of analyses) {
        for (const tag of a.mistake_tags) {
          const [primary] = tag.split(':');
          tagDist[primary] = (tagDist[primary] || 0) + 1;
          secondaryDist[tag] = (secondaryDist[tag] || 0) + 1;
        }
      }

      const result: ExamAnalysisResult = {
        student_id: params.studentId,
        exam_id: params.examId,
        analyses,
        summary: {
          tag_distribution: tagDist,
          secondary_distribution: secondaryDist,
          total_questions: params.questionCount,
          analyzed_questions: analyses.length,
        },
      };

      // 入库
      await saveExamAnalysis(userId, result);

      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint: 'exam_analysis',
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        latencyMs: Date.now() - start,
        status: 'success',
        wordCount: 0,
      });

      return result;
    } catch (error: any) {
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint: 'exam_analysis',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  });
}

/**
 * 保存分析结果到数据库
 */
async function saveExamAnalysis(userId: number, result: ExamAnalysisResult): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const replaceExam = db.transaction(() => {
    db.prepare(
      'DELETE FROM exam_analysis_details WHERE user_id = ? AND student_id = ? AND exam_id = ?'
    ).run(userId, result.student_id, result.exam_id);

    const insert = db.prepare(
      `INSERT INTO exam_analysis_details
       (user_id, student_id, exam_id, question_index, question_type, mistake_tags,
        root_cause, review_actions, confidence, question_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of result.analyses) {
      insert.run(
        userId,
        result.student_id,
        result.exam_id,
        a.question_index,
        a.question_type,
        JSON.stringify(a.mistake_tags),
        a.root_cause,
        JSON.stringify(a.review_actions),
        a.confidence,
        result.summary.total_questions,
        now
      );
    }
  });
  replaceExam();
}

/**
 * 获取学生某次考试的错因分析
 */
export async function getExamAnalysis(
  userId: number,
  studentId: number,
  examId: number
): Promise<ExamAnalysisResult | null> {
  const rows = db.prepare(
    `SELECT question_index, question_type, mistake_tags, root_cause, review_actions,
            confidence, question_count
     FROM exam_analysis_details
     WHERE user_id = ? AND student_id = ? AND exam_id = ?
     ORDER BY question_index`
  ).all(userId, studentId, examId) as {
    question_index: number;
    question_type: string;
    mistake_tags: string;
    root_cause: string;
    review_actions: string;
    confidence: number;
    question_count: number;
  }[];

  if (rows.length === 0) return null;

  const analyses: ExamQuestionAnalysis[] = rows.map(r => ({
    question_index: r.question_index,
    question_type: r.question_type,
    mistake_tags: JSON.parse(r.mistake_tags),
    root_cause: r.root_cause,
    review_actions: JSON.parse(r.review_actions),
    confidence: r.confidence,
  }));

  const tagDist: Record<string, number> = {};
  const secondaryDist: Record<string, number> = {};
  for (const a of analyses) {
    for (const tag of a.mistake_tags) {
      const [primary] = tag.split(':');
      tagDist[primary] = (tagDist[primary] || 0) + 1;
      secondaryDist[tag] = (secondaryDist[tag] || 0) + 1;
    }
  }

  return {
    student_id: studentId,
    exam_id: examId,
    analyses,
    summary: {
      tag_distribution: tagDist,
      secondary_distribution: secondaryDist,
      // 迁移前的历史明细 question_count=0，只能回退到已分析行数。
      total_questions: rows[0].question_count > 0 ? rows[0].question_count : analyses.length,
      analyzed_questions: analyses.length,
    },
  };
}

/**
 * 获取学生多次考试的错因趋势（用于学生画像）
 */
export async function getStudentMistakeTrend(
  userId: number,
  studentId: number,
  limit = 10
): Promise<{ exam_id: number; exam_name: string; tag_distribution: Record<string, number>; date: string }[]> {
  const examLimit = Number.isFinite(limit) && limit > 0
    ? Math.min(100, Math.max(1, Math.trunc(limit)))
    : 10;
  const rows = db.prepare(
    `SELECT exam_id, mistake_tags, created_at
     FROM exam_analysis_details
     WHERE user_id = ? AND student_id = ? AND exam_id IN (
       SELECT exam_id
       FROM exam_analysis_details
       WHERE user_id = ? AND student_id = ?
       GROUP BY exam_id
       ORDER BY MAX(created_at) DESC, exam_id DESC
       LIMIT ?
     )
     ORDER BY created_at DESC, id DESC`
  ).all(userId, studentId, userId, studentId, examLimit) as {
    exam_id: number;
    mistake_tags: string;
    created_at: string;
  }[];

  const byExam = new Map<number, { tags: string[]; date: string }>();
  for (const r of rows) {
    if (!byExam.has(r.exam_id)) {
      byExam.set(r.exam_id, { tags: [], date: r.created_at });
    }
    byExam.get(r.exam_id)!.tags.push(...JSON.parse(r.mistake_tags));
  }

  return Array.from(byExam.entries()).map(([exam_id, { tags, date }]) => {
    const dist: Record<string, number> = {};
    for (const tag of tags) {
      const [primary] = tag.split(':');
      dist[primary] = (dist[primary] || 0) + 1;
    }
    return { exam_id, exam_name: '考试 ' + exam_id, tag_distribution: dist, date };
  });
}

export { MISTAKE_TAG_TAXONOMY as mistakeTagTaxonomy };
