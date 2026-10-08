import { Router } from 'express';
import { db } from '../config/database.js';
import { FollowUpCreate } from '../types/index.js';
import { mapFollowUp, mapFollowUps, parseImages, normalizeSessionCount } from '../utils/mappers.js';
import {
  runFollowUpGeneration,
  runStreamGeneration,
  retryGeneration,
  describeAiError,
  isWordCountOk,
  countWords,
  MIN_WORDS,
  MAX_WORDS,
} from '../services/ai.js';

const router = Router();

/**
 * 获取回访列表（支持按学生/学科/年级过滤 + 分页）
 * 返回 { followups, pagination }，followups 键保持向后兼容。
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

router.get('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { studentId, subject, grade, page, pageSize } = req.query;

    let where = 'WHERE user_id = ?';
    const params: any[] = [userId];

    if (studentId) {
      where += ' AND student_id = ?';
      params.push(parseInt(studentId as string));
    }
    if (subject) {
      where += ' AND subject = ?';
      params.push(subject);
    }
    if (grade) {
      where += ' AND grade = ?';
      params.push(grade);
    }

    // 分页参数带边界保护，防止非法入参
    const p = Math.max(1, parseInt(page as string, 10) || 1);
    const ps = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(pageSize as string, 10) || DEFAULT_PAGE_SIZE));

    const total = (db.prepare('SELECT COUNT(*) AS n FROM followups ' + where).get(...params) as any).n;
    const totalPages = Math.max(1, Math.ceil(total / ps));
    const offset = (p - 1) * ps;

    // 注意：created_at 仅精确到秒，同秒记录顺序不稳定会导致分页重复/漏项，
    // 因此必须追加 id 作为稳定排序键。
    const rows = db
      .prepare('SELECT * FROM followups ' + where + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(...params, ps, offset) as any[];

    res.json({
      followups: mapFollowUps(rows),
      pagination: { page: p, pageSize: ps, total, totalPages },
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取回访列表失败', message: error.message });
  }
});

/**
 * 汇总统计（必须注册在 /:id 之前，否则 'stats' 会被当成 id）
 * 供仪表盘使用：分页后无法再从列表长度推算总量。
 */
router.get('/stats', (req: any, res) => {
  try {
    const userId = req.userId;

    // 仅取 images 一列，避免把全文都拉出来
    const rows = db
      .prepare('SELECT images, subject, created_at FROM followups WHERE user_id = ?')
      .all(userId) as any[];

    const totalImages = rows.reduce((sum, r) => sum + parseImages(r.images).length, 0);

    const recent = db
      .prepare('SELECT * FROM followups WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 5')
      .all(userId) as any[];

    res.json({
      totalFollowUps: rows.length,
      totalImages,
      subjects: [...new Set(rows.map((r) => r.subject))].length,
      recent: mapFollowUps(recent),
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取统计失败', message: error.message });
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

    const content = await runFollowUpGeneration({
      studentName,
      grade,
      subject,
      topic,
      performance,
      mastery,
      sessionCount: normalizeSessionCount(req.body.sessionCount),
      images: images || [],
    });

    const wordCount = countWords(content);

    res.json({ content, wordCount });
  } catch (error: any) {
    const { httpStatus, message } = describeAiError(error);
    console.error('[AI生成失败] ' + httpStatus + ' - ' + message);
    res.status(httpStatus).json({ error: message });
  }
});

/** 距离字数区间的距离，用于两版都不达标时择优 */
function wordsDistance(n: number): number {
  if (n < MIN_WORDS) return MIN_WORDS - n;
  if (n > MAX_WORDS) return n - MAX_WORDS;
  return 0;
}

/**
 * AI 生成（SSE 流式）。
 * 事件：delta -> regenerating? -> done | error
 * 首轮流式输出，若字数不达标则自动重试一次并以最终版本收尾。
 */
router.post('/generate/stream', async (req: any, res) => {
  const { studentName, grade, subject, topic, performance, mastery, images } = req.body;

  if (!studentName || !grade || !subject || !topic || !performance || !mastery) {
    return res.status(400).json({ error: '学生姓名、年级、学科、课程主题、课堂表现、掌握程度均为必填项' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 关键：禁用 nginx 缓冲，否则流式会被攒成一坨再下发
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 客户端提前断开检测。
  // 注意：不能用 req.on('close') —— 请求体读完后它就会触发，会误判为断连。
  // res 的 'close' 在响应结束或连接断开时触发，配合 writableEnded 即可区分。
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

  const params = {
    studentName,
    grade,
    subject,
    topic,
    performance,
    mastery,
    sessionCount: normalizeSessionCount(req.body.sessionCount),
    images: images || [],
  };

  try {
    let full = '';
    for await (const delta of runStreamGeneration(params)) {
      if (clientGone) break; // 客户端已断开，停止消耗
      full += delta;
      send('delta', { text: delta });
    }

    let content = full.trim();
    let wordCount = countWords(content);
    let regenerated = false;

    // 字数不达标 -> 追加纠偏指令重试一次
    if (!isWordCountOk(wordCount)) {
      send('regenerating', { wordCount });
      try {
        const retryContent = await retryGeneration(params, '约 ' + wordCount + ' 字');
        const retryWords = countWords(retryContent);
        if (isWordCountOk(retryWords) || wordsDistance(retryWords) < wordsDistance(wordCount)) {
          content = retryContent;
          wordCount = retryWords;
          regenerated = true;
        }
      } catch (retryError: any) {
        console.warn('[AI流式] 重试失败，保留首轮结果: ' + retryError.message);
      }
    }

    send('done', { content, wordCount, regenerated });
  } catch (error: any) {
    const { message } = describeAiError(error);
    console.error('[AI流式生成失败] ' + message);
    send('error', { error: message });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// 保存回访记录（图片 + AI内容一并归档到学生档案）
router.post('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { studentId, studentName, grade, subject, topic, performance, mastery, images, content } =
      req.body as FollowUpCreate;
    const sessionCount = normalizeSessionCount(req.body.sessionCount);

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
      `INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, session_count, images, content, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId, linkedStudentId, studentName, grade, subject, topic, performance, mastery,
      sessionCount, imagesJson, content, wordCount
    );

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
    const sessionCount = normalizeSessionCount(
      req.body.sessionCount !== undefined ? req.body.sessionCount : existing.session_count
    );

    db.prepare(
      `UPDATE followups SET student_id=?, student_name=?, grade=?, subject=?, topic=?, performance=?, mastery=?, session_count=?, images=?, content=?, word_count=?, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(
      studentId ?? existing.student_id,
      studentName ?? existing.student_name,
      grade ?? existing.grade,
      subject ?? existing.subject,
      topic ?? existing.topic,
      performance ?? existing.performance,
      mastery ?? existing.mastery,
      sessionCount,
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
