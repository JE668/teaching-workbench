import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { log } from '../utils/logger.js';
import { z } from 'zod';
import {
  extractKnowledgePoints,
  upsertKnowledgePoints,
  getKnowledgeRadar,
  getWeakPoints,
  recommendRemedialExercises,
} from '../services/ai/index.js';

const router = Router();

const extractSchema = z.object({
  reportId: z.number().int().positive().optional(),
  text: z.string().optional(),
  images: z.array(z.string()).optional(),
  studentName: z.string().min(1),
  subject: z.string().min(1),
  grade: z.string().min(1),
  context: z.string().optional(),
});

/**
 * POST /knowledge/extract
 * 从文本/图片中抽取知识点（不写入 DB，供前端预览/编辑）
 */
router.post(
  '/extract',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const parsed = extractSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: '参数错误', details: parsed.error.flatten() });
    }

    const { text, images, studentName, subject, grade, context } = parsed.data;

    // 校验学生归属
    const student = db
      .prepare('SELECT id FROM students WHERE user_id = ? AND name = ?')
      .get(userId, studentName) as { id: number } | undefined;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    try {
      const result = await extractKnowledgePoints({
        text,
        images,
        studentName,
        subject,
        grade,
        context,
      });

      // 补充 student_id
      result.student_id = student.id;

      res.json({
        points: result.points,
        student_id: student.id,
        subject: result.subject,
        grade: result.grade,
      });
    } catch (error: any) {
      log.error({ err: error.message, userId }, '知识点抽取失败');
      res.status(500).json({ error: '知识点抽取失败，请稍后重试' });
    }
  })
);

/**
 * POST /knowledge/save
 * 将编辑后的知识点写入 DB，更新 mastery_level
 */
router.post(
  '/save',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const { reportId, points, studentId, subject, grade } = req.body as {
      reportId?: number;
      points: Array<{
        point_name: string;
        point_category: 'concept' | 'skill' | 'method' | 'habit';
        evidence: string;
        confidence: number;
        mastery_delta?: number;
      }>;
      studentId: number;
      subject: string;
      grade: string;
    };

    if (!studentId || !subject || !grade || !Array.isArray(points)) {
      return res.status(400).json({ error: '参数错误' });
    }

    // 校验学生归属
    const student = db
      .prepare('SELECT id FROM students WHERE user_id = ? AND id = ?')
      .get(userId, studentId) as { id: number } | undefined;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    try {
      const result = await upsertKnowledgePoints(userId, studentId, subject, grade, points, reportId);
      res.json({ created: result.created, updated: result.updated });
    } catch (error: any) {
      log.error({ err: error.message, userId, studentId }, '知识点保存失败');
      res.status(500).json({ error: '知识点保存失败' });
    }
  })
);

/**
 * GET /knowledge/radar/:studentId/:subject
 * 获取知识雷达数据（按类别聚合 mastery）
 */
router.get(
  '/radar/:studentId/:subject',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const studentId = Number(req.params.studentId);
    const subject = String(req.params.subject);

    if (!Number.isInteger(studentId) || studentId <= 0 || !subject) {
      return res.status(400).json({ error: '参数错误' });
    }

    // 校验学生归属
    const student = db
      .prepare('SELECT id FROM students WHERE user_id = ? AND id = ?')
      .get(userId, studentId) as { id: number } | undefined;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    try {
      const radar = await getKnowledgeRadar(userId, studentId, subject);
      res.json(radar);
    } catch (error: any) {
      log.error({ err: error.message, userId, studentId }, '知识雷达获取失败');
      res.status(500).json({ error: '知识雷达获取失败' });
    }
  })
);

/**
 * GET /knowledge/weak-points/:studentId/:subject
 * 获取薄弱点 Top N
 */
router.get(
  '/weak-points/:studentId/:subject',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const studentId = Number(req.params.studentId);
    const subject = String(req.params.subject);
    const limit = Number(req.query.limit) || 5;

    if (!Number.isInteger(studentId) || studentId <= 0 || !subject) {
      return res.status(400).json({ error: '参数错误' });
    }

    // 校验学生归属
    const student = db
      .prepare('SELECT id FROM students WHERE user_id = ? AND id = ?')
      .get(userId, studentId) as { id: number } | undefined;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    try {
      const weakPoints = await getWeakPoints(userId, studentId, subject, limit);
      res.json({ points: weakPoints });
    } catch (error: any) {
      log.error({ err: error.message, userId, studentId }, '薄弱点获取失败');
      res.status(500).json({ error: '薄弱点获取失败' });
    }
  })
);

/**
 * GET /knowledge/remedial/:studentId/:subject
 * 基于薄弱点推荐补缺题目
 */
router.get(
  '/remedial/:studentId/:subject',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const studentId = Number(req.params.studentId);
    const subject = String(req.params.subject);
    const limit = Number(req.query.limit) || 10;

    if (!Number.isInteger(studentId) || studentId <= 0 || !subject) {
      return res.status(400).json({ error: '参数错误' });
    }

    // 校验学生归属
    const student = db
      .prepare('SELECT id FROM students WHERE user_id = ? AND id = ?')
      .get(userId, studentId) as { id: number } | undefined;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    try {
      const exercises = await recommendRemedialExercises(userId, studentId, subject, limit);
      res.json({ exercises });
    } catch (error: any) {
      log.error({ err: error.message, userId, studentId }, '补缺题目推荐失败');
      res.status(500).json({ error: '补缺题目推荐失败' });
    }
  })
);

export default router;
