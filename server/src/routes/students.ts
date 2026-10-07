import { Router } from 'express';
import { db } from '../config/database.js';
import { Student, StudentCreate, StudentUpdate } from '../types/index.js';

const router = Router();

// 获取学生列表
router.get('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const students = db.prepare('SELECT * FROM students WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Student[];
    res.json({ students });
  } catch (error: any) {
    res.status(500).json({ error: '获取学生列表失败', message: error.message });
  }
});

// 获取单个学生
router.get('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = parseInt(req.params.id);
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, userId) as Student;
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }
    res.json({ student });
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

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid) as Student;
    res.json({ student });
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

    // 检查学生是否存在
    const existing = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
    if (!existing) {
      return res.status(404).json({ error: '学生不存在' });
    }

    db.prepare(
      'UPDATE students SET name = ?, grade = ?, subject = ?, phone = ?, notes = ?, updated_at = datetime("now", "localtime") WHERE id = ?'
    ).run(name || existing.name, grade || existing.grade, subject || existing.subject, phone !== undefined ? phone : existing.phone, notes !== undefined ? notes : existing.notes, studentId);

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as Student;
    res.json({ student });
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

// 搜索学生
router.get('/search', (req: any, res) => {
  try {
    const userId = req.userId;
    const keyword = req.query.keyword as string;

    if (!keyword) {
      return res.json({ students: [] });
    }

    const students = db.prepare(
      'SELECT * FROM students WHERE user_id = ? AND (name LIKE ? OR subject LIKE ? OR grade LIKE ?) ORDER BY created_at DESC'
    ).all(userId, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`) as Student[];

    res.json({ students });
  } catch (error: any) {
    res.status(500).json({ error: '搜索学生失败', message: error.message });
  }
});

export default router;
