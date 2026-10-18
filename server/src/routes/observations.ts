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
import {
  runObservationGeneration,
  runObservationStream,
  parseSuggestedGrade,
  describeAiError,
} from '../services/observation.js';
import { parseObservationReport, buildObservationDocx, buildDocxFilename } from '../utils/observationDocx.js';
import { readPreferences } from './auth.js';
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

/** 本地日期 → 'YYYY-MM-DD'（与库里 datetime('now','+8 hours') 存的一致） */
function toDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 覆盖率时间窗天数：默认 90 天，上限 10 年，非法值回退默认 */
function clampCoverageDays(raw: unknown): number {
  const n = parseInt(String(raw ?? '90'), 10);
  if (!Number.isFinite(n) || n <= 0) return 90;
  return Math.min(3650, n);
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

/** 按被听课老师做统计（听课次数 / 等级分布 / 最近听课）；支持 老师 / 时间窗 过滤；须在 /:id 之前注册 */
router.get('/teacher-stats', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // 听课记录维度的过滤（时间窗）必须写在 JOIN 的 ON 上：
    // 写在 WHERE 会连带把没有任何记录的老师一起过滤掉。
    const joinClauses: string[] = ['o.teacher_id = t.id', 'o.user_id = ?'];
    const joinParams: any[] = [userId];
    if (typeof req.query.from === 'string' && req.query.from) {
      joinClauses.push('date(o.observed_at) >= date(?)');
      joinParams.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to) {
      joinClauses.push('date(o.observed_at) <= date(?)');
      joinParams.push(req.query.to);
    }
    const hasTimeFilter = joinClauses.length > 2;

    // 老师维度的过滤（只看某一位老师）
    let whereClause = 't.user_id = ?';
    const whereParams: any[] = [userId];
    const qTeacher = req.query.teacherId != null ? parseInt(String(req.query.teacherId), 10) : NaN;
    if (Number.isFinite(qTeacher)) {
      whereClause += ' AND t.id = ?';
      whereParams.push(qTeacher);
    }

    // 有时间窗时只保留确实听过课的老师，避免满屏零行
    const having = hasTimeFilter ? 'HAVING COUNT(o.id) > 0' : '';

    const rows = db
      .prepare(
        `SELECT t.id AS teacher_id, t.name AS teacher_name, t.subject AS subject,
          COUNT(o.id) AS obs_count,
          MAX(o.observed_at) AS last_observed,
          COALESCE(SUM(CASE WHEN o.overall_grade = 'excellent' THEN 1 ELSE 0 END),0) AS g_excellent,
          COALESCE(SUM(CASE WHEN o.overall_grade = 'good' THEN 1 ELSE 0 END),0) AS g_good,
          COALESCE(SUM(CASE WHEN o.overall_grade = 'pass' THEN 1 ELSE 0 END),0) AS g_pass,
          COALESCE(SUM(CASE WHEN o.overall_grade = 'needs_work' THEN 1 ELSE 0 END),0) AS g_needs,
          COALESCE(SUM(CASE WHEN o.overall_grade IS NULL THEN 1 ELSE 0 END),0) AS g_ungraded
         FROM teachers t
         LEFT JOIN observations o ON ${joinClauses.join(' AND ')}
         WHERE ${whereClause}
         GROUP BY t.id
         ${having}
         ORDER BY last_observed IS NULL, last_observed DESC, obs_count DESC`
      )
      .all(...joinParams, ...whereParams) as any[];

    const teachers = rows.map((r) => ({
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      subject: r.subject ?? null,
      obsCount: Number(r.obs_count || 0),
      lastObservedAt: r.last_observed || null,
      grades: {
        excellent: Number(r.g_excellent || 0),
        good: Number(r.g_good || 0),
        pass: Number(r.g_pass || 0),
        needs_work: Number(r.g_needs || 0),
        ungraded: Number(r.g_ungraded || 0),
      },
    }));
    res.json({ teachers });
  } catch (error: any) {
    res.status(500).json({ error: '获取老师统计失败', message: error.message });
  }
});

/** 回复闭环待办汇总（列表页角标 / 看板概览用）；须在 /:id 之前注册 */
router.get('/reply-metrics', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'draft' AND (teacher_reply IS NULL OR teacher_reply = '') THEN 1 ELSE 0 END),0) AS pending,
           COALESCE(SUM(CASE WHEN status <> 'draft' AND (teacher_reply IS NULL OR teacher_reply = '') THEN 1 ELSE 0 END),0) AS awaiting,
           COALESCE(SUM(CASE WHEN teacher_reply IS NOT NULL AND teacher_reply <> '' THEN 1 ELSE 0 END),0) AS replied,
           COUNT(*) AS total
          FROM observations
         WHERE user_id = ?`
      )
      .get(userId) as any;

    res.json({
      pending: Number(row?.pending || 0),
      awaiting: Number(row?.awaiting || 0),
      replied: Number(row?.replied || 0),
      total: Number(row?.total || 0),
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取回复闭环统计失败', message: error.message });
  }
});

/**
 * 听课覆盖率：时间窗内有多少老师至少被听过 1 节课。
 *
 * 与 /teacher-stats 的区别：老师统计在有时间窗时会用 HAVING 剔除零行，
 * 而覆盖率恰恰要**看见**那些窗口内一次都没被听过的老师 —— 这才是管理者关心的信号。
 * 须在 /:id 之前注册，否则会被当成 id 吃掉。
 */
router.get('/coverage', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const days = clampCoverageDays(req.query.days);

    const to = toDateStr(new Date());
    const from = toDateStr(new Date(Date.now() - (days - 1) * 86_400_000));

    const rows = db
      .prepare(
        `SELECT t.id AS teacher_id, t.name AS teacher_name, t.subject AS subject,
          COUNT(CASE WHEN date(o.observed_at) >= date(?) AND date(o.observed_at) <= date(?) THEN 1 END) AS window_count,
          MAX(o.observed_at) AS last_observed
         FROM teachers t
         LEFT JOIN observations o ON o.teacher_id = t.id AND o.user_id = ?
         WHERE t.user_id = ?
         GROUP BY t.id`
      )
      .all(from, to, userId, userId) as any[];

    const today = Date.now();
    const all = rows.map((r) => {
      const windowCount = Number(r.window_count || 0);
      const last = r.last_observed || null;
      return {
        teacherId: r.teacher_id,
        teacherName: r.teacher_name,
        subject: r.subject ?? null,
        windowCount,
        lastObservedAt: last,
        daysSince: last ? Math.max(0, Math.round((today - new Date(last).getTime()) / 86_400_000)) : null,
      };
    });

    // 听过课的按次数降序；没听过的把「最该被听的」排最前：
    // 从未听过课的最前，其次按「距离上次听课」从久到近
    const observed = all.filter((t) => t.windowCount > 0).sort((a, b) => b.windowCount - a.windowCount);
    const unobserved = all
      .filter((t) => t.windowCount === 0)
      .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));

    res.json({
      window: { days, from, to },
      totalTeachers: all.length,
      observedCount: observed.length,
      unobservedCount: unobserved.length,
      coverage: all.length > 0 ? observed.length / all.length : 0,
      observed,
      unobserved,
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取听课覆盖率失败', message: error.message });
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
        updated_at = datetime('now','+8 hours')
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

    // 生成前用户已选定的等级优先；其次保留库里已有值；都没有才用 AI 建议预填。
    const chosenGrade = normalizeOverallGrade(req.body?.overallGrade);
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
      overallGrade: chosenGrade ?? row.overall_grade ?? null,
    });

    const suggested = parseSuggestedGrade(report);
    const gradeToStore = chosenGrade ?? row.overall_grade ?? suggested;

    db.prepare(
      `UPDATE observations SET report = ?, report_at = datetime('now','+8 hours'),
        overall_grade = COALESCE(overall_grade, ?),
        updated_at = datetime('now','+8 hours')
       WHERE id = ? AND user_id = ?`
    ).run(report, suggested, id, userId);

    res.json({ report, suggestedGrade: suggested, overallGrade: gradeToStore });
  } catch (error: any) {
    const { httpStatus, message } = describeAiError(error);
    log.error({ httpStatus, error: message }, '评课生成失败');
    res.status(httpStatus).json({ error: message });
  }
});

/** SSE 流式生成评课报告（边生成边下发；结束时落库） */
router.post('/:id/report/stream', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id, 10);
  const row = fetchWithTeacher(userId, id);
  if (!row) return res.status(404).json({ error: '听评课记录不存在' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) clientGone = true;
  });
  const send = (event: string, data: any) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    } catch {
      clientGone = true;
    }
  };

  try {
    // 生成前用户已选定的等级优先（AI 据此调整整份评课的内容口径）。
    const chosenGrade = normalizeOverallGrade(req.body?.overallGrade);
    const params = {
      teacherName: row.teacher_name || (row.teacher_id ? '老师' : '被听课老师'),
      topic: row.topic,
      lessonTypeLabel: LESSON_TYPE_LABELS[normalizeLessonType(row.lesson_type)] || '其他',
      observedAt: row.observed_at,
      grade: row.grade,
      subject: row.subject,
      level: row.level,
      studentName: row.student_name,
      classNotes: row.class_notes,
      overallGrade: chosenGrade ?? row.overall_grade ?? null,
    };

    let full = '';
    for await (const delta of runObservationStream(params)) {
      if (clientGone) break;
      full += delta;
      send('delta', { text: delta });
    }

    const report = full.trim();
    const suggested = parseSuggestedGrade(report);
    const gradeToStore = chosenGrade ?? row.overall_grade ?? suggested;
    db.prepare(
      `UPDATE observations SET report = ?, report_at = datetime('now','+8 hours'),
        overall_grade = COALESCE(overall_grade, ?),
        updated_at = datetime('now','+8 hours')
       WHERE id = ? AND user_id = ?`
    ).run(report, suggested, id, userId);

    send('done', { report, suggestedGrade: suggested, overallGrade: gradeToStore });
  } catch (error: any) {
    const { message } = describeAiError(error);
    log.error({ error: message }, '评课流式生成失败');
    send('error', { error: message });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

/** 导出已填写的 Word（.docx）：套用用户模板，把报告填进对应格子，供直接报送 */
router.get('/:id/docx', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id, 10);
    const row = fetchWithTeacher(userId, id);
    if (!row) return res.status(404).json({ error: '听评课记录不存在' });
    if (!row.report) return res.status(400).json({ error: '尚未生成评课报告，无法导出 Word' });

    // 评课人签名：优先用「设置」里填的签名，没填则回落登录用户名
    const pref = readPreferences(userId);
    const me = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
    const signature = (pref.signature || (me?.username ? String(me.username) : '')).trim();

    const parsed = parseObservationReport(row.report);
    // 等级：优先用户手选，其次 AI 建议 —— 只传代码，模板按代码勾选对应括号
    const gradeCode = row.overall_grade || parseSuggestedGrade(row.report) || '';

    const buf = await buildObservationDocx({
      teacher: row.teacher_name || '',
      time: row.observed_at || '',
      topic: row.topic,
      type: LESSON_TYPE_LABELS[normalizeLessonType(row.lesson_type)] || '其他',
      evals: parsed.items,
      highlight: parsed.highlight,
      optimize: parsed.optimize,
      suggest: parsed.suggest,
      grade: gradeCode,
      signature,
    });

    const fname = encodeURIComponent(buildDocxFilename(row.observed_at || '', signature));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
    res.send(buf);
  } catch (error: any) {
    log.error({ error: error.message }, '导出听评课 Word 失败');
    res.status(500).json({ error: '导出 Word 失败', message: error.message });
  }
});

export default router;