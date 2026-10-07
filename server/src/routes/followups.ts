import { Router } from 'express';
import { db } from '../config/database.js';
import { FollowUpCreate } from '../types/index.js';
import { mapFollowUp, mapFollowUps, parseImages } from '../utils/mappers.js';
import { generateFollowUpContent } from '../services/ai.js';

const router = Router();

// 纯文字计数：去除空白与标点
function countWords(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

// 获取回访列表（支持按学生/学科/年级过滤）
router.get('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { studentId, subject, grade } = req.query;

    let query = 'SELECT * FROM followups WHERE user_id = ?';
    const params: any[] = [userId];

    if (studentId) {
      query += ' AND student_id = ?';
      params.push(parseInt(studentId as string));
    }
    if (subject) {
      query += ' AND subject = ?';
      params.push(subject);
    }
    if (grade) {
      query += ' AND grade = ?';
      params.push(grade);
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.prepare(query).all(...params) as any[];
    res.json({ followups: mapFollowUps(rows) });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访列表失败', message: error.message });
  }
});

// 获取单条回访
router.get('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const followupId = parseInt(req.params.id);
    const row = db.prepare('SELECT * FROM followups WHERE id = ? AND user_id = ?').get(followupId, userId) as any;
    if (!row) {
      return res.status(404).json({ error: '回访记录不存在' });
    }
    res.json({ followup: mapFollowUp(row) });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访信息失败', message: error.message });
  }
});

// AI 生成课后回访内容（不落库，由前端确认后再保存）
router.post('/generate', async (req: any, res) => {
  try {
    const { studentName, grade, subject, topic, performance, mastery, images } = req.body;

    if (!studentName || !grade || !subject || !topic || !performance || !mastery) {
      return res.status(400).json({ error: '学生姓名、年级、学科、课程主题、课堂表现、掌握程度均为必填项' });
    }

    const content = await generateFollowUpContent({
      studentName,
      grade,
      subject,
      topic,
      performance,
      mastery,
      images: images || [],
    });

    const wordCount = countWords(content);

    res.json({ content, wordCount });
  } catch (error: any) {
    console.error('[AI生成]', error);
    res.status(500).json({ error: 'AI生成失败', message: error.message });
  }
});

// 保存回访记录（图片 + AI内容一并归档到学生档案）
router.post('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { studentId, studentName, grade, subject, topic, performance, mastery, images, content } = req.body as FollowUpCreate;

    if (!studentName || !grade || !subject || !topic || !performance || !mastery || !content) {
      return res.status(400).json({ error: '所有字段为必填项' });
    }

    // 若关联了学生，校验归属，避免越权写入他人档案
    let linkedStudentId: number | null = null;
    if (studentId) {
      const owned = db.prepare('SELECT id FROM students WHERE id = ? AND user_id = ?').get(studentId, userId);
      if (!owned) {
        return res.status(400).json({ error: '关联的学生不存在或无权访问' });
      }
      linkedStudentId = studentId;
    }

    const wordCount = countWords(content);
    const imagesJson = JSON.stringify(images || []);

    const result = db.prepare(
      `INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, images, content, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, linkedStudentId, studentName, grade, subject, topic, performance, mastery, imagesJson, content, wordCount);

    const row = db.prepare('SELECT * FROM followups WHERE id = ?').get(result.lastInsertRowid);
    res.json({ followup: mapFollowUp(row) });
  } catch (error: any) {
    res.status(500).json({ error: '保存回访失败', message: error.message });
  }
});

// 更新回访
router.put('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const followupId = parseInt(req.params.id);
    const { studentId, studentName, grade, subject, topic, performance, mastery, images, content } = req.body;

    const existing = db.prepare('SELECT * FROM followups WHERE id = ? AND user_id = ?').get(followupId, userId) as any;
    if (!existing) {
      return res.status(404).json({ error: '回访记录不存在' });
    }

    const wordCount = countWords(content ?? existing.content);
    const imagesJson = JSON.stringify(images ?? parseImages(existing.images));

    db.prepare(
      `UPDATE followups SET student_id=?, student_name=?, grade=?, subject=?, topic=?, performance=?, mastery=?, images=?, content=?, word_count=?, updated_at=datetime("now","localtime") WHERE id=?`
    ).run(
      studentId ?? existing.student_id,
      studentName ?? existing.student_name,
      grade ?? existing.grade,
      subject ?? existing.subject,
      topic ?? existing.topic,
      performance ?? existing.performance,
      mastery ?? existing.mastery,
      imagesJson,
      content ?? existing.content,
      wordCount,
      followupId
    );

    const row = db.prepare('SELECT * FROM followups WHERE id = ?').get(followupId);
    res.json({ followup: mapFollowUp(row) });
  } catch (error: any) {
    res.status(500).json({ error: '更新回访失败', message: error.message });
  }
});

// 删除回访
router.delete('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const followupId = parseInt(req.params.id);

    const result = db.prepare('DELETE FROM followups WHERE id = ? AND user_id = ?').run(followupId, userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: '回访记录不存在' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除回访失败', message: error.message });
  }
});

export default router;
