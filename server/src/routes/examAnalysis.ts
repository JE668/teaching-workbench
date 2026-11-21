import { Router } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { log } from '../utils/logger.js';
import { z } from 'zod';
import { analyzeExam, getExamAnalysis } from '../services/ai/index.js';
import { ExamAnalysisImageError } from '../services/ai/examAnalysis.js';

const router = Router();

/**
 * POST /api/exam-analysis/analyze
 * 分析阶测试卷错因（支持图片 + 文本）
 * Body: { studentId, examId, studentName, subject, grade, examName, questionCount, images?, text?, context? }
 */
router.post('/analyze', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    studentId: z.number().int().positive(),
    examId: z.number().int().positive(),
    studentName: z.string().min(1),
    subject: z.string().min(1),
    grade: z.string().min(1),
    examName: z.string().min(1),
    questionCount: z.number().int().positive().max(50),
    images: z.array(z.string()).optional(),
    text: z.string().optional(),
    context: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: '参数校验失败', details: parsed.error.flatten() });
  }

  const { studentId, examId, studentName, subject, grade, examName, questionCount, images, text, context } = parsed.data;

  // 验证学生归属
  const userId = req.userId!;
  const student = db.prepare('SELECT id FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
  if (!student) {
    return res.status(404).json({ error: '学生不存在' });
  }

  try {
    const result = await analyzeExam(userId, {
      studentId,
      examId,
      studentName,
      subject,
      grade,
      examName,
      questionCount,
      images,
      text,
      context,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    log.error({ err: error, userId: req.userId }, '阶测错因分析失败');
    if (error instanceof ExamAnalysisImageError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: '分析失败' });
  }
}));

/**
 * GET /api/exam-analysis/:studentId/:examId
 * 获取已存的错因分析结果
 */
router.get('/:studentId/:examId', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const studentId = Number(req.params.studentId);
  const examId = Number(req.params.examId);
  const userId = req.userId!;

  if (!studentId || !examId) {
    return res.status(400).json({ error: '参数错误' });
  }

  // 验证学生归属
  const student = db.prepare('SELECT id FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
  if (!student) {
    return res.status(404).json({ error: '学生不存在' });
  }

  const result = await getExamAnalysis(userId, studentId, examId);
  if (!result) {
    return res.status(404).json({ error: '暂无分析结果，请先分析' });
  }

  res.json({ success: true, data: result });
}));

/**
 * GET /api/exam-analysis/student/:studentId/trend
 * 获取学生错因趋势（用于学生画像）
 */
router.get('/student/:studentId/trend', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const studentId = Number(req.params.studentId);
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
    : 10;
  const userId = req.userId!;

  if (!studentId) {
    return res.status(400).json({ error: '参数错误' });
  }

  const student = db.prepare('SELECT id FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
  if (!student) {
    return res.status(404).json({ error: '学生不存在' });
  }

  const { getStudentMistakeTrend } = await import('../services/ai/index.js');
  const trend = await getStudentMistakeTrend(userId, studentId, limit);

  res.json({ success: true, data: trend });
}));

export default router;
