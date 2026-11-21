import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { db } from '../config/database.js';
import { buildStudentProfile, getStudentProfile, updateStudentProfile, buildAllStudentProfiles } from '../services/ai/studentProfile.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { log } from '../utils/logger.js';
import { recordChangeEvent } from '../services/content/references.js';

const router = Router();

function respondInternalError(res: Response, error: unknown, publicMessage: string): void {
  log.error({ err: error }, publicMessage);
  res.status(500).json({ error: publicMessage });
}

/** 将数据库存储结构统一为前端使用的嵌套画像 + 元数据结构。 */
function getProfileResponse(userId: number, studentId: number) {
  const stored = getStudentProfile(userId, studentId);
  if (!stored) return null;
  const student = db.prepare('SELECT name FROM students WHERE id = ? AND user_id = ?').get(studentId, userId) as { name: string } | undefined;
  const { id, source_summary, confirmed_by_teacher, teacher_notes, ...profile } = stored;
  return {
    id,
    studentId,
    studentName: student?.name ?? '',
    profile,
    sourceSummary: source_summary,
    confidence: profile.confidence,
    generatedAt: profile.updated_at,
    confirmedByTeacher: confirmed_by_teacher,
    teacherNotes: teacher_notes,
  };
}

/** 获取学生画像 */
router.get('/:studentId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const studentId = parseInt(req.params.studentId, 10);
    const profile = getProfileResponse(userId, studentId);
    if (!profile) {
      return res.status(404).json({ error: '学生画像不存在，请先生成' });
    }
    res.json({ profile });
  } catch (error: any) {
    respondInternalError(res, error, '获取学生画像失败');
  }
});

/** 生成/重新生成学生画像（离线任务，走 background 优先级队列） */
router.post('/:studentId/generate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const studentId = parseInt(req.params.studentId, 10);

    // 校验学生归属
    const student = db.prepare('SELECT id, name FROM students WHERE id = ? AND user_id = ?').get(studentId, userId) as { id: number; name: string } | undefined;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    await buildStudentProfile(userId, studentId, student.name);
    const profile = getProfileResponse(userId, studentId);
    if (!profile) {
      return res.status(500).json({ error: '学生画像保存后读取失败' });
    }
    recordChangeEvent('student_profile', profile.id, ['created'], 1, userId);

    res.json({ profile });
  } catch (error: any) {
    respondInternalError(res, error, '生成学生画像失败');
  }
}));

/** 更新学生画像（教师确认/微调） */
router.patch('/:studentId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const studentId = parseInt(req.params.studentId, 10);

    const allowedFields = [
      'learning_style',
      'weak_points',
      'strong_points',
      'motivation_drivers',
      'pacing_preference',
      'communication_style',
      'attention_span_minutes',
      'homework_compliance',
      'parental_involvement',
      'confidence',
      'confirmed_by_teacher',
      'teacher_notes',
    ] as const;

    const patch: Record<string, any> = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        patch[key] = req.body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: '无有效更新字段' });
    }

    const success = updateStudentProfile(userId, studentId, patch);
    if (!success) {
      return res.status(404).json({ error: '学生画像不存在' });
    }

    const profile = getProfileResponse(userId, studentId);
    if (!profile) {
      return res.status(404).json({ error: '学生画像不存在' });
    }
    recordChangeEvent('student_profile', profile.id, ['updated'], 2, userId);

    res.json({ profile });
  } catch (error: any) {
    respondInternalError(res, error, '更新学生画像失败');
  }
});

/** 批量生成所有学生画像（管理员/教研组长用） */
router.post('/batch-generate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const results = await buildAllStudentProfiles(userId);
    res.json({ results });
  } catch (error: any) {
    respondInternalError(res, error, '批量生成学生画像失败');
  }
}));

/** 获取用户所有学生的画像列表 */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profiles = db
      .prepare(
        `SELECT sp.*, s.name AS student_name
           FROM student_profiles sp
           JOIN students s ON s.id = sp.student_id
          WHERE sp.user_id = ?
          ORDER BY sp.generated_at DESC`
      )
      .all(userId) as Array<{
        id: number;
        student_id: number;
        student_name: string;
        profile_json: string;
        source_summary: string;
        confidence: number;
        generated_at: string;
        confirmed_by_teacher: number;
        teacher_notes: string;
      }>;

    const parsed = profiles.map((p) => ({
      id: p.id,
      studentId: p.student_id,
      studentName: p.student_name,
      profile: JSON.parse(p.profile_json),
      sourceSummary: p.source_summary,
      confidence: p.confidence,
      generatedAt: p.generated_at,
      confirmedByTeacher: Boolean(p.confirmed_by_teacher),
      teacherNotes: p.teacher_notes,
    }));

    res.json({ profiles: parsed });
  } catch (error: any) {
    respondInternalError(res, error, '获取学生画像列表失败');
  }
});

export default router;
