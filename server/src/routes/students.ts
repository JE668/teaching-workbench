import { Router } from 'express';
import { db } from '../config/database.js';
import { linkOrphansByName } from '../services/linkOrphans.js';
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
/**
 * 待回访学生：超过 N 天没有回访记录的（含从未回访过的）。
 * 老师最怕漏掉某个孩子 —— 仪表盘只显示总数，不告诉"谁该联系了"。
 */
router.get('/needs-followup', (req: any, res) => {
  try {
    const userId = req.userId;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days as string, 10) || 7));

    const rows = db
      .prepare(
        `SELECT s.*, MAX(f.created_at) AS last_at
         FROM students s
         LEFT JOIN followups f ON f.student_id = s.id AND f.user_id = s.user_id
         WHERE s.user_id = ?
         GROUP BY s.id
         HAVING last_at IS NULL OR last_at <= datetime('now', 'localtime', ?)
         ORDER BY last_at IS NOT NULL, last_at ASC, s.created_at ASC`
      )
      .all(userId, '-' + days + ' days') as any[];

    const now = Date.now();
    const students = rows.map((r) => {
      const lastAt = r.last_at as string | null;
      // SQLite 存的是本地时间字符串，按本地时间解析
      const lastMs = lastAt ? new Date(lastAt.replace(' ', 'T')).getTime() : null;
      return {
        ...mapStudent(r),
        lastFollowUpAt: lastAt,
        daysSince: lastMs ? Math.floor((now - lastMs) / 86400000) : null,
      };
    });

    res.json({ students, days });
  } catch (error: any) {
    res.status(500).json({ error: '获取待回访学生失败', message: error.message });
  }
});

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

    // 关键：老师可能是"先写回访、后建档案"。
    // 建档时把同名且未关联的历史回访一并归位，
    // 否则这个学生的档案页里看不到自己过往的记录。
    const { linked, skippedNames } = linkOrphansByName(userId, (row as any).name);

    res.json({
      student: mapStudent(row),
      linkedFollowUps: linked,
      skippedAmbiguous: skippedNames,
    });
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

    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as any;

    // 改名后，用新名字再归位一次（老师可能一开始名字打错了）
    let linkedFollowUps = 0;
    if (row.name !== existing.name) {
      linkedFollowUps = linkOrphansByName(userId, row.name).linked;
    }

    res.json({ student: mapStudent(row), linkedFollowUps });
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
