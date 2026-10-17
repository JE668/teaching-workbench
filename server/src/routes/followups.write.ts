import { Router, Response } from 'express';
import { db } from '../config/database.js';
import { FollowUpCreate, AuthenticatedRequest } from '../types/index.js';
import {
  mapFollowUp,
  parseImages,
  normalizeSessionCount,
  normalizeCourseType,
} from '../utils/mappers.js';
import { countWords } from '../services/ai.js';
import { commitImages } from '../services/imageLifecycle.js';

/**
 * 写操作路由：创建（1对1 + 小组课）/ 更新 / 删除。
 */
const router = Router();

/**
 * 把该用户所有「同名且尚未关联学生」的历史回访补挂到指定学生档案。
 *
 * 场景：老师之前直接手输姓名保存，记录没进任何档案；
 * 现在这个学生正式建档了，历史记录应当自动归位。
 */
function backfillFollowUps(userId: number, studentId: number, studentName: string): number {
  const result = db
    .prepare('UPDATE followups SET student_id = ? WHERE user_id = ? AND student_name = ? AND student_id IS NULL')
    .run(studentId, userId, studentName);
  return result.changes;
}

// 保存回访记录（图片 + AI内容一并归档到学生档案）
router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
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
        const newIds: number[] = [];
        for (const s of rows) {
          const r = insert.run(
            userId, s.id, s.name, grade, subject, topic, performance, mastery,
            sessionCount, 'group', imagesJson, content, wordCount
          );
          newIds.push(Number(r.lastInsertRowid));
        }
        return newIds;
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
router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const followupId = parseInt(req.params.id, 10);
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
router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const followupId = parseInt(req.params.id, 10);

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
