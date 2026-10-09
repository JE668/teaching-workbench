import { Router } from 'express';
import { db } from '../config/database.js';

const router = Router();

/**
 * 小组课分组预设。
 *
 * 场景：同一个班每周都是那几个人，但偶尔有人请假。
 * 因此语义是「默认全选，再由老师手动取消请假的」——
 * 分组只是一组可一键勾选的成员，不保证每次都全员到齐。
 */

const MAX_NAME = 30;
const MAX_MEMBERS = 50;

function parseIds(raw: any): number[] {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n)))];
  } catch {
    return [];
  }
}

/**
 * 只返回该用户仍然存在的学生 id。
 * 学生被删除后分组里会留下悬空 id —— 读的时候顺手清理，避免前端勾选不上。
 */
function liveMemberIds(userId: number, ids: number[]): number[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare('SELECT id FROM students WHERE user_id = ? AND id IN (' + placeholders + ')')
    .all(userId, ...ids) as any[];
  return rows.map((r) => r.id);
}

function mapGroup(userId: number, row: any) {
  const stored = parseIds(row.student_ids);
  const live = liveMemberIds(userId, stored);

  return {
    id: row.id,
    name: row.name,
    studentIds: live,
    memberCount: live.length,
    // 有成员被删掉时告知前端，便于提示"该分组已失效的部分"
    staleCount: stored.length - live.length,
    createdAt: row.created_at,
  };
}

/** 列出全部分组 */
router.get('/', (req: any, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM groups WHERE user_id = ? ORDER BY created_at DESC, id DESC')
      .all(req.userId) as any[];

    res.json({ groups: rows.map((r) => mapGroup(req.userId, r)) });
  } catch (error: any) {
    res.status(500).json({ error: '获取分组失败', message: error.message });
  }
});

/** 新建分组 */
router.post('/', (req: any, res) => {
  try {
    const userId = req.userId;
    const name = String(req.body?.name || '').trim();
    const ids = parseIds(JSON.stringify(req.body?.studentIds || []));

    if (!name) return res.status(400).json({ error: '请填写分组名称' });
    if (name.length > MAX_NAME) return res.status(400).json({ error: '分组名称过长' });
    if (ids.length === 0) return res.status(400).json({ error: '请至少选择一名学生' });
    if (ids.length > MAX_MEMBERS) return res.status(400).json({ error: '单个分组最多 ' + MAX_MEMBERS + ' 人' });

    const live = liveMemberIds(userId, ids);
    if (live.length !== ids.length) {
      return res.status(400).json({ error: '有学生不存在或无权访问' });
    }

    const dup = db.prepare('SELECT id FROM groups WHERE user_id = ? AND name = ?').get(userId, name);
    if (dup) return res.status(409).json({ error: '已存在同名分组' });

    const result = db
      .prepare('INSERT INTO groups (user_id, name, student_ids) VALUES (?, ?, ?)')
      .run(userId, name, JSON.stringify(ids));

    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
    res.json({ group: mapGroup(userId, row) });
  } catch (error: any) {
    res.status(500).json({ error: '创建分组失败', message: error.message });
  }
});

/** 更新分组（改名或改成员） */
router.put('/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const groupId = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(groupId, userId) as any;
    if (!existing) return res.status(404).json({ error: '分组不存在' });

    let name = existing.name;
    if (req.body?.name !== undefined) {
      name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: '请填写分组名称' });
      if (name.length > MAX_NAME) return res.status(400).json({ error: '分组名称过长' });
    }

    let ids = parseIds(existing.student_ids);
    if (req.body?.studentIds !== undefined) {
      ids = parseIds(JSON.stringify(req.body.studentIds));
      if (ids.length === 0) return res.status(400).json({ error: '请至少选择一名学生' });
      if (ids.length > MAX_MEMBERS) return res.status(400).json({ error: '单个分组最多 ' + MAX_MEMBERS + ' 人' });

      const live = liveMemberIds(userId, ids);
      if (live.length !== ids.length) {
        return res.status(400).json({ error: '有学生不存在或无权访问' });
      }
    }

    db.prepare('UPDATE groups SET name = ?, student_ids = ? WHERE id = ? AND user_id = ?').run(
      name,
      JSON.stringify(ids),
      groupId,
      userId
    );

    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    res.json({ group: mapGroup(userId, row) });
  } catch (error: any) {
    res.status(500).json({ error: '更新分组失败', message: error.message });
  }
});

/** 删除分组 */
router.delete('/:id', (req: any, res) => {
  try {
    const result = db
      .prepare('DELETE FROM groups WHERE id = ? AND user_id = ?')
      .run(parseInt(req.params.id, 10), req.userId);

    if (result.changes === 0) return res.status(404).json({ error: '分组不存在' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除分组失败', message: error.message });
  }
});

export default router;
