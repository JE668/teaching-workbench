import { Router, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../config/database.js';
import { log } from '../utils/logger.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { searchKnowledge, generateWeeklyDigest, getHighQualityExamples, findSimilarStudents, getKnowledgeStats, KnowledgeError } from '../services/knowledge/vectorStore.js';
import { incrementalIndex, rebuildIndex, deleteSourceIndex, indexFollowup, indexObservation, indexReport } from '../services/knowledge/indexer.js';
import { recordChangeEvent } from '../services/content/references.js';

const router = Router();

// 所有知识库路由需要认证
router.use(authMiddleware);

function respondKnowledgeError(res: Response, error: unknown, logMessage: string, publicMessage: string): Response {
  log.error({ err: error }, logMessage);
  if (error instanceof KnowledgeError) return res.status(error.statusCode).json({ error: error.message });
  return res.status(500).json({ error: publicMessage });
}

function parseOptionalGroupId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new KnowledgeError('groupId 必须是正整数');
  return parsed;
}

function hashJoinCode(joinCode: string): string {
  return createHash('sha256').update(joinCode).digest('hex');
}

function getGroupSummary(groupId: number, userId: number) {
  return db.prepare(
    `SELECT g.id, g.name, g.subject_group, g.created_at, m.role, m.joined_at,
            (SELECT COUNT(*) FROM knowledge_group_members all_members WHERE all_members.group_id = g.id) AS member_count
     FROM knowledge_groups g
     JOIN knowledge_group_members m ON m.group_id = g.id AND m.user_id = ?
     WHERE g.id = ?`
  ).get(userId, groupId);
}

function parseRouteId(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new KnowledgeError(`${field} 必须是正整数`);
  return parsed;
}

function requireGroupOwner(groupId: number, userId: number): void {
  const membership = db.prepare(
    'SELECT role FROM knowledge_group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId) as { role: string } | undefined;
  // 非成员与 member 使用同一响应，避免借此探测其他群组或成员关系。
  if (membership?.role !== 'owner') throw new KnowledgeError('仅教研组 owner 可执行此操作', 403);
}

router.post('/groups', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { name, subjectGroup } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
        typeof subjectGroup !== 'string' || !subjectGroup.trim() || subjectGroup.trim().length > 50) {
      return res.status(400).json({ error: '教研组名称和科目必填，且长度需有效' });
    }
    const joinCode = randomBytes(32).toString('base64url');
    const groupId = db.transaction(() => {
      const inserted = db.prepare(
        `INSERT INTO knowledge_groups (name, subject_group, created_by, join_code_hash)
         VALUES (?, ?, ?, ?)`
      ).run(name.trim(), subjectGroup.trim(), userId, hashJoinCode(joinCode));
      const id = Number(inserted.lastInsertRowid);
      db.prepare(`INSERT INTO knowledge_group_members (group_id, user_id, role) VALUES (?, ?, 'owner')`).run(id, userId);
      return id;
    })();
    return res.status(201).json({
      group: getGroupSummary(groupId, userId),
      joinCode,
      notice: '邀请码仅显示这一次，且只能由一位新成员使用；请通过安全渠道发送。',
    });
  } catch (error: any) {
    return respondKnowledgeError(res, error, '[Knowledge] Create group error', '创建教研组失败');
  }
});

router.post('/groups/join', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const joinCode = typeof req.body?.joinCode === 'string' ? req.body.joinCode.trim() : '';
    if (joinCode.length < 20 || joinCode.length > 200) {
      return res.status(400).json({ error: '邀请码格式无效' });
    }
    const codeHash = hashJoinCode(joinCode);
    const outcome = db.transaction(() => {
      const group = db.prepare(
        'SELECT id, join_code_used_at FROM knowledge_groups WHERE join_code_hash = ?'
      ).get(codeHash) as { id: number; join_code_used_at: string | null } | undefined;
      if (!group) throw new KnowledgeError('邀请码无效或已使用');
      const existing = db.prepare(
        'SELECT 1 FROM knowledge_group_members WHERE group_id = ? AND user_id = ?'
      ).get(group.id, userId);
      // 已成员重试同一请求保持幂等，也不消耗尚未使用的邀请码。
      if (existing) return { groupId: group.id, alreadyMember: true };
      if (group.join_code_used_at) throw new KnowledgeError('邀请码无效或已使用');
      const consumed = db.prepare(
        `UPDATE knowledge_groups
         SET join_code_used_at = datetime('now', '+8 hours'), join_code_used_by = ?
         WHERE id = ? AND join_code_hash = ? AND join_code_used_at IS NULL`
      ).run(userId, group.id, codeHash);
      if (consumed.changes !== 1) throw new KnowledgeError('邀请码无效或已使用');
      db.prepare(
        `INSERT INTO knowledge_group_members (group_id, user_id, role)
         VALUES (?, ?, 'member') ON CONFLICT(group_id, user_id) DO NOTHING`
      ).run(group.id, userId);
      return { groupId: group.id, alreadyMember: false };
    })();
    return res.json({
      group: getGroupSummary(outcome.groupId, userId),
      alreadyMember: outcome.alreadyMember,
    });
  } catch (error: any) {
    return respondKnowledgeError(res, error, '[Knowledge] Join group error', '加入教研组失败');
  }
});

router.get('/groups', (req: AuthenticatedRequest, res: Response) => {
  const groups = db.prepare(
    `SELECT g.id, g.name, g.subject_group, g.created_at, m.role, m.joined_at,
            (SELECT COUNT(*) FROM knowledge_group_members all_members WHERE all_members.group_id = g.id) AS member_count
     FROM knowledge_groups g
     JOIN knowledge_group_members m ON m.group_id = g.id
     WHERE m.user_id = ?
     ORDER BY g.created_at DESC, g.id DESC`
  ).all(req.userId!);
  return res.json({ groups });
});

/** 仅 owner 可查看本组成员；不返回密码、邀请码或其他组的成员关系。 */
router.get('/groups/:groupId/members', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const groupId = parseRouteId(req.params.groupId, 'groupId');
    requireGroupOwner(groupId, userId);
    const members = db.prepare(
      `SELECT m.user_id, u.username, m.role, m.joined_at
       FROM knowledge_group_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.username, m.user_id`
    ).all(groupId);
    return res.json({ groupId, members });
  } catch (error: any) {
    return respondKnowledgeError(res, error, '[Knowledge] List group members error', '获取教研组成员失败');
  }
});

/** 仅 owner 可轮换邀请码；旧 hash 与消费记录同时失效。 */
router.post('/groups/:groupId/join-code/rotate', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const groupId = parseRouteId(req.params.groupId, 'groupId');
    const joinCode = randomBytes(32).toString('base64url');
    db.transaction(() => {
      requireGroupOwner(groupId, userId);
      db.prepare(
        `UPDATE knowledge_groups
         SET join_code_hash = ?, join_code_used_at = NULL, join_code_used_by = NULL
         WHERE id = ?`
      ).run(hashJoinCode(joinCode), groupId);
    })();
    return res.json({
      group: getGroupSummary(groupId, userId),
      joinCode,
      notice: '新邀请码仅显示这一次，且只能由一位新成员使用；旧邀请码已失效。',
    });
  } catch (error: any) {
    return respondKnowledgeError(res, error, '[Knowledge] Rotate join code error', '轮换教研组邀请码失败');
  }
});

/** 撤销后不存在可匹配的 hash，未使用及已使用的旧邀请码均无法再加入。 */
router.delete('/groups/:groupId/join-code', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const groupId = parseRouteId(req.params.groupId, 'groupId');
    db.transaction(() => {
      requireGroupOwner(groupId, userId);
      db.prepare(
        `UPDATE knowledge_groups
         SET join_code_hash = NULL, join_code_used_at = NULL, join_code_used_by = NULL
         WHERE id = ?`
      ).run(groupId);
    })();
    return res.json({ group: getGroupSummary(groupId, userId), revoked: true });
  } catch (error: any) {
    return respondKnowledgeError(res, error, '[Knowledge] Revoke join code error', '撤销教研组邀请码失败');
  }
});

router.delete('/groups/:groupId/members/:memberId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const groupId = parseRouteId(req.params.groupId, 'groupId');
    const memberId = parseRouteId(req.params.memberId, 'memberId');
    db.transaction(() => {
      requireGroupOwner(groupId, userId);
      const target = db.prepare(
        'SELECT role FROM knowledge_group_members WHERE group_id = ? AND user_id = ?'
      ).get(groupId, memberId) as { role: string } | undefined;
      if (!target) throw new KnowledgeError('教研组成员不存在', 404);
      if (target.role === 'owner') throw new KnowledgeError('不能移除教研组 owner');
      const removed = db.prepare(
        `DELETE FROM knowledge_group_members
         WHERE group_id = ? AND user_id = ? AND role = 'member'`
      ).run(groupId, memberId);
      if (removed.changes !== 1) throw new KnowledgeError('成员移除失败', 409);
    })();
    return res.json({ group: getGroupSummary(groupId, userId), removedMemberId: memberId });
  } catch (error: any) {
    return respondKnowledgeError(res, error, '[Knowledge] Remove group member error', '移除教研组成员失败');
  }
});

/**
 * GET /knowledge/search
 * 语义搜索教研组知识库
 * Query: subjectGroup (必填), q (查询文本), limit, minSimilarity
 */
router.get('/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup, q, limit, minSimilarity, groupId } = req.query;

    if (!subjectGroup || !q) {
      return res.status(400).json({ error: 'subjectGroup and q are required' });
    }

    const results = await searchKnowledge({
      userId,
      subjectGroup: String(subjectGroup),
      query: String(q),
      limit: limit ? parseInt(String(limit)) : 10,
      minSimilarity: minSimilarity ? parseFloat(String(minSimilarity)) : 0.65,
      groupId: parseOptionalGroupId(groupId),
    });

    res.json({ results });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Search error', '搜索知识库失败');
  }
});

/**
 * GET /knowledge/weekly-digest
 * 生成教研组周报摘要
 * Query: subjectGroup (必填), startDate, endDate (ISO 日期)
 */
router.get('/weekly-digest', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup, startDate, endDate, groupId } = req.query;

    if (!subjectGroup || !startDate || !endDate) {
      return res.status(400).json({ error: 'subjectGroup, startDate, endDate are required' });
    }

    const digest = await generateWeeklyDigest({
      userId,
      subjectGroup: String(subjectGroup),
      startDate: String(startDate),
      endDate: String(endDate),
      groupId: parseOptionalGroupId(groupId),
    });

    res.json({ digest });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Weekly digest error', '生成每周摘要失败');
  }
});

/**
 * GET /knowledge/high-quality-examples
 * 获取特定主题的优质教学范例
 * Query: subjectGroup (必填), topic (主题), limit
 */
router.get('/high-quality-examples', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup, topic, limit, groupId } = req.query;

    if (!subjectGroup || !topic) {
      return res.status(400).json({ error: 'subjectGroup and topic are required' });
    }

    const examples = await getHighQualityExamples({
      userId,
      subjectGroup: String(subjectGroup),
      topic: String(topic),
      limit: limit ? parseInt(String(limit)) : 5,
      groupId: parseOptionalGroupId(groupId),
    });

    res.json({ examples });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] High quality examples error', '获取高质量示例失败');
  }
});

/**
 * POST /knowledge/similar-students
 * 寻找相似学生（基于知识画像）
 * Body: { subjectGroup, studentId, studentProfile, limit? }
 */
router.post('/similar-students', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup, studentId, limit, studentProfile, groupId } = req.body;

    if (!subjectGroup || !studentId || !studentProfile) {
      return res.status(400).json({ error: 'subjectGroup, studentId, studentProfile are required' });
    }

    const similar = await findSimilarStudents({
      userId,
      subjectGroup,
      studentId: Number(studentId),
      studentProfile,
      limit: limit ? Number(limit) : 5,
      groupId: parseOptionalGroupId(groupId),
    });

    res.json({ similar });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Similar students error', '查找相似学生失败');
  }
});

/**
 * POST /knowledge/index/incremental
 * 增量索引：处理指定时间范围内的新增/更新内容
 * Body: { subjectGroup?, since?, types? }
 */
router.post('/index/incremental', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup, since, types } = req.body;

    const status = await incrementalIndex({
      userId,
      subjectGroup,
      since,
      types,
    });

    // 记录变更事件
    await recordChangeEvent('knowledge_index', 0, ['incremental_index', JSON.stringify({ subjectGroup, since, types })], 1, req.userId!);

    res.json({ status });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Incremental index error', '更新知识库索引失败');
  }
});

/**
 * POST /knowledge/index/rebuild
 * 全量重建索引（慎用）
 * Body: { subjectGroup? }
 */
router.post('/index/rebuild', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup } = req.body;

    const status = await rebuildIndex({ userId, subjectGroup });

    await recordChangeEvent('knowledge_index', 0, ['rebuild_index', JSON.stringify({ subjectGroup })], 1, req.userId!);

    res.json({ status });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Rebuild index error', '重建知识库索引失败');
  }
});

/**
 * POST /knowledge/index/single
 * 手动索引单条记录
 * Body: { type: 'followup'|'report'|'observation', id }
 */
router.post('/index/single', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { type, id } = req.body;

    if (!type || !id) {
      return res.status(400).json({ error: 'type and id are required' });
    }

    let count = 0;
    switch (type) {
      case 'followup':
        count = await indexFollowup(userId, Number(id));
        break;
      case 'observation':
        count = await indexObservation(userId, Number(id));
        break;
      case 'report':
        count = await indexReport(userId, Number(id));
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    await recordChangeEvent('knowledge_chunk', 0, [`indexed:${type}:${id}`], 1, req.userId!);

    res.json({ indexed: count });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Single index error', '索引知识内容失败');
  }
});

/**
 * DELETE /knowledge/index/source
 * 删除特定源的索引（源被删除时调用）
 * Body: { type, id }
 */
router.delete('/index/source', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { type, id } = req.body;

    if (!type || !id) {
      return res.status(400).json({ error: 'type and id are required' });
    }

    const deleted = await deleteSourceIndex(userId, type, Number(id));

    await recordChangeEvent('knowledge_chunk', 0, [`deleted:${type}:${id}`], 1, req.userId!);

    res.json({ deleted });
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Delete source index error', '删除知识来源索引失败');
  }
});

/**
 * GET /knowledge/stats
 * 获取教研组知识库统计信息
 * Query: subjectGroup
 */
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectGroup } = req.query;

    if (!subjectGroup) {
      return res.status(400).json({ error: 'subjectGroup is required' });
    }

    const groupId = parseOptionalGroupId(req.query.groupId);
    res.json(getKnowledgeStats({ userId, subjectGroup: String(subjectGroup), groupId }));
  } catch (error: any) {
    respondKnowledgeError(res, error, '[Knowledge] Stats error', '获取知识库统计失败');
  }
});

export default router;