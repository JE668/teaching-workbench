import { Router } from 'express';
import { db } from '../config/database.js';
import { FollowUp, FollowUpCreate } from '../types/index.js';
import { generateFollowUpContent } from '../services/ai.js';

const router = Router();

// 获取回访列表
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

    const followups = db.prepare(query).all(...params) as FollowUp[];
    res.json({ followups });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访列表失败', message: error.message });
  }
});

// 获取单个回访
router.get('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const followupId = parseInt(req.params.id);
    const followup = db.prepare('SELECT * FROM followups WHERE id = ? AND user_id = ?').get(followupId, userId) as FollowUp;
    if (!followup) {
      return res.status(404).json({ error: '回访记录不存在' });
    }
    res.json({ followup });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访信息失败', message: error.message });
  }
});

// AI 生成课后回访内容
router.post('/generate', async (req: any, res) => {
  try {
    const { studentName, grade, subject, topic, performance, mastery, images } = req.body;

    if (!studentName || !grade || !subject || !topic || !performance || !mastery) {
      return res.status(400).json({ error: '所有字段为必填项' });
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

    // 计算字数（去除标点和空格）
    const wordCount = content.replace(/[\s\p{P}\p{S}]/gu, '').length;

    if (wordCount < 150 || wordCount > 500) {
      console.warn(`[AI] 生成内容字数 ${wordCount}，不在 150-500 范围内`);
    }

    res.json({ content, wordCount });
  } catch (error: any) {
    console.error('[AI生成]', error);
    res.status(500).json({ error: 'AI生成失败', message: error.message });
  }
});

// 保存回访记录
router.post('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { studentId, studentName, grade, subject, topic, performance, mastery, images, content } = req.body as FollowUpCreate;

    if (!studentName || !grade || !subject || !topic || !performance || !mastery || !content) {
      return res.status(400).json({ error: '所有字段为必填项' });
    }

    const wordCount = content.replace(/[\s\p{P}\p{S}]/gu, '').length;
    const imagesJson = JSON.stringify(images || []);

    const result = db.prepare(
      `INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, images, content, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, studentId, studentName, grade, subject, topic, performance, mastery, imagesJson, content, wordCount);

    const followup = db.prepare('SELECT * FROM followups WHERE id = ?').get(result.lastInsertRowid) as FollowUp;
    res.json({ followup });
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

    const existing = db.prepare('SELECT * FROM followups WHERE id = ? AND user_id = ?').get(followupId, userId);
    if (!existing) {
      return res.status(404).json({ error: '回访记录不存在' });
    }

    const wordCount = content.replace(/[\s\p{P}\p{S}]/gu, '').length;
    const imagesJson = JSON.stringify(images || []);

    db.prepare(
      `UPDATE followups SET student_id=?, student_name=?, grade=?, subject=?, topic=?, performance=?, mastery=?, images=?, content=?, word_count=?, updated_at=datetime("now","localtime") WHERE id=?`
    ).run(
      studentId, studentName, grade, subject, topic, performance, mastery, imagesJson, content, wordCount, followupId
    );

    const followup = db.prepare('SELECT * FROM followups WHERE id = ?').get(followupId) as FollowUp;
    res.json({ followup });
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
