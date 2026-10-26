import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  runFollowUpGeneration,
  runStreamGeneration,
  retryGeneration,
  describeAiError,
  isWordCountOk,
  countWords,
  correctionText,
  MIN_WORDS,
  MAX_WORDS,
  followUpWordRangeForParams,
  type FollowUpGenerateParams,
  type FollowUpHistoryItem,
} from '../services/ai.js';
import { normalizeCourseType, normalizeSessionCount, normalizeFollowUpModule, normalizeFollowUpModules } from '../utils/mappers.js';
import { log } from '../utils/logger.js';
import { validateBody } from '../utils/validation.js';
import { openSse } from '../utils/sse.js';
import { followUpGenerateSchema } from '../utils/schemas.js';

/**
 * AI 生成路由（不落库，由前端确认后再保存）：
 *  - POST /generate            非流式
 *  - POST /generate/stream     SSE 流式
 */
const router = Router();

/** 距离字数区间的距离，用于两版都不达标时择优 */
function wordsDistance(
  n: number,
  range: { min: number; max: number } = { min: MIN_WORDS, max: MAX_WORDS }
): number {
  if (n < range.min) return range.min - n;
  if (n > range.max) return n - range.max;
  return 0;
}

/** 单次 AI 请求最多带的课堂照片数。再多只会把请求体撑到数 MB，生成反而更慢 */
const MAX_AI_IMAGES = 4;

/**
 * 取该学生最近的历史回访内容，作为本次生成的上下文。
 * student_id 被删除时会置 NULL（ON DELETE SET NULL），所以要按姓名兜底。
 * 小组课不查——通用反馈面向多位家长，没有个人历史可比，查了反而诱导模型塞个性化细节。
 */
export function fetchFollowUpHistory(
  userId: number,
  studentId: number | string | undefined,
  studentName: string
): FollowUpHistoryItem[] {
  const id = Number(studentId);
  const name = (studentName || '').trim();
  if (!Number.isInteger(id) || !name) return [];

  const rows = db
    .prepare(
      `SELECT topic, content, created_at FROM followups
       WHERE user_id = ? AND content != '' AND student_name = ?
         AND course_type = 'one_on_one'
         AND (? = 0 OR student_id = ?)
       ORDER BY created_at DESC, id DESC
       LIMIT 5`
    )
    .all(userId, name, id, id) as { topic: string; content: string; created_at: string }[];

  return rows.map((r, i) => ({
    content: r.content,
    topic: r.topic || undefined,
    when: whenLabel(i),
  }));
}

/** 相对时间描述：按倒序位置生成「上一次」「上两次」…… */
function whenLabel(index: number): string {
  const prev = index + 1;
  if (prev === 1) return '上一次';
  if (prev <= 5) return '上' + prev + '次';
  return '更早的一次';
}

/** 构造生成参数。两个入口（非流式 / 流式）共用，避免参数漂移。导出供单测验证。 */
export function buildGenerateParams(userId: number, body: any): FollowUpGenerateParams {
  const courseType = normalizeCourseType(body.courseType);
  // 历史只在 1 对 1 时带上：小组课是通用反馈，没有个人历史可比
  const history = courseType === 'group' ? [] : fetchFollowUpHistory(userId, body.studentId, body.studentName);
  return {
    studentName: body.studentName || '',
    grade: body.grade,
    subject: body.subject,
    topic: body.topic,
    performance: body.performance,
    mastery: body.mastery,
    sessionCount: normalizeSessionCount(body.sessionCount),
    courseType,
    module: normalizeFollowUpModule(body.module),
    modules: normalizeFollowUpModules(body.modules ?? body.module),
    nickname: body.nickname,
    images: (body.images || []).slice(0, MAX_AI_IMAGES),
    history,
  };
}

/** 校验 AI 生成入参（年级/学科/主题/表现/掌握程度必填，小组课可免姓名） */
function validateGenerateInput(body: any): string | null {
  const { studentName, grade, subject, topic, performance, mastery } = body;
  const courseType = normalizeCourseType(body.courseType);
  if ((courseType !== 'group' && !studentName) || !grade || !subject || !topic || !performance || !mastery) {
    return '年级、学科、课程主题、课堂表现、掌握程度均为必填项';
  }
  return null;
}

router.post('/generate', validateBody(followUpGenerateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const error = validateGenerateInput(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const params = buildGenerateParams(req.userId!, req.body);
    const content = await runFollowUpGeneration(req.userId!, params);

    const wordCount = countWords(content);
    res.json({ content, wordCount });
  } catch (error: any) {
    const { httpStatus, message } = describeAiError(error);
    log.error({ httpStatus, error: message }, 'AI 生成失败');
    res.status(httpStatus).json({ error: message });
  }
});

/**
 * AI 生成（SSE 流式）。
 * 事件：delta -> regenerating? -> done | error
 * 首轮流式输出，若字数不达标则自动重试一次并以最终版本收尾。
 */
router.post('/generate/stream', validateBody(followUpGenerateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const error = validateGenerateInput(req.body);
  if (error) return res.status(400).json({ error });

  const params = buildGenerateParams(req.userId!, req.body);

  const sse = openSse(res);
  const { send } = sse;

  try {
    let full = '';
    for await (const delta of runStreamGeneration(req.userId!, params)) {
      if (sse.isGone()) break; // 客户端已断开，停止消耗
      full += delta;
      send('delta', { text: delta });
    }

    let content = full.trim();
    let wordCount = countWords(content);
    let regenerated = false;

    // 字数不达标 -> 追加纠偏指令重试一次。区间按板块数放宽：
    // 覆盖 8 个板块的内容天然比 1 个板块长，用死区间会把合格的长文判成不合格。
    const wordRange = followUpWordRangeForParams(params);
    if (!isWordCountOk(wordCount, wordRange.min, wordRange.max)) {
      send('regenerating', { wordCount, min: wordRange.min, max: wordRange.max });
      try {
        const retryContent = await retryGeneration(
          req.userId!,
          params,
          correctionText(wordCount, wordRange)
        );
        const retryWords = countWords(retryContent);
        if (
          isWordCountOk(retryWords, wordRange.min, wordRange.max) ||
          wordsDistance(retryWords, wordRange) < wordsDistance(wordCount, wordRange)
        ) {
          content = retryContent;
          wordCount = retryWords;
          regenerated = true;
        }
      } catch (retryError: any) {
        log.warn({ err: retryError.message }, 'AI 流式重试失败，保留首轮结果');
      }
    }

    send('done', { content, wordCount, regenerated });
  } catch (error: any) {
    const { message } = describeAiError(error);
    log.error({ error: message }, 'AI 流式生成失败');
    send('error', { error: message });
  } finally {
    sse.end();
  }
});

export default router;
