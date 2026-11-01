import { Router } from 'express';
import { db } from '../config/database.js';

const router = Router();

// 草稿历史表结构（如果不存在则自动创建）
// CREATE TABLE IF NOT EXISTS draft_history (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   user_id INTEGER NOT NULL,
//   payload TEXT NOT NULL,
//   created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
//   source TEXT,  -- 'auto' | 'manual' | 'ai' | 'import'
//   client_id TEXT
// );
// CREATE INDEX IF NOT EXISTS idx_draft_history_user_created ON draft_history(user_id, created_at DESC);

function initHistoryTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS draft_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
      source TEXT,
      client_id TEXT
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_draft_history_user_created
    ON draft_history(user_id, created_at DESC)
  `).run();
}

// 初始化表
initHistoryTable();

const MAX_HISTORY = 20; // 只保留最近 20 条

/** 记录草稿变更到历史 */
export function recordDraftHistory(
  userId: number,
  payload: any,
  source: 'auto' | 'manual' | 'ai' | 'import' = 'auto',
  clientId?: string
) {
  try {
    const json = JSON.stringify(payload);
    db.prepare(
      `INSERT INTO draft_history (user_id, payload, source, client_id)
       VALUES (?, ?, ?, ?)`
    ).run(userId, json, source, clientId || null);

    // 清理旧记录，只保留最近 MAX_HISTORY 条
    db.prepare(
      `DELETE FROM draft_history
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM draft_history
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`
    ).run(userId, userId, MAX_HISTORY);
  } catch (error) {
    // 历史记录失败不应阻塞主流程
    console.error('[draft history] record failed:', error);
  }
}

/** 获取草稿历史列表 */
router.get('/history', (req: any, res) => {
  try {
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || MAX_HISTORY, 50);

    const rows = db.prepare(
      `SELECT id, payload, created_at, source, client_id
       FROM draft_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(userId, limit) as any[];

    const history = rows.map(row => ({
      id: row.id,
      payload: JSON.parse(row.payload),
      createdAt: row.created_at,
      source: row.source,
      clientId: row.client_id,
    }));

    res.json({ history });
  } catch (error: any) {
    res.status(500).json({ error: '获取草稿历史失败', message: error.message });
  }
});

/** 回滚到指定历史版本 */
router.post('/history/:id/restore', (req: any, res) => {
  try {
    const userId = req.userId;
    const historyId = parseInt(req.params.id);
    const clientId = req.body?.clientId;

    const row = db.prepare(
      `SELECT payload FROM draft_history WHERE id = ? AND user_id = ?`
    ).get(historyId, userId) as any;

    if (!row) {
      return res.status(404).json({ error: '历史版本不存在' });
    }

    const payload = JSON.parse(row.payload);

    // 将回滚后的内容写入当前草稿
    db.prepare(
      `INSERT INTO drafts (user_id, payload, updated_at) VALUES (?, ?, datetime('now','+8 hours'))
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    ).run(userId, JSON.stringify(payload));

    // 记录这次回滚操作本身也算作一次历史
    recordDraftHistory(userId, payload, 'manual', clientId);

    res.json({ success: true, payload });
  } catch (error: any) {
    res.status(500).json({ error: '回滚失败', message: error.message });
  }
});

/** 删除指定历史版本 */
router.delete('/history/:id', (req: any, res) => {
  try {
    const userId = req.userId;
    const historyId = parseInt(req.params.id);

    db.prepare(
      `DELETE FROM draft_history WHERE id = ? AND user_id = ?`
    ).run(historyId, userId);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '删除历史失败', message: error.message });
  }
});

/** 清空所有历史 */
router.delete('/history', (req: any, res) => {
  try {
    const userId = req.userId;

    db.prepare(
      `DELETE FROM draft_history WHERE user_id = ?`
    ).run(userId);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: '清空历史失败', message: error.message });
  }
});

export default router;