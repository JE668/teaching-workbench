import { Router } from 'express';
import { db } from '../config/database.js';
import { FollowUpCreate } from '../types/index.js';
import {
  mapFollowUp,
  mapFollowUps,
  parseImages,
  normalizeSessionCount,
  normalizeCourseType,
} from '../utils/mappers.js';
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
import { commitImages } from '../services/imageLifecycle.js';

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

/**
 * 历史联想：从该用户自己的历史记录里提取
 *  - 常用课程主题（避免每次重打）
 *  - 常用课堂表现短语（比内置通用词更贴合个人习惯）
 */
router.get('/suggestions', (req: any, res) => {
  try {
    const userId = req.userId;
    const studentId = req.query.studentId ? parseInt(req.query.studentId as string, 10) : null;

    // 指定学生时优先用该学生的历史，同时掺入全局（新学生也有词可用）
    const scoped = studentId
      ? (db
          .prepare(
            'SELECT topic, performance FROM followups WHERE user_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 100'
          )
          .all(userId, studentId) as any[])
      : [];

    const global = db
      .prepare('SELECT topic, performance FROM followups WHERE user_id = ? ORDER BY created_at DESC LIMIT 300')
      .all(userId) as any[];

    const topicCount = new Map<string, number>();
    for (const row of [...scoped, ...global]) {
      const t = String(row.topic || '').trim();
      if (t && t.length <= 40) topicCount.set(t, (topicCount.get(t) || 0) + 1);
    }

    // 短语：把课堂表现按标点拆成短句，统计高频片段
    const phraseCount = new Map<string, number>();
    for (const row of [...scoped, ...global]) {
      for (const piece of String(row.performance || '').split(/[，,、；;。.\n]/)) {
        const p = piece.trim();
        // 太短没意义，太长不适合做快捷按钮
        if (p.length < 2 || p.length > 14) continue;
        phraseCount.set(p, (phraseCount.get(p) || 0) + 1);
      }
    }

    const rank = (m: Map<string, number>, limit: number) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([text, count]) => ({ text, count }));

    res.json({
      topics: rank(topicCount, 12),
      phrases: rank(phraseCount, 12),
    });
  } catch (error: any) {
    res.status(500).json({ error: '获取历史建议失败', message: error.message });
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
    const courseType = normalizeCourseType(req.body.courseType);

    // 小组课不面向单个学生，无需姓名
    if ((courseType !== 'group' && !studentName) || !grade || !subject || !topic || !performance || !mastery) {
      return res.status(400).json({ error: '年级、学科、课程主题、课堂表现、掌握程度均为必填项' });
    }

    const content = await runFollowUpGeneration({
      studentName: studentName || '',
      grade,
      subject,
      topic,
      performance,
      mastery,
      sessionCount: normalizeSessionCount(req.body.sessionCount),
      courseType,
      nickname: req.body.nickname,
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
  const courseType = normalizeCourseType(req.body.courseType);

  // 小组课不面向单个学生，无需姓名
  if ((courseType !== 'group' && !studentName) || !grade || !subject || !topic || !performance || !mastery) {
    return res.status(400).json({ error: '年级、学科、课程主题、课堂表现、掌握程度均为必填项' });
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
    studentName: studentName || '',
    grade,
    subject,
    topic,
    performance,
    mastery,
    sessionCount: normalizeSessionCount(req.body.sessionCount),
    courseType,
    nickname: req.body.nickname,
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

/**
 * 把该用户所有「同名且尚未关联学生」的历史回访补挂到指定学生档案。
 *
 * 场景：老师之前直接手输姓名保存，记录没进任何档案；
 * 现在这个学生正式建档了，历史记录应当自动归位。
 */
function backfillFollowUps(userId: number, studentId: number, studentName: string): number {
  const result = db
    .prepare(
      'UPDATE followups SET student_id = ? WHERE user_id = ? AND student_name = ? AND student_id IS NULL'
    )
    .run(studentId, userId, studentName);
  return result.changes;
}

/** 小组课归档结果 */
interface GroupArchiveResult {
  error?: string;
  followups?: any[];
  backfilled?: number;
}

// 保存回访记录（图片 + AI内容一并归档到学生档案）
router.post('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const { studentId, studentName, grade, subject, topic, performance, mastery, images, content } =
      req.body as FollowUpCreate;
    const sessionCount = normalizeSessionCount(req.body.sessionCount);
    const courseType = normalizeCourseType(req.body.courseType);

    // 小组课不需要 studentName；1对1 必须提供
    if (!grade || !subject || !topic || !performance || !mastery || !content) {
      return res.status(400).json({ error: '年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项' });
    }

    const wordCount = countWords(content);
    // 【提交图片】把暂存图挪到正式归档（按账户名分目录）。
    // 未保存的回访不会留下正式文件 —— "只保留已保存回访的图片"的关键一步。
    const committedImages = commitImages(userId, images || []);
    const imagesJson = JSON.stringify(committedImages);

    const insert = db.prepare(
      `INSERT INTO followups (user_id, student_id, student_name, grade, subject, topic, performance, mastery, session_count, course_type, images, content, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // ============ 小组课：为每个选中的学生各存一条相同内容 ============
    if (courseType === 'group') {
      const rawIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
      const ids = [...new Set(rawIds.map((v: any) => parseInt(v, 10)).filter((n: number) => Number.isFinite(n)))];

      if (ids.length === 0) {
        return res.status(400).json({ error: '小组课请至少选择一名学生' });
      }

      const placeholders = ids.map(() => '?').join(',');
      const students = db
        .prepare('SELECT id, name FROM students WHERE user_id = ? AND id IN (' + placeholders + ')')
        .all(userId, ...ids) as any[];

      if (students.length !== ids.length) {
        return res.status(400).json({ error: '有学生不存在或无权访问' });
      }

      const run = db.transaction((rows: any[]) => {
        const ids: number[] = [];
        for (const s of rows) {
          const r = insert.run(
            userId, s.id, s.name, grade, subject, topic, performance, mastery,
            sessionCount, 'group', imagesJson, content, wordCount
          );
          ids.push(Number(r.lastInsertRowid));
        }
        return ids;
      });

      const newIds = run(students);
      // 顺带把各学生名下未关联的历史记录归位
      let backfilled = 0;
      for (const s of students) backfilled += backfillFollowUps(userId, s.id, s.name);

      const followups = newIds.map((id) =>
        mapFollowUp(db.prepare('SELECT * FROM followups WHERE id = ?').get(id))
      );

      return res.json({
        followup: followups[0],
        followups,
        created: followups.length,
        backfilled,
      });
    }

    // ============ 1对1 ============
    if (!studentName) {
      return res.status(400).json({ error: '请填写学生姓名' });
    }

    let linkedStudentId: number | null = null;
    let createdStudent = false;
    let backfilled = 0;

    if (studentId) {
      // 显式指定的学生：校验归属，避免越权写入他人档案
      const owned = db
        .prepare('SELECT id FROM students WHERE id = ? AND user_id = ?')
        .get(studentId, userId) as any;
      if (!owned) {
        return res.status(400).json({ error: '关联的学生不存在或无权访问' });
      }
      linkedStudentId = owned.id;
    } else {
      // 未选学生但填了姓名：先匹配学生库，没有则建档
      const matched = db
        .prepare('SELECT id FROM students WHERE user_id = ? AND name = ? ORDER BY id LIMIT 1')
        .get(userId, studentName) as any;

      if (matched) {
        linkedStudentId = matched.id;
      } else {
        const r = db
          .prepare('INSERT INTO students (user_id, name, grade, subject) VALUES (?, ?, ?, ?)')
          .run(userId, studentName, grade, subject);
        linkedStudentId = Number(r.lastInsertRowid);
        createdStudent = true;
      }
    }

    if (linkedStudentId) {
      backfilled = backfillFollowUps(userId, linkedStudentId, studentName);
    }

    const result = insert.run(
      userId, linkedStudentId, studentName, grade, subject, topic, performance, mastery,
      sessionCount, 'one_on_one', imagesJson, content, wordCount
    );

    const row = db.prepare('SELECT * FROM followups WHERE id = ?').get(result.lastInsertRowid);

    res.json({
      followup: mapFollowUp(row),
      // 让前端能提示「已自动建档」「已归位 N 条历史记录」
      createdStudent,
      backfilled,
    });
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
    // 编辑时新增的暂存图同样要提交；已有正式路径原样保留
    const committedImages = commitImages(userId, images ?? parseImages(existing.images));
    const imagesJson = JSON.stringify(committedImages);
    const sessionCount = normalizeSessionCount(
      req.body.sessionCount !== undefined ? req.body.sessionCount : existing.session_count
    );
    const courseType = normalizeCourseType(
      req.body.courseType !== undefined ? req.body.courseType : existing.course_type
    );

    db.prepare(
      `UPDATE followups SET student_id=?, student_name=?, grade=?, subject=?, topic=?, performance=?, mastery=?, session_count=?, course_type=?, images=?, content=?, word_count=?, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(
      studentId ?? existing.student_id,
      studentName ?? existing.student_name,
      grade ?? existing.grade,
      subject ?? existing.subject,
      topic ?? existing.topic,
      performance ?? existing.performance,
      mastery ?? existing.mastery,
      sessionCount,
      courseType,
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
