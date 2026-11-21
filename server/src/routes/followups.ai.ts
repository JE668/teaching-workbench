import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  runFollowUpGeneration,
  runStreamGeneration,
  retryGeneration,
  describeAiError,
  countWords,
  followUpWordRangeForParams,
  type FollowUpGenerateParams,
  type FollowUpHistoryItem,
  structuredToText,
  extractMultimodalObservations,
  multimodalObservationsToText,
} from '../services/ai/index.js';
import { parseStructuredOutput } from '../services/ai/prompt.js';
import { correctionText } from '../services/ai/utils.js';
import { normalizeCourseType, normalizeSessionCount, normalizeFollowUpModule, normalizeFollowUpModules } from '../utils/mappers.js';
import { log } from '../utils/logger.js';
import { validateBody } from '../utils/validation.js';
import {
  createStreamSession,
  finishStreamSession,
  loadStreamForResume,
  openSse,
  persistChunk,
  type StreamTerminalEvent,
} from '../utils/sse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { followUpGenerateSchema } from '../utils/schemas.js';
import { getStudentProfileForGeneration } from '../services/ai/studentProfile.js';

/**
 * AI 生成路由（不落库，由前端确认后再保存）：
 *  - POST /generate            非流式
 *  - POST /generate/stream     SSE 流式
 */
const router = Router();

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
    studentProfile: courseType === 'group' || !Number.isInteger(Number(body.studentId)) || Number(body.studentId) <= 0
      ? undefined
      : getStudentProfileForGeneration(userId, Number(body.studentId)) ?? undefined,
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

// 包装 asyncHandler：buildGenerateParams 若抛错（数据异常/权限/IO），不包会变
// unhandledRejection —— Express 4 不会自动捕获，进程活但请求永不响应。
router.post('/generate', validateBody(followUpGenerateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const error = validateGenerateInput(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const params = buildGenerateParams(req.userId!, req.body);
    const { structured, text, wordCount } = await runFollowUpGeneration(req.userId!, params);

    res.json({ structured, content: text, wordCount });
  } catch (error: any) {
    const { httpStatus, message } = describeAiError(error);
    log.error({ httpStatus, error: message }, 'AI 生成失败');
    res.status(httpStatus).json({ error: message });
  }
}));

/**
 * AI 生成（SSE 流式）。
 * 事件：delta -> regenerating? -> done | error
 * 首轮流式输出，若字数不达标则自动重试一次并以最终版本收尾。
 */
// 包装 asyncHandler：buildGenerateParams 若抛错会变 unhandledRejection；
// SSE headers 已发出时 asyncHandler 会走 res.destroy() 兜底。
router.post('/generate/stream', validateBody(followUpGenerateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const error = validateGenerateInput(req.body);
  if (error) return res.status(400).json({ error });

  const streamIdHeader = req.headers['x-stream-id'];
  const lastEventIdHeader = req.headers['last-event-id'];
  const requestedStreamId = Array.isArray(streamIdHeader) ? streamIdHeader[0] : streamIdHeader;
  const lastEventId = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;

  // 续传是只读操作：校验归属后补发缺失分片与终态，绝不重启上游生成。
  if (requestedStreamId !== undefined || lastEventId !== undefined) {
    if (!requestedStreamId || requestedStreamId.length > 200 || !lastEventId || !/^\d+$/.test(lastEventId)) {
      return res.status(400).json({
        error: '续传必须同时提供有效的 X-Stream-ID 与非负整数 Last-Event-ID',
        code: 'INVALID_RESUME_CURSOR',
      });
    }
    const resume = loadStreamForResume(requestedStreamId, req.userId!, Number(lastEventId));
    if (resume.kind !== 'ready') {
      if (resume.kind === 'not_found') {
        return res.status(404).json({ error: '流会话不存在', code: 'STREAM_NOT_FOUND' });
      }
      if (resume.kind === 'expired') {
        return res.status(410).json({ error: '流会话已过期，请重新生成', code: 'STREAM_EXPIRED' });
      }
      return res.status(409).json({ error: '流仍在生成中，请稍后重连', code: 'STREAM_IN_PROGRESS' });
    }

    const sse = openSse(req, res, requestedStreamId);
    for (const chunk of resume.chunks) {
      sse.send('delta', { text: chunk.delta }, { id: String(chunk.seq) });
    }
    if (resume.terminal) sse.send(resume.terminal.event, resume.terminal.data);
    sse.end();
    return;
  }

  const params = buildGenerateParams(req.userId!, req.body);
  const streamId = `followup-${req.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createStreamSession(streamId, req.userId!);

  const sse = openSse(req, res, streamId);
  const { send } = sse;
  // 网络断开不等于取消生成：继续消费上游并持久化，重连后才能无感补全最终 done。
  // AbortController 仅在生成收尾时兜底释放资源，不绑定 res.close。
  const abort = new AbortController();

  const markInterrupted = () => {
    const terminal: StreamTerminalEvent = {
      event: 'error',
      data: { error: '上游生成已随断线中止，请重新生成', code: 'STREAM_INTERRUPTED' },
    };
    finishStreamSession(streamId, 'interrupted', terminal);
    send(terminal.event, terminal.data);
  };

  try {
    let full = '';
    let phase = 'generating';
    let seq = 0;
    send('phase', { phase, message: '开始生成结构化回访内容...' }, { id: 'phase-generating' });

    for await (const delta of runStreamGeneration(req.userId!, params, abort.signal)) {
      full += delta;
      seq++;
      // 不因 socket 已关闭而跳过持久化：上游在 abort 前交付的缓冲分片仍须可续传。
      persistChunk(streamId, seq, delta, phase);
      send('delta', { text: delta }, { id: String(seq) });
    }

    phase = 'checking';
    send('phase', { phase, message: '检查结构化输出...' }, { id: 'phase-checking' });

    let structured = parseStructuredOutput(full.trim());
    if (!structured) {
      log.warn({ content: full.slice(0, 200) }, '结构化输出解析失败，回退纯文本');
      phase = 'regenerating';
      send('phase', { phase, message: '结构化解析失败，尝试重试...' }, { id: 'phase-regenerating' });
      try {
        const retryResult = await retryGeneration(
          req.userId!,
          params,
          correctionText(full.trim().length, followUpWordRangeForParams(params))
        );
        if (retryResult.structured) {
          structured = retryResult.structured;
          full = retryResult.text;
        }
      } catch (retryError: any) {
        log.warn({ err: retryError.message }, '结构化重试失败');
      }
    }

    const text = structured ? structuredToText(structured) : full.trim();
    const wordCount = countWords(text);
    const donePayload = { structured, content: text, wordCount };

    phase = 'done';
    send('phase', { phase, message: '生成完成' }, { id: 'phase-done' });
    finishStreamSession(streamId, 'done', { event: 'done', data: donePayload });
    send('done', donePayload);
  } catch (error: any) {
    if (sse.isGone() || abort.signal.aborted || error?.name === 'AbortError') {
      markInterrupted();
      return;
    }
    const { message } = describeAiError(error);
    log.error({ error: message }, 'AI 流式生成失败');
    const terminal: StreamTerminalEvent = { event: 'error', data: { error: message } };
    finishStreamSession(streamId, 'error', terminal);
    send(terminal.event, terminal.data);
  } finally {
    abort.abort();
    sse.end();
  }
}));

/**
 * 多模态观察提取（图片直传 + 结构化输出）。
 * 仅提取观察 JSON，不生成回访文本。供前端预览/编辑后再传给回访生成。
 */
router.post('/extract-observations', validateBody(followUpGenerateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const error = validateGenerateInput(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const params = buildGenerateParams(req.userId!, req.body);
    const observations = await extractMultimodalObservations(req.userId!, params);
    const observationText = multimodalObservationsToText(observations);

    res.json({ observations, observationText });
  } catch (error: any) {
    const { httpStatus, message } = describeAiError(error);
    log.error({ httpStatus, error: message }, '多模态观察提取失败');
    res.status(httpStatus).json({ error: message });
  }
}));

export default router;
