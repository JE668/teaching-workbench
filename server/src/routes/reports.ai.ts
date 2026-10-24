import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { streamReportAi, type ReportAiParams, type ReportAiField } from '../services/reportAi.js';
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
  const report = db
    .prepare('SELECT * FROM monthly_reports WHERE id = ? AND user_id = ?')
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

  // 最近的课后回访是「收获 / 进步 / 不足」的素材来源，取两条就够
  const followUps = db
    .prepare(
      `SELECT topic, content FROM followups
       WHERE user_id = ? AND student_id = ? AND content != ''
       ORDER BY updated_at DESC, id DESC
       LIMIT 2`
    )
    .all(userId, report.student_id) as { topic: string; content: string }[];

  const params: ReportAiParams = {
    field: field as ReportAiField,
    studentName: String(report.student_name || ''),
    nickname,
    grade: String(report.grade || ''),
    subject: String(report.subject || ''),
    term: String(report.term || ''),
    yearMonth: String(report.year_month || ''),
    summaryCourses: pick('summary'),
    planCourses: pick('plan'),
    followUps,
  };

  const sse = openSse(res);
  const { send } = sse;
  try {
    let full = '';
    for await (const delta of streamReportAi(params)) {
      if (sse.isGone()) break; // 客户端已断开，停止消耗
      full += delta;
      send('delta', { text: delta });
    }
    send('done', { content: full.trim() });
  } catch (error: any) {
    const message = String(error?.message || 'AI 生成失败');
    log.error({ error: message, reportId: id, field }, '月度总结 / 规划 AI 生成失败');
    send('error', { error: 'AI 生成失败，请稍后再试' });
  } finally {
    sse.end();
  }
});

export default router;
