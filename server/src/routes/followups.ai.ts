import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import {
  runFollowUpGeneration,
  runStreamGeneration,
  retryGeneration,
  describeAiError,
  isWordCountOk,
  countWords,
  MIN_WORDS,
  MAX_WORDS,
  followUpWordRangeForParams,
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
    const { studentName, grade, subject, topic, performance, mastery, images } = req.body;
    const courseType = normalizeCourseType(req.body.courseType);

    const content = await runFollowUpGeneration({
      studentName: studentName || '',
      grade,
      subject,
      topic,
      performance,
      mastery,
      sessionCount: normalizeSessionCount(req.body.sessionCount),
      courseType,
      module: normalizeFollowUpModule(req.body.module),
      modules: normalizeFollowUpModules(req.body.modules ?? req.body.module),
      nickname: req.body.nickname,
      images: images || [],
    });

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

  const { studentName, grade, subject, topic, performance, mastery, images } = req.body;
  const courseType = normalizeCourseType(req.body.courseType);

  const sse = openSse(res);
  const { send } = sse;

  const params = {
    studentName: studentName || '',
    grade,
    subject,
    topic,
    performance,
    mastery,
    sessionCount: normalizeSessionCount(req.body.sessionCount),
    courseType,
    module: normalizeFollowUpModule(req.body.module),
    modules: normalizeFollowUpModules(req.body.modules ?? req.body.module),
    nickname: req.body.nickname,
    images: images || [],
  };

  try {
    let full = '';
    for await (const delta of runStreamGeneration(params)) {
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
        const retryContent = await retryGeneration(params, '约 ' + wordCount + ' 字');
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
