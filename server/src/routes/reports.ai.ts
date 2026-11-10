import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { countWords, correctionText } from '../services/ai/index.js';
import {
  streamReportAi,
  generateReportAiOnce,
  reportWordRange,
  isWordCountOk,
  type ReportAiParams,
  type ReportAiField,
} from '../services/reportAi.js';
import { openSse } from '../utils/sse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseImages } from '../utils/mappers.js';
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
/** monthly_reports 行 + 学生姓名（LEFT JOIN 出来的投影） */
interface ReportWithStudentRow {
  id: number;
  user_id: number;
  student_id: number | null;
  student_name: string | null;
  year_month: string;
  term: string;
  grade: string | null;
  subject: string | null;
  summary_enabled: number;
  plan_enabled: number;
  summary_intro: string | null;
  plan_intro: string | null;
  farewell: string | null;
  created_at: string;
  updated_at: string;
}

/** report_items 完整行 */
interface ReportItemRow {
  id: number;
  user_id: number;
  report_id: number;
  kind: string;
  seq: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  scheduled_at: string | null;
  attendance: string | null;
  notes_done: string | null;
  mistakes_done: string | null;
  homework_done: string | null;
  exam: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
  course_id: number | null;
}

const router = Router();

const reportAiSchema = z.object({
  field: z.enum(['summary', 'plan']),
  // 设置页里给家长的称呼；不传就按学生姓名推导
  nickname: z.string().max(20).optional(),
});

router.post('/:id/ai/stream', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
    .get(id, userId) as ReportWithStudentRow | undefined;
  if (!report) return res.status(404).json({ error: '报告不存在' });

  const items = db
    .prepare('SELECT * FROM report_items WHERE report_id = ? AND user_id = ?')
    .all(id, userId) as ReportItemRow[];
  // 事实预聚合需要出勤 + 三项完成度，所以 pick() 把这些字段一并带上
  // （以前只带 content/type/difficulty，出勤和完成度根本进不了 prompt）。
  const pick = (kind: 'summary' | 'plan') =>
    items
      .filter((i) => i.kind === kind && String(i.content || '').trim())
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
      .map((i) => ({
        content: String(i.content || ''),
        type: String(i.type || ''),
        difficulty: String(i.difficulty || ''),
        attendance: String(i.attendance || ''),
        notes_done: String(i.notes_done || ''),
        mistakes_done: String(i.mistakes_done || ''),
        homework_done: String(i.homework_done || ''),
      }));

  // 回访是「收获 / 进步 / 不足」的主要素材。之前只取 2 条，而一个学生一个月
  // 通常 8-12 次课——只给 2 条等于丢掉大部分素材，总结只能泛泛而谈。
  // 这里按报告所属月份取，避免跨月串味。
  const ym = String(report.year_month || '');
  const followUps = db
    .prepare(
      `SELECT topic, content, images FROM followups
       WHERE user_id = ? AND student_name = ? AND content != '' AND created_at LIKE ? || '-%'
       ORDER BY updated_at DESC, id DESC
       LIMIT 12`
    )
    .all(userId, String(report.student_name || ''), ym) as { topic: string; content: string; images: string }[];

  // 上个月这份学生的总结，用于「上月问题本月是否改善」的连续叙事
  const prevRow = db
    .prepare(
      `SELECT summary_intro FROM monthly_reports
       WHERE user_id = ? AND student_id = ? AND year_month < ? AND summary_intro != ''
       ORDER BY year_month DESC, id DESC
       LIMIT 1`
    )
    .get(userId, report.student_id, ym) as { summary_intro: string } | undefined;

  // 方向 C：近几个月的总结，用于识别「反复出现的问题」——
  // 家长最想看到「这个不足连续三个月了」，单月素材给不出来，得纵向聚合。
  // 只取月份更早的、非空的总结，按月份倒序，最多 6 个月。
  const recentRows = db
    .prepare(
      `SELECT year_month, summary_intro FROM monthly_reports
       WHERE user_id = ? AND student_id = ? AND year_month < ? AND summary_intro != ''
       ORDER BY year_month DESC, id DESC
       LIMIT 6`
    )
    .all(userId, report.student_id, ym) as { year_month: string; summary_intro: string }[];

  // ③ 观察记录↔月度报告打通：把当月的听评课记录也作为 AI 素材
  // 同一学生、同一月份的观察记录，提供课堂细节素材，避免老师重复回忆
  const observations = db
    .prepare(
      `SELECT topic, class_notes, report, observed_at, grade, subject, lesson_type
       FROM observations
       WHERE user_id = ? AND student_name = ? AND observed_at LIKE ? || '-%'
       ORDER BY observed_at DESC, id DESC
       LIMIT 6`
    )
    .all(userId, String(report.student_name || ''), ym) as {
    topic: string;
    class_notes: string;
    report: string;
    observed_at: string;
    grade: string;
    subject: string;
    lesson_type: string;
  }[];

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
    // parseImages 容错解析：try 块之外裸 JSON.parse 会让脏数据把整个 SSE 请求打成 unhandledRejection（Express 4 不接 async 异常，请求永挂）
    followUps: followUps.map(f => ({ topic: f.topic, content: f.content, images: parseImages(f.images) })),
    prevSummary: field === 'summary' ? String(prevRow?.summary_intro || '') : undefined,
    recentSummaries: recentRows.map((r) => ({ yearMonth: String(r.year_month || ''), text: String(r.summary_intro || '') })),
    // ③ 观察记录素材：当月听评课记录，供总结/规划参考课堂细节
    observations: observations.map(o => ({
      topic: o.topic,
      classNotes: o.class_notes,
      report: o.report,
      observedAt: o.observed_at,
      grade: o.grade,
      subject: o.subject,
      lessonType: o.lesson_type,
    })),
  };

  const sse = openSse(req, res);
  const { send } = sse;

  /** 距离字数区间的距离（用于两版都不达标时择优） */
  const wordsDistance = (n: number, range: { min: number; max: number }) =>
    n < range.min ? range.min - n : n > range.max ? n - range.max : 0;

  try {
    let full = '';
    let phase = 'generating';
    // 阶段标记：首次开始生成
    send('phase', { phase, message: field === 'summary' ? '开始生成本月总结...' : '开始生成本月规划...' }, { id: 'phase-generating' });

    for await (const delta of streamReportAi(req.userId!, params)) {
      if (sse.isGone()) break;
      full += delta;
      send('delta', { text: delta });
    }

    phase = 'checking';
    send('phase', { phase, message: '检查字数是否达标...' }, { id: 'phase-checking' });

    let content = full.trim();
    if (!content) {
      log.warn({ reportId: id, field }, 'AI 流式结束但未产出内容，发送 error 事件');
      send('error', { error: 'AI 未返回任何内容，请检查模型配置后重试' });
      return;
    }

    // 字数门禁
    const planCourseCount = field === 'plan' ? params.planCourses.length : undefined;
    const wordRange = reportWordRange(field, planCourseCount);
    let wordCount = countWords(content);
    if (!isWordCountOk(wordCount, wordRange.min, wordRange.max)) {
      phase = 'regenerating';
      send('phase', { phase, message: '字数不达标，正在重试...' }, { id: 'phase-regenerating' });
      send('regenerating', { wordCount, min: wordRange.min, max: wordRange.max });
      try {
        const retryContent = await generateReportAiOnce(
          req.userId!,
          params,
          // 带上上一轮原文：纠偏注释里承诺了「在原素材基础上补/删，而不是重写」，
          // 只给区间数字模型无从修改，只会整篇重写。
          correctionText(wordCount, wordRange) + '\n\n上一轮输出的原文：\n' + content
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

    phase = 'done';
    send('phase', { phase, message: '生成完成' }, { id: 'phase-done' });
    send('done', { content, wordCount });
  } catch (error: any) {
    const message = String(error?.message || 'AI 生成失败');
    log.error({ error: message, reportId: id, field }, '月度总结 / 规划 AI 生成失败');
    send('error', { error: 'AI 生成失败，请稍后再试' });
  } finally {
    sse.end();
  }
}));

export default router;
