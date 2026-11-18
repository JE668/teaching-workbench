/**
 * BI 师生/学管生 映射表 CRUD + 批量导入
 *
 * teacher_student_map: 老师 × 学生 映射（用于续科率去重）
 * mentor_student_map: 学管 × 学生 映射（用于续生率统计）
 *
 * is_prepaid 语义：默认由系统从定金券推断，可人工覆盖。
 * prepaid_overridden=1 时，对账视图不再用定金券值覆盖人工值。
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { z } from 'zod';
import { biDb, BI_UPLOAD_DIR } from './db.js';
import { AuthenticatedRequest } from '../types/index.js';
import { parseXlsx } from './parserBase.js';

const router = Router();
const mapUpload = multer({ dest: BI_UPLOAD_DIR });

// ============ teacher_student_map ============

const teacherStudentCreate = z.object({
  teacher_no: z.string().min(1),
  teacher_name: z.string().optional(),
  student_id: z.string().min(1),
  student_name: z.string().optional(),
  is_prepaid: z.number().int().min(0).max(1).optional(),
  grade: z.string().optional(),
  note: z.string().optional(),
});

const teacherStudentUpdate = teacherStudentCreate.partial();

router.get('/teacher-students', (req: AuthenticatedRequest, res) => {
  const { teacher_no, student_id, is_prepaid } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (teacher_no) { conditions.push('teacher_no = ?'); params.push(teacher_no); }
  if (student_id) { conditions.push('student_id = ?'); params.push(student_id); }
  if (is_prepaid === '1' || is_prepaid === '0') {
    conditions.push('is_prepaid = ?');
    params.push(parseInt(String(is_prepaid), 10));
  }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = biDb.prepare(
    `SELECT * FROM teacher_student_map ${where} ORDER BY teacher_no, student_id LIMIT 5000`
  ).all(...params);
  res.json({ rows });
});

router.post('/teacher-students', (req: AuthenticatedRequest, res) => {
  const parsed = teacherStudentCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  const result = biDb.prepare(
    `INSERT INTO teacher_student_map
     (teacher_no, teacher_name, student_id, student_name, is_prepaid, grade, note, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(d.teacher_no, d.teacher_name ?? null, d.student_id, d.student_name ?? null, d.is_prepaid ?? 0, d.grade ?? null, d.note ?? null, req.userId ?? null);
  const row = biDb.prepare('SELECT * FROM teacher_student_map WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ row });
});

router.patch('/teacher-students/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });
  const parsed = teacherStudentUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });
  // 人工改 is_prepaid 时，标记 prepaid_overridden
  const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
  const values: unknown[] = fields.map(([, v]) => v);
  const hasPrepaid = fields.some(([k]) => k === 'is_prepaid');
  const extraSet = hasPrepaid ? ', prepaid_overridden = 1' : '';
  values.push(req.userId ?? null);
  values.push(id);
  biDb.prepare(
    `UPDATE teacher_student_map SET ${setClause}${extraSet}, updated_by = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?`
  ).run(...values);
  const row = biDb.prepare('SELECT * FROM teacher_student_map WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json({ row });
});

router.delete('/teacher-students/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });
  const result = biDb.prepare('DELETE FROM teacher_student_map WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
  res.json({ message: '已删除' });
});

// ============ mentor_student_map ============

const mentorStudentCreate = z.object({
  mentor_no: z.string().min(1),
  mentor_name: z.string().optional(),
  student_id: z.string().min(1),
  student_name: z.string().optional(),
  grade: z.string().optional(),
  note: z.string().optional(),
});

const mentorStudentUpdate = mentorStudentCreate.partial();

router.get('/mentor-students', (req: AuthenticatedRequest, res) => {
  const { mentor_no, student_id } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (mentor_no) { conditions.push('mentor_no = ?'); params.push(mentor_no); }
  if (student_id) { conditions.push('student_id = ?'); params.push(student_id); }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = biDb.prepare(
    `SELECT * FROM mentor_student_map ${where} ORDER BY mentor_no, student_id LIMIT 5000`
  ).all(...params);
  res.json({ rows });
});

router.post('/mentor-students', (req: AuthenticatedRequest, res) => {
  const parsed = mentorStudentCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  const result = biDb.prepare(
    `INSERT INTO mentor_student_map
     (mentor_no, mentor_name, student_id, student_name, grade, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(d.mentor_no, d.mentor_name ?? null, d.student_id, d.student_name ?? null, d.grade ?? null, d.note ?? null);
  const row = biDb.prepare('SELECT * FROM mentor_student_map WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ row });
});

router.patch('/mentor-students/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });
  const parsed = mentorStudentUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });
  const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
  const values: unknown[] = fields.map(([, v]) => v);
  values.push(id);
  biDb.prepare(
    `UPDATE mentor_student_map SET ${setClause}, updated_at = datetime('now', '+8 hours') WHERE id = ?`
  ).run(...values);
  const row = biDb.prepare('SELECT * FROM mentor_student_map WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json({ row });
});

router.delete('/mentor-students/:id', (req: AuthenticatedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: '无效 ID' });
  const result = biDb.prepare('DELETE FROM mentor_student_map WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
  res.json({ message: '已删除' });
});

// ============ 批量导入（xlsx） ============

interface ImportError { row: number; message: string; raw: unknown; }

/**
 * POST /maps/import/:kind
 * kind = teacher-student | mentor-student
 *
 * xlsx 表头约定（老师-学生）：
 *   老师工号 / 老师姓名 / 学生ID / 学生姓名 / 年级 / 是否预存 / 备注
 * xlsx 表头约定（学管-学生）：
 *   学管工号 / 学管姓名 / 学生ID / 学生姓名 / 年级 / 备注
 *
 * UPSERT：按业务唯一键（teacher_no+student_id 或 mentor_no+student_id）覆盖。
 */
router.post('/maps/import/:kind', mapUpload.single('file'), async (req: AuthenticatedRequest, res) => {
  const { kind } = req.params;
  if (kind !== 'teacher-student' && kind !== 'mentor-student') {
    return res.status(400).json({ error: `未知的映射类型: ${kind}` });
  }
  if (!req.file) return res.status(400).json({ error: '请选择文件' });

  try {
    const { rows } = await parseXlsx(req.file.path, { sheetName: null, headerRow: 1 });
    const errors: ImportError[] = [];
    let upserted = 0;

    if (kind === 'teacher-student') {
      const stmt = biDb.prepare(
        `INSERT INTO teacher_student_map
         (teacher_no, teacher_name, student_id, student_name, is_prepaid, grade, note, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(teacher_no, student_id) DO UPDATE SET
           teacher_name=excluded.teacher_name,
           student_name=excluded.student_name,
           grade=excluded.grade,
           note=excluded.note,
           updated_by=excluded.updated_by,
           updated_at=datetime('now', '+8 hours')`
      );
      const tx = biDb.transaction(() => {
        rows.forEach((r, i) => {
          const rowNo = i + 2; // 含表头
          const teacherNo = r['老师工号'];
          const studentId = r['学生ID'];
          if (!teacherNo || !studentId) {
            errors.push({ row: rowNo, message: '老师工号 / 学生ID 必填', raw: r });
            return;
          }
          const prepaid = r['是否预存'];
          const prepaidInt = (prepaid === 1 || prepaid === '1' || prepaid === '是') ? 1 : 0;
          stmt.run(
            String(teacherNo),
            r['老师姓名'] ? String(r['老师姓名']) : null,
            String(studentId),
            r['学生姓名'] ? String(r['学生姓名']) : null,
            prepaidInt,
            r['年级'] ? String(r['年级']) : null,
            r['备注'] ? String(r['备注']) : null,
            req.userId ?? null,
          );
          upserted += 1;
        });
      });
      tx();
    } else {
      // mentor-student
      const stmt = biDb.prepare(
        `INSERT INTO mentor_student_map
         (mentor_no, mentor_name, student_id, student_name, grade, note)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(mentor_no, student_id) DO UPDATE SET
           mentor_name=excluded.mentor_name,
           student_name=excluded.student_name,
           grade=excluded.grade,
           note=excluded.note,
           updated_at=datetime('now', '+8 hours')`
      );
      const tx = biDb.transaction(() => {
        rows.forEach((r, i) => {
          const rowNo = i + 2;
          const mentorNo = r['学管工号'];
          const studentId = r['学生ID'];
          if (!mentorNo || !studentId) {
            errors.push({ row: rowNo, message: '学管工号 / 学生ID 必填', raw: r });
            return;
          }
          stmt.run(
            String(mentorNo),
            r['学管姓名'] ? String(r['学管姓名']) : null,
            String(studentId),
            r['学生姓名'] ? String(r['学生姓名']) : null,
            r['年级'] ? String(r['年级']) : null,
            r['备注'] ? String(r['备注']) : null,
          );
          upserted += 1;
        });
      });
      tx();
    }

    res.json({
      upserted,
      total_rows: rows.length,
      errors: errors.slice(0, 100),
      errors_total: errors.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `解析失败: ${msg}` });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => { /* ignore */ });
  }
});

export default router;
