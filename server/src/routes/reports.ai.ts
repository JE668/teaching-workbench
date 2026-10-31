import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  countWords,
  correctionText,
} from '../services/ai.js';
import {
  streamReportAi,
  generateReportAiOnce,
  reportWordRange,
  isWordCountOk,
  type ReportAiParams,
  type ReportAiField,
} from '../services/reportAi.js';
import { openSse } from '../utils/sse.js';
import { log } from '../utils/logger.js';
import { z } from 'zod';

/**
 * 月度总结 / 课程规划的 AI 编写。
 *
 *   - POST /:id/ai/stream   SSE 流式，写「本月总结」或「本月规划」两个输入框
 *
 * 不落库：前端把流式正文写进输入框，老师改完跟普通编辑一样保存。
 * 材料取自这块报告自己的课程明细 + 这个学生最近的课后回访，所以
 * 「总结」和「规划」两段写出来不会雷同。
 */
const router = Router();

const reportAiSchema = z.object({
  field: z.enum(['summary', 'plan']),
  // 设置页里给家长的称呼；不传就按学生姓名推导
  nickname: z.string().max(20).optional(),
});

router.post('/:id/ai/stream', async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的报告 id' });

  const parsed = reportAiSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: '参数错误' });
  const { field, nickname } = parsed.data;

  const userId = req.userId!;
  // JOIN 学生表拿姓名：monthly_reports 只存 student_id，之前直接读 report.student_name
  // 永远是 undefined，导致 AI 拿不到称呼、只能退回默认。学生被删时 LEFT JOIN 保住报告本身。
  const report = db
    .prepare(
      `SELECT r.*, s.name AS student_name FROM monthly_reports r
       LEFT JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
       WHERE r.id = ? AND r.user_id = ?`
    )
    .get(id, userId) as any;
  if (!report) return res.status(404).json({ error: '报告不存在' });

  const items = db
    .prepare('SELECT * FROM report_items WHERE report_id = ? AND user_id = ?')
    .all(id, userId) as any[];
  const pick = (kind: 'summary' | 'plan') =>
    items
      .filter((i) => i.kind === kind && String(i.content || '').trim())
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
      .map((i) => ({ content: String(i.content || ''), type: String(i.type || ''), difficulty: String(i.difficulty || '') }));

  // 回访是「收获 / 进步 / 不足」的主要素材。之前只取 2 条，而一个学生一个月
  // 通常 8-12 次课——只给 2 条等于丢掉大部分素材，总结只能泛泛而谈。
  // 这里按报告所属月份取，避免跨月串味。
  const ym = String(report.year_month || '');
  const followUps = db
    .prepare(
      `SELECT topic, content FROM followups
       WHERE user_id = ? AND student_name = ? AND content != '' AND created_at LIKE ? || '-%'
       ORDER BY updated_at DESC, id DESC
       LIMIT 12`
    )
    .all(userId, String(report.student_name || ''), ym) as { topic: string; content: string }[];

  // 上个月这份学生的总结，用于「上月问题本月是否改善」的连续叙事
  const prevRow = db
    .prepare(
      `SELECT summary_intro FROM monthly_reports
       WHERE user_id = ? AND student_id = ? AND year_month < ? AND summary_intro != ''
       ORDER BY year_month DESC, id DESC
       LIMIT 1`
    )
    .get(userId, report.student_id, ym) as any;

  const params: ReportAiParams = {
    field: field as ReportAiField,
    studentName: String(report.student_name || ''),
    nickname,
    grade: String(report.grade || ''),
    subject: String(report.subject || ''),
    term: String(report.term || ''),
    yearMonth: ym,
    summaryCourses: pick('summary'),
    planCourses: pick('plan'),
    followUps,
    prevSummary: field === 'summary' ? String(prevRow?.summary_intro || '') : undefined,
  };

  const sse = openSse(res);
  const { send } = sse;

  /** 距离字数区间的距离（用于两版都不达标时择优） */
  const wordsDistance = (n: number, range: { min: number; max: number }) =>
    n < range.min ? range.min - n : n > range.max ? n - range.max : 0;

  try {
    let full = '';
    for await (const delta of streamReportAi(req.userId!, params)) {
      if (sse.isGone()) break; // 客户端已断开，停止消耗
      full += delta;
      send('delta', { text: delta });
    }

    let content = full.trim();
    if (!content) {
      log.warn({ reportId: id, field }, 'AI 流式结束但未产出内容，发送 error 事件');
      send('error', { error: 'AI 未返回任何内容，请检查模型配置后重试' });
      return;
    }

    // 字数门禁：prompt 要求总结 240-340 字 / 规划 90-160 字（按课次数动态放宽）。
    // 首轮落在区间外就追加纠偏指令重试一次（对齐回访的做法），仍不达标则取更接近区间的一版。
    // 之前没有这道门，模型输出 400 字或 50 字都照单全收，家长看到的总结质量没保障。
    const planCourseCount = field === 'plan' ? params.planCourses.length : undefined;
    const wordRange = reportWordRange(field, planCourseCount);
    let wordCount = countWords(content);
    if (!isWordCountOk(wordCount, wordRange.min, wordRange.max)) {
      send('regenerating', { wordCount, min: wordRange.min, max: wordRange.max });
      try {
        const retryContent = await generateReportAiOnce(
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
        }
      } catch (retryError: any) {
        log.warn({ err: retryError.message }, '报告 AI 重试失败，保留首轮结果');
      }
    }

    send('done', { content, wordCount });
  } catch (error: any) {
    const message = String(error?.message || 'AI 生成失败');
    log.error({ error: message, reportId: id, field }, '月度总结 / 规划 AI 生成失败');
    send('error', { error: 'AI 生成失败，请稍后再试' });
  } finally {
    sse.end();
  }
});

export default router;
