import { db } from '../config/database.js';

/**
 * 把「未关联学生」的历史回访按姓名补挂到学生档案。
 *
 * 为什么需要：老师可能先写了回访、之后才在「学生管理」里建档案
 * （或先建了但当时没关联上）。这些记录会一直挂在 student_id = NULL 上，
 * 学生的档案页里看不到自己过往的回访。
 *
 * 安全策略：**同名歧义时绝不猜**。
 * 只有该姓名在学生库里恰好对应一个学生时才回填；
 * 0 个（还没建档）或 ≥2 个（同名不同人）都跳过，交给老师自己决定。
 */

export interface LinkResult {
  /** 被补挂的回访条数 */
  linked: number;
  /** 因同名歧义或查无此人而跳过的姓名数 */
  skippedNames: number;
}

export function linkOrphansByName(userId: number, onlyName?: string): LinkResult {
  const names: string[] = onlyName
    ? [String(onlyName)]
    : (db
        .prepare(
          'SELECT DISTINCT student_name FROM followups WHERE user_id = ? AND student_id IS NULL'
        )
        .all(userId) as any[]).map((r) => String(r.student_name || ''));

  const findStudents = db.prepare('SELECT id FROM students WHERE user_id = ? AND name = ?');
  const link = db.prepare(
    'UPDATE followups SET student_id = ? WHERE user_id = ? AND student_name = ? AND student_id IS NULL'
  );

  let linked = 0;
  let skippedNames = 0;

  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name) continue;

    const candidates = findStudents.all(userId, name) as any[];
    if (candidates.length !== 1) {
      // 没这个人 → 什么都不做；有多个同名 → 不猜，避免挂错档案
      if (candidates.length > 1) skippedNames++;
      continue;
    }

    const changes = link.run(candidates[0].id, userId, name).changes;
    if (changes > 0) linked += changes;
  }

  return { linked, skippedNames };
}

/** 启动时对所有用户做一次存量修复（幂等，可重复执行） */
export function repairAllUsers(): number {
  const users = db.prepare('SELECT id FROM users').all() as any[];
  let total = 0;

  for (const u of users) {
    total += linkOrphansByName(u.id).linked;
  }

  return total;
}
