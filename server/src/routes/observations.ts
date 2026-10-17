import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { validateBody } from '../utils/validation.js';
import { observationCreateSchema, observationUpdateSchema } from '../utils/schemas.js';
import {
  mapObservation,
  mapObservations,
  normalizeLessonType,
  normalizeOverallGrade,
  LESSON_TYPE_LABELS,
} from '../utils/mappers.js';
import { runObservationGeneration, parseSuggestedGrade, describeAiError } from '../services/observation.js';
import { log } from '../utils/logger.js';

const router = Router();

const STATUS_VALUES = new Set(['draft', 'sent', 'archived']);

function fetchWithTeacher(userId: number, id: number): any | undefined {
  return db
    .prepare(
      `SELECT o.*, t.name AS teacher_name
         FROM observations o
         LEFT JOIN teachers t ON t.id = o.teacher_id
         WHERE o.id = ? AND o.user_id = ?`
    )
    .get(id, userId);
}

/** 校验 teacherId 归属当前用户（不传/传 null 视为"未关联老师"） */
function ownedTeacherId(userId: number, raw: any): number | null {
  if (raw == null) return null;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  const row = db.prepare('SELECT id FROM teachers WHERE id = ? AND user_id = ?').get(id, userId);
  return row ? id : null;
}

function readFields(body: any, userId: number): Record<string, any> {
  const str = (v: any, max?: number) => {
    const s = v != null ? String(v).trim() : '';
    return s ? (max && s.length > max ? s.slice(0, max) : s) : s;
  };
  return {
    teacherId: ownedTeacherId(userId, body?.teacherId),
    topic: str(body?.topic, 60) || '',
    lessonType: normalizeLessonType(body?.lessonType),
    observedAt: body?.observedAt ? str(body.observedAt, 32) : null,
    grade: str(body?.grade, 30) || null,
    subject: str(body?.subject, 30) || null,
    level: str(body?.level, 30) || null,
    studentName: str(body?.studentName, 30) || null,
    classNotes: body?.classNotes != null ? String(body.classNotes) : '',
    overallGrade: normalizeOverallGrade(body?.overallGrade),
    status: STATUS_VALUES.has(body?.status) ? String(body.status) : 'draft',
    teacherReply: body?.teacherReply != null ? String(body.teacherReply) : '',
  };
}

/** 列出（支持按 老师/课型/科目/状态/时间 过滤） */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const clauses: string[] = ['o.user_id = ?'];
    const params: any[] = [userId];

    const qTeacher = req.query.teacherId != null ? parseInt(String(req.query.teacherId), 10) : NaN;
    if (Number.isFinite(qTeacher)) {
      clauses.push('o.teacher_id = ?');
      params.push(qTeacher);
    }
    if (typeof req.query.lessonType === 'string' && req.query.lessonType) {
      clauses.push('o.lesson_type = ?');
      params.push(normalizeLessonType(req.query.lessonType));
    }
    if (typeof req.query.status === 'string' && STATUS_VALUES.has(req.query.status)) {
      clauses.push('o.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.subject === 'string' && req.query.subject) {
      clauses.push('o.subject = ?');
      params.push(req.query.subject);
    }
    if (typeof req.query.from === 'string' && req.query.from) {
      clauses.push('date(o.observed_at) >= date(?)');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to) {
      clauses.push('date(o.observed_at) <= date(?)');
      params.push(req.query.to);
    }

    const rows = db
      .prepare(
        `SELECT o.*, t.name AS teacher_name
           FROM observations o
           LEFT JOIN teachers t ON t.id = o.teacher_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY o.observed_at IS NULL, date(o.observed_at) DESC, o.id DESC`
      )
      .all(...params) as any[];

    res.json({ observations: mapObservations(rows) });
  } catch (error: any) {
    res.status(500).json({ error: '获取听评课列表失败', message: error.message });
  }
});

/** 新建一条听评课记录 */
router.post('/', validateBody(observationCreateSchema), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const f = readFields(req.body, userId);
    if (!f.topic) return res.status(400).json({ error: '请填写课题' });

    const result = db
      .prepare(
        `INSERT INTO observations
         (user_id, teacher_id, topic, lesson_type, observed_at, grade, subject, level,
          student_name, class_notes, overall_grade, status, teacher_reply)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        f.teacherId,
        f.topic,
        f.lessonType,
        f.observedAt,
        f.grade,
        f.subject,
        f.level,
        f.studentName,
        f.classNotes,
        f.overallGrade,
        f.status,
        f.teacherReply
      );

    const row = fetchWithTeacher(userId, result.lastInsertRowid as number);
    res.json({ observation: mapObservation(row, row?.teacher_name ?? null) });
  } catch (error: any) {
    res.status(500).json({ error: '创建听评课记录失败', message: error.message });
  }
});

/** 单条详情 */
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id, 10);
    const row = fetchWithTeacher(userId, id);
    if (!row) return res.status(404).json({ error: '听评课记录不存在' });
    res.json({ observation: mapObservation(row, row.teacher_name ?? null) });
  } catch (error: any) {
    res.status(500).json({ error: '获取听评课记录失败', message: error.message });
  }
});

/** 更新（编辑字段 / 状态 / 老师回应 / 总体等级） */
router.put('/:id', validateBody(observationUpdateSchema), (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM observations WHERE id = ? AND user_id = ?').get(id, userId) as any;
    if (!existing) return res.status(404).json({ error: '听评课记录不存在' });

    const f = readFields(req.body, userId);
    const next = {
      teacher_id: f.teacherId ?? existing.teacher_id,
      topic: f.topic || existing.topic,
      lesson_type: req.body?.lessonType != null ? f.lessonType : existing.lesson_type,
      observed_at: req.body?.observedAt !== undefined ? f.observedAt : existing.observed_at,
      grade: req.body?.grade !== undefined ? f.grade : existing.grade,
      subject: req.body?.subject !== undefined ? f.subject : existing.subject,
      level: req.body?.level !== undefined ? f.level : existing.level,
      student_name: req.body?.studentName !== undefined ? f.studentName : existing.student_name,
      class_notes: req.body?.classNotes !== undefined ? f.classNotes : existing.class_notes,
      overall_grade: req.body?.overallGrade !== undefined ? f.overallGrade : existing.overall_grade,
      status: req.body?.status !== undefined ? f.status : existing.status,
      teacher_reply: req.body?.teacherReply !== undefined ? f.teacherReply : existing.teacher_reply,
    };

    db.prepare(
      `UPDATE observations SET
        teacher_id = ?, topic = ?, lesson_type = ?, observed_at = ?,
        grade = ?, subject = ?, level = ?, student_name = ?,
        class_notes = ?, overall_grade = ?, status = ?, teacher_reply = ?,
        updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`
    ).run(
      next.teacher_id, next.topic, next.lesson_type, next.observed_at,
      next.grade, next.subject, next.level, next.student_name,
      next.class_notes, next.overall_grade, next.status, next.teacher_reply,
      id, userId
    );

    const row = fetchWithTeacher(userId, id);
    res.json({ observation: mapObservation(row, row?.teacher_name ?? null) });
  } catch (error: any) {
    res.status(500).json({ error: '更新听评课记录失败', message: error.message });
  }
});

/** 删除 */
router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const result = db.prepare('DELETE FROM observations WHERE id = ? AND user_id = ?').run(
      parseInt(req.params.id, 10),
      userId
    );
    if (result.changes === 0) return res.status(404).json({ error: '听评课记录不存在' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除听评课记录失败', message: error.message });
  }
});

/** 生成（并落库）评课报告 */
router.post('/:id/report', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id, 10);
    const row = fetchWithTeacher(userId, id);
    if (!row) return res.status(404).json({ error: '听评课记录不存在' });

    const report = await runObservationGeneration({
      teacherName: row.teacher_name || (row.teacher_id ? '老师' : '被听课老师'),
      topic: row.topic,
      lessonTypeLabel: LESSON_TYPE_LABELS[normalizeLessonType(row.lesson_type)] || '其他',
      observedAt: row.observed_at,
      grade: row.grade,
      subject: row.subject,
      level: row.level,
      studentName: row.student_name,
      classNotes: row.class_notes,
    });

    // 用户已手选等级则保留，否则用 AI 建议预填（COALESCE 优先取库里已有值）
    const suggested = parseSuggestedGrade(report);
    const gradeToStore = row.overall_grade ?? suggested;

    db.prepare(
      `UPDATE observations SET report = ?, report_at = datetime('now','localtime'),
        overall_grade = COALESCE(overall_grade, ?),
        updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`
    ).run(report, suggested, id, userId);

    res.json({ report, suggestedGrade: suggested, overallGrade: gradeToStore });
  } catch (error: any) {
    const { httpStatus, message } = describeAiError(error);
    log.error({ httpStatus, error: message }, '评课生成失败');
    res.status(httpStatus).json({ error: message });
  }
});

export default router;
