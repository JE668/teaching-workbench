import { Router } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { validateBody } from '../utils/validation.js';
import { teacherCreateSchema } from '../utils/schemas.js';
import { mapTeacher, mapTeachers } from '../utils/mappers.js';

/**
 * 被听课老师。
 * 语义：下拉数据源 + 去重。同名（同用户）复用同一条，避免每次听课都新增。
 */
const router = Router();

const MAX_NAME = 30;

router.get('/', (req: AuthenticatedRequest, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM teachers WHERE user_id = ? ORDER BY name, id')
      .all(req.userId!) as any[];
    res.json({ teachers: mapTeachers(rows) });
  } catch (error: any) {
    res.status(500).json({ error: '获取老师列表失败', message: error.message });
  }
});

/** 新建老师（同用户同名 → 返回已有那条，不重复建） */
router.post('/', validateBody(teacherCreateSchema), (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const name = String(req.body?.name || '').trim();
    const subject = req.body?.subject != null ? String(req.body.subject).trim() : null;

    if (!name) return res.status(400).json({ error: '请填写老师姓名' });
    if (name.length > MAX_NAME) return res.status(400).json({ error: '老师姓名过长' });

    const existing = db
      .prepare('SELECT * FROM teachers WHERE user_id = ? AND name = ?')
      .get(userId, name) as any;
    if (existing) {
      // 顺带补一下主教科目（若之前没填）
      if (subject) {
        db.prepare('UPDATE teachers SET subject = ? WHERE id = ? AND (subject IS NULL OR subject = \'\')').run(
          subject,
          existing.id
        );
      }
      return res.json({ teacher: mapTeacher(existing) });
    }

    const result = db
      .prepare('INSERT INTO teachers (user_id, name, subject) VALUES (?, ?, ?)')
      .run(userId, name, subject);
    const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(result.lastInsertRowid);
    res.json({ teacher: mapTeacher(row) });
  } catch (error: any) {
    // 唯一索引冲突（并发同建）也按"已存在"处理
    if (error?.message?.includes('UNIQUE')) {
      const row = db.prepare('SELECT * FROM teachers WHERE user_id = ? AND name = ?').get(
        req.userId!,
        String(req.body?.name || '').trim()
      );
      if (row) return res.json({ teacher: mapTeacher(row) });
    }
    res.status(500).json({ error: '创建老师失败', message: error.message });
  }
});

router.delete('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = db
      .prepare('DELETE FROM teachers WHERE id = ? AND user_id = ?')
      .run(id, req.userId!);
    if (result.changes === 0) return res.status(404).json({ error: '老师不存在' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除老师失败', message: error.message });
  }
});

export default router;
