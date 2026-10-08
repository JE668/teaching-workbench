import { Router } from 'express';
import { db } from '../config/database.js';
import { StudentCreate, StudentUpdate } from '../types/index.js';
import { mapStudent, mapStudents, mapFollowUps } from '../utils/mappers.js';
import { toMarkdown, toCsv, exportFilename } from '../services/export.js';

const router = Router();

// 获取学生列表
router.get('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const rows = db.prepare('SELECT * FROM students WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    res.json({ students: mapStudents(rows as any[]) });
  } catch (error: any) {
    res.status(500).json({ error: '获取学生列表失败', message: error.message });
  }
});

// 搜索学生（必须放在 /:id 之前，避免被参数路由捕获）
router.get('/search', (req: any, res) => {
  try {
    const userId = req.userId;
    const keyword = (req.query.keyword as string) || '';

    if (!keyword) {
      return res.json({ students: [] });
    }

    const rows = db.prepare(
      'SELECT * FROM students WHERE user_id = ? AND (name LIKE ? OR subject LIKE ? OR grade LIKE ?) ORDER BY created_at DESC'
    ).all(userId, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);

    res.json({ students: mapStudents(rows as any[]) });
  } catch (error: any) {
    res.status(500).json({ error: '搜索学生失败', message: error.message });
  }
});

// 获取学生档案（学生信息 + 全部回访记录 + 统计）
router.get('/:id/profile', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = parseInt(req.params.id);

    const studentRow = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
    if (!studentRow) {
      return res.status(404).json({ error: '学生不存在' });
    }

    const followupRows = db.prepare(
      'SELECT * FROM followups WHERE user_id = ? AND student_id = ? ORDER BY created_at DESC'
    ).all(userId, studentId) as any[];

    const followups = mapFollowUps(followupRows);

    const stats = {
      totalFollowups: followups.length,
      totalWords: followups.reduce((sum, f) => sum + (f.wordCount || 0), 0),
      totalImages: followups.reduce((sum, f) => sum + f.images.length, 0),
      subjects: [...new Set(followups.map((f) => f.subject))],
      grades: [...new Set(followups.map((f) => f.grade))],
      lastFollowUpAt: followups[0]?.createdAt ?? null,
    };

    res.json({ student: mapStudent(studentRow), followups, stats });
  } catch (error: any) {
    res.status(500).json({ error: '获取学生档案失败', message: error.message });
  }
});

/**
 * 导出学生档案
 * GET /api/students/:id/export?format=md|csv&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/:id/export', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = parseInt(req.params.id);
    const { format = 'md', from, to } = req.query;

    if (format !== 'md' && format !== 'csv') {
      return res.status(400).json({ error: 'format 仅支持 md 或 csv' });
    }

    const studentRow = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
    if (!studentRow) {
      return res.status(404).json({ error: '学生不存在' });
    }

    let where = 'WHERE user_id = ? AND student_id = ?';
    const params: any[] = [userId, studentId];

    if (from) {
      where += ' AND date(created_at) >= date(?)';
      params.push(from);
    }
    if (to) {
      where += ' AND date(created_at) <= date(?)';
      params.push(to);
    }

    const rows = db
      .prepare('SELECT * FROM followups ' + where + ' ORDER BY created_at ASC, id ASC')
      .all(...params) as any[];

    const student = mapStudent(studentRow);
    const followups = mapFollowUps(rows);

    const body = format === 'csv' ? toCsv(student, followups) : toMarkdown(student, followups, { format: 'md' });
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="' + exportFilename(student, format) + '"');
    res.send(body);
  } catch (error: any) {
    res.status(500).json({ error: '导出失败', message: error.message });
  }
});

// 获取单个学生
router.get('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = parseInt(req.params.id);
    const row = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
    if (!row) {
      return res.status(404).json({ error: '学生不存在' });
    }
    res.json({ student: mapStudent(row) });
  } catch (error: any) {
    res.status(500).json({ error: '获取学生信息失败', message: error.message });
  }
});

// 创建学生
router.post('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { name, grade, subject, phone, notes } = req.body as StudentCreate;

    if (!name || !grade || !subject) {
      return res.status(400).json({ error: '姓名、年级、学科为必填项' });
    }

    const result = db.prepare(
      'INSERT INTO students (user_id, name, grade, subject, phone, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, name, grade, subject, phone || null, notes || null);

    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);
    res.json({ student: mapStudent(row) });
  } catch (error: any) {
    res.status(500).json({ error: '创建学生失败', message: error.message });
  }
});

// 更新学生
router.put('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = parseInt(req.params.id);
    const { name, grade, subject, phone, notes } = req.body as StudentUpdate;

    const existing = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, userId) as any;
    if (!existing) {
      return res.status(404).json({ error: '学生不存在' });
    }

    db.prepare(
      "UPDATE students SET name = ?, grade = ?, subject = ?, phone = ?, notes = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(
      name || existing.name,
      grade || existing.grade,
      subject || existing.subject,
      phone !== undefined ? phone : existing.phone,
      notes !== undefined ? notes : existing.notes,
      studentId
    );

    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    res.json({ student: mapStudent(row) });
  } catch (error: any) {
    res.status(500).json({ error: '更新学生失败', message: error.message });
  }
});

// 删除学生
router.delete('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = parseInt(req.params.id);

    const result = db.prepare('DELETE FROM students WHERE id = ? AND user_id = ?').run(studentId, userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: '学生不存在' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除学生失败', message: error.message });
  }
});

export default router;
