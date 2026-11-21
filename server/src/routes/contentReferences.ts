import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { db } from '../config/database.js';
import { log } from '../utils/logger.js';
import {
  createReference,
  createReferences,
  getOutgoingReferences,
  getIncomingReferences,
  deleteReference,
  getUnnotifiedChanges,
  markChangesNotified,
  getEntityChangeHistory,
  cleanupOldChangeEvents,
  getReferenceStats,
  getPendingReferenceChanges,
  syncObservationToReport,
  ReferenceSyncError,
  ownsEntity,
  EntityType,
  RefRole,
} from '../services/content/references.js';

const router = Router();

/**
 * 管理员账号名单（逗号分隔）。
 * 用于清理变更事件等「全局副作用」端点的门禁。
 * 未配置时所有需要管理员权限的端点一律 404，
 * 端点本身也不暴露，而不是仅靠前端隐藏。
 */
function isAdminUser(username: string | undefined): boolean {
  const list = (process.env.ADMIN_USERNAMES || '').trim();
  if (!list || !username) return false;
  return list.split(',').map(s => s.trim()).filter(Boolean).includes(username);
}

/** 取当前请求的账户名（用于管理员判定）。 */
function usernameOf(req: AuthenticatedRequest): string | undefined {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId!) as
    | { username: string }
    | undefined;
  return row?.username;
}

/**
 * POST /api/content/references
 * 创建单个引用
 * body: { sourceType, sourceId, targetType, targetId, refRole? }
 */
router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sourceType, sourceId, targetType, targetId, refRole = 'cites' } = req.body as {
      sourceType: EntityType;
      sourceId: number;
      targetType: EntityType;
      targetId: number;
      refRole?: RefRole;
    };

    if (!sourceType || !sourceId || !targetType || !targetId) {
      return res.status(400).json({ error: 'sourceType, sourceId, targetType, targetId 必填' });
    }

    if (!ownsEntity(req.userId!, sourceType, sourceId) ||
        !ownsEntity(req.userId!, targetType, targetId)) {
      return res.status(403).json({ error: '无权操作该实体' });
    }

    const refId = createReference(req.userId!, sourceType, sourceId, targetType, targetId, refRole);

    if (refId === null) {
      return res.status(409).json({ error: '引用已存在' });
    }

    res.json({ success: true, refId });
  } catch (error: any) {
    log.error({ err: error }, '创建引用失败');
    res.status(500).json({ error: '创建引用失败' });
  }
});

/**
 * POST /api/content/references/batch
 * 批量创建引用
 * body: { refs: [{ sourceType, sourceId, targetType, targetId, refRole? }] }
 */
router.post('/batch', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { refs } = req.body as {
      refs: Array<{ sourceType: EntityType; sourceId: number; targetType: EntityType; targetId: number; refRole?: RefRole }>;
    };

    if (!refs || !Array.isArray(refs) || refs.length === 0) {
      return res.status(400).json({ error: 'refs 数组必填且非空' });
    }

    for (const ref of refs) {
      if (!ownsEntity(req.userId!, ref.sourceType, ref.sourceId) ||
          !ownsEntity(req.userId!, ref.targetType, ref.targetId)) {
        return res.status(403).json({ error: '无权操作某实体' });
      }
    }

    const count = createReferences(req.userId!, refs);
    res.json({ success: true, created: count });
  } catch (error: any) {
    log.error({ err: error }, '批量创建引用失败');
    res.status(500).json({ error: '批量创建引用失败' });
  }
});

/**
 * GET /api/content/references/outgoing/:entityType/:entityId
 * 获取实体的出链（它引用了什么）
 */
router.get('/outgoing/:entityType/:entityId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entityType = req.params.entityType as EntityType;
    const entityId = parseInt(req.params.entityId, 10);

    if (!['observation', 'followup', 'report'].includes(entityType) || !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '参数无效' });
    }

    if (!ownsEntity(req.userId!, entityType, entityId)) {
      return res.status(403).json({ error: '无权查看' });
    }

    const refs = getOutgoingReferences(entityType, entityId);
    const enriched = await Promise.all(refs.map(async (ref) => {
      const target = await getEntitySummary(ref.target_type, ref.target_id);
      const pendingEvents = getPendingReferenceChanges(ref.id, req.userId!);
      return { ...ref, target, pendingEvents };
    }));

    res.json({ references: enriched });
  } catch (error: any) {
    log.error({ err: error }, '获取出链失败');
    res.status(500).json({ error: '获取出链失败' });
  }
});

/**
 * POST /api/content/references/:id/sync
 * 将引用的观察记录报告/课堂笔记同步到当前月报总结或规划。
 * body: { targetField: 'summary_intro' | 'plan_intro', sourceField?: 'report' | 'class_notes' }
 */
router.post('/:id/sync', (req: AuthenticatedRequest, res: Response) => {
  try {
    const referenceId = Number(req.params.id);
    if (!Number.isInteger(referenceId) || referenceId <= 0) {
      return res.status(400).json({ error: '引用 ID 无效' });
    }
    const { targetField, sourceField = 'report' } = req.body as {
      targetField: 'summary_intro' | 'plan_intro';
      sourceField?: 'report' | 'class_notes';
    };
    const result = syncObservationToReport(req.userId!, referenceId, targetField, sourceField);
    res.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof ReferenceSyncError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    log.error({ err: error }, '同步引用内容失败');
    res.status(500).json({ error: '同步引用内容失败' });
  }
});

/**
 * GET /api/content/references/incoming/:entityType/:entityId
 * 获取实体的入链（什么引用了它）
 */
router.get('/incoming/:entityType/:entityId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entityType = req.params.entityType as EntityType;
    const entityId = parseInt(req.params.entityId, 10);

    if (!['observation', 'followup', 'report'].includes(entityType) || !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '参数无效' });
    }

    if (!ownsEntity(req.userId!, entityType, entityId)) {
      return res.status(403).json({ error: '无权查看' });
    }

    const refs = getIncomingReferences(entityType, entityId);
    const enriched = await Promise.all(refs.map(async (ref) => {
      const source = await getEntitySummary(ref.source_type, ref.source_id);
      return { ...ref, source };
    }));

    res.json({ references: enriched });
  } catch (error: any) {
    log.error({ err: error }, '获取入链失败');
    res.status(500).json({ error: '获取入链失败' });
  }
});

/**
 * DELETE /api/content/references
 * 删除单个引用
 * body: { sourceType, sourceId, targetType, targetId, refRole }
 */
router.delete('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sourceType, sourceId, targetType, targetId, refRole } = req.body as {
      sourceType: EntityType;
      sourceId: number;
      targetType: EntityType;
      targetId: number;
      refRole: RefRole;
    };

    if (!sourceType || !sourceId || !targetType || !targetId || !refRole) {
      return res.status(400).json({ error: '所有字段必填' });
    }

    // 只有源实体拥有者能删除引用
    if (!ownsEntity(req.userId!, sourceType, sourceId)) {
      return res.status(403).json({ error: '无权删除该引用' });
    }

    const ok = deleteReference(sourceType, sourceId, targetType, targetId, refRole);
    res.json({ success: ok });
  } catch (error: any) {
    log.error({ err: error }, '删除引用失败');
    res.status(500).json({ error: '删除引用失败' });
  }
});

/**
 * GET /api/content/change-events
 * 获取未通知的变更事件（供后台任务/轮询）。
 * 严格按当前用户过滤：只返回本人事件；NULL 归属历史/虚拟事件不展示。
 * query: limit
 */
router.get('/change-events', (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const events = getUnnotifiedChanges(limit, req.userId!);
    res.json({ events });
  } catch (error: any) {
    log.error({ err: error }, '获取变更事件失败');
    res.status(500).json({ error: '获取变更事件失败' });
  }
});

/**
 * POST /api/content/change-events/mark-notified
 * 标记变更事件已通知
 * body: { eventIds: number[] }
 * 只允许标记本人事件；他人及 NULL 归属事件被静默忽略。
 */
router.post('/change-events/mark-notified', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventIds } = req.body as { eventIds: number[] };

    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({ error: 'eventIds 数组必填' });
    }
    if (eventIds.length > 500) {
      return res.status(400).json({ error: 'eventIds 最多 500 个' });
    }
    const ids = eventIds.map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'eventIds 必须是正整数数组' });
    }

    const count = markChangesNotified(ids, req.userId!);
    res.json({ success: true, marked: count });
  } catch (error: any) {
    log.error({ err: error }, '标记变更事件失败');
    res.status(500).json({ error: '标记变更事件失败' });
  }
});

/**
 * GET /api/content/change-events/:entityType/:entityId
 * 获取实体的变更历史
 */
router.get('/change-events/:entityType/:entityId', (req: AuthenticatedRequest, res: Response) => {
  try {
    const entityType = req.params.entityType as EntityType;
    const entityId = parseInt(req.params.entityId, 10);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    if (!['observation', 'followup', 'report'].includes(entityType) || !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '参数无效' });
    }

    if (!ownsEntity(req.userId!, entityType, entityId)) {
      return res.status(403).json({ error: '无权查看' });
    }

    const events = getEntityChangeHistory(entityType, entityId, limit);
    res.json({ events });
  } catch (error: any) {
    log.error({ err: error }, '获取变更历史失败');
    res.status(500).json({ error: '获取变更历史失败' });
  }
});

/**
 * POST /api/content/change-events/cleanup
 * 清理旧变更事件（管理员专用）。
 *
 * 门禁：必须命中 ADMIN_USERNAMES 环境变量列出的账户；未配置 ADMIN_USERNAMES 时，
 * 本端点对所有人 404，不依赖前端隐藏。
 * body: { retainDays?: number }
 */
router.post('/change-events/cleanup', (req: AuthenticatedRequest, res: Response) => {
  if (!isAdminUser(usernameOf(req))) {
    return res.status(404).json({ error: 'Not Found' });
  }
  try {
    const retainDays = parseInt(req.body.retainDays as string) || 90;
    const count = cleanupOldChangeEvents(retainDays);
    res.json({ success: true, deleted: count });
  } catch (error: any) {
    log.error({ err: error }, '清理变更事件失败');
    res.status(500).json({ error: '清理变更事件失败' });
  }
});

/**
 * GET /api/content/stats
 * 获取引用统计（仪表盘用）。
 * 严格按 user 过滤：只统计本人（user_id = 当前用户）的引用。
 */
router.get('/stats', (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = getReferenceStats(req.userId!);
    res.json({ stats });
  } catch (error: any) {
    log.error({ err: error }, '获取引用统计失败');
    res.status(500).json({ error: '获取引用统计失败' });
  }
});

/**
 * 获取实体摘要信息（用于丰富引用显示）。
 * 仅在 ownsEntity 校验通过后被调用，这里不再额外按 user 过滤。
 */
async function getEntitySummary(entityType: EntityType, entityId: number): Promise<{ id: number; title: string; created_at: string } | null> {
  const tableMap: Record<EntityType, { table: string; titleCol: string }> = {
    observation: { table: 'observations', titleCol: 'topic' },
    followup: { table: 'followups', titleCol: 'topic' },
    report: { table: 'monthly_reports', titleCol: 'year_month' },
    student_profile: { table: 'student_profiles', titleCol: 'id' },
    knowledge_index: { table: 'knowledge_index', titleCol: 'id' },
    knowledge_chunk: { table: 'group_knowledge_chunks', titleCol: 'id' },
    parent_view: { table: 'parent_views', titleCol: 'id' },
  };

  const config = tableMap[entityType];
  if (!config || !config.table) return null;

  try {
    const row = db.prepare(`SELECT id, ${config.titleCol} as title, created_at FROM ${config.table} WHERE id = ?`).get(entityId) as { id: number; title: string; created_at: string } | undefined;
    return row || null;
  } catch {
    // knowledge_index 等表可能不存在，静默返回 null
    return null;
  }
}

export default router;
