import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import {
  upsertDraft,
  getCurrentDraft,
  getDraftVersions,
  deleteDraft,
  deleteEntityDrafts,
  createBranch,
  mergeBranch,
  resolveMerge,
  rollbackToVersion,
  getDraftGraph,
  getUserDrafts,
  type EntityType,
} from '../services/drafts/unifiedDrafts.js';
import { log } from '../utils/logger.js';

const router = Router();

function respondInternalError(res: Response, error: unknown, publicMessage: string): void {
  log.error({ err: error }, publicMessage);
  res.status(500).json({ error: publicMessage });
}

/**
 * GET /api/unified-drafts
 * 获取用户所有草稿（按实体类型分组）
 */
router.get('/', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const grouped = getUserDrafts(userId);
    const result: Record<string, any[]> = {};
    for (const [key, value] of grouped) {
      result[key] = value.map(d => ({
        id: d.id,
        entity_type: d.entity_type,
        entity_id: d.entity_id,
        version: d.version,
        label: d.label,
        is_branch: d.is_branch,
        fork_from: d.fork_from,
        created_at: d.created_at,
        updated_at: d.updated_at,
      }));
    }
    res.json({ drafts: result });
  } catch (error: any) {
    respondInternalError(res, error, '获取草稿列表失败');
  }
});

/**
 * GET /api/unified-drafts/:entityType/:entityId/current
 * 获取实体的当前主版本草稿
 * entityId 为 'new' 时表示新建实体（entity_id 为 null）
 */
router.get('/:entityType/:entityId/current', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }

    const draft = getCurrentDraft(userId, entityType, entityId);
    if (!draft) {
      return res.json({ draft: null });
    }

    res.json({
      draft: {
        id: draft.id,
        entity_type: draft.entity_type,
        entity_id: draft.entity_id,
        version: draft.version,
        content: JSON.parse(draft.content_json),
        label: draft.label,
        is_branch: draft.is_branch,
        fork_from: draft.fork_from,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      },
    });
  } catch (error: any) {
    respondInternalError(res, error, '获取草稿失败');
  }
});

/**
 * GET /api/unified-drafts/:entityType/:entityId/versions
 * 获取实体的所有版本历史
 */
router.get('/:entityType/:entityId/versions', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }

    const versions = getDraftVersions(userId, entityType, entityId);
    res.json({
      versions: versions.map(v => ({
        id: v.id,
        version: v.version,
        content: JSON.parse(v.content_json),
        label: v.label,
        is_branch: v.is_branch === 1,
        base_version: v.base_version,
        fork_from: v.fork_from,
        created_at: v.created_at,
        updated_at: v.updated_at,
      })),
    });
  } catch (error: any) {
    respondInternalError(res, error, '获取版本历史失败');
  }
});

/**
 * GET /api/unified-drafts/:entityType/:entityId/graph
 * 获取版本图数据（用于可视化版本树）
 */
router.get('/:entityType/:entityId/graph', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }

    const graph = getDraftGraph(userId, entityType, entityId);
    res.json({ graph });
  } catch (error: any) {
    respondInternalError(res, error, '获取版本图失败');
  }
});

/**
 * POST /api/unified-drafts/:entityType/:entityId
 * 创建或更新草稿（主版本）
 */
router.post('/:entityType/:entityId', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);
    const { content, label } = req.body as { content: any; label?: string };

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ error: 'content 必填且必须为对象' });
    }

    const draft = upsertDraft({ userId, entityType, entityId, content, label });
    res.json({
      draft: {
        id: draft.id,
        entity_type: draft.entity_type,
        entity_id: draft.entity_id,
        version: draft.version,
        label: draft.label,
        is_branch: draft.is_branch,
        fork_from: draft.fork_from,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      },
    });
  } catch (error: any) {
    respondInternalError(res, error, '保存草稿失败');
  }
});

/**
 * POST /api/unified-drafts/:entityType/:entityId/branch
 * 基于指定版本创建分支
 * body: { baseDraftId, label, content }
 */
router.post('/:entityType/:entityId/branch', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);
    const { baseDraftId, label, content } = req.body as {
      baseDraftId: number;
      label: string;
      content: any;
    };

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }
    if (!baseDraftId || !Number.isFinite(baseDraftId)) {
      return res.status(400).json({ error: 'baseDraftId 必填' });
    }
    if (!label || typeof label !== 'string') {
      return res.status(400).json({ error: 'label 必填' });
    }
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ error: 'content 必填且必须为对象' });
    }

    const draft = createBranch(userId, entityType, entityId, baseDraftId, label, content);
    res.json({
      draft: {
        id: draft.id,
        entity_type: draft.entity_type,
        entity_id: draft.entity_id,
        version: draft.version,
        label: draft.label,
        is_branch: draft.is_branch,
        fork_from: draft.fork_from,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      },
    });
  } catch (error: any) {
    respondInternalError(res, error, '创建分支失败');
  }
});

/**
 * POST /api/unified-drafts/:entityType/:entityId/merge
 * 合并分支回主版本
 * body: { branchDraftId }
 */
router.post('/:entityType/:entityId/merge', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);
    const { branchDraftId } = req.body as { branchDraftId: number };

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }
    if (!branchDraftId || !Number.isFinite(branchDraftId)) {
      return res.status(400).json({ error: 'branchDraftId 必填' });
    }

    const result = mergeBranch(userId, branchDraftId, entityId);
    if (result.success) {
      res.json({ success: true, draftId: result.draftId });
    } else {
      res.status(409).json({
        success: false,
        error: '合并冲突',
        conflicts: result.conflicts,
      });
    }
  } catch (error: any) {
    respondInternalError(res, error, '合并失败');
  }
});

/**
 * POST /api/unified-drafts/:entityType/:entityId/resolve-merge
 * 解决冲突后完成合并
 * body: { branchDraftId, resolvedContent }
 */
router.post('/:entityType/:entityId/resolve-merge', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);
    const { branchDraftId, resolvedContent } = req.body as {
      branchDraftId: number;
      resolvedContent: any;
    };

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }
    if (!branchDraftId || !Number.isFinite(branchDraftId)) {
      return res.status(400).json({ error: 'branchDraftId 必填' });
    }
    if (!resolvedContent || typeof resolvedContent !== 'object') {
      return res.status(400).json({ error: 'resolvedContent 必填且必须为对象' });
    }

    const draft = resolveMerge(userId, branchDraftId, entityId, resolvedContent);
    res.json({
      draft: {
        id: draft.id,
        entity_type: draft.entity_type,
        entity_id: draft.entity_id,
        version: draft.version,
        label: draft.label,
        is_branch: draft.is_branch,
        fork_from: draft.fork_from,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      },
    });
  } catch (error: any) {
    respondInternalError(res, error, '解决冲突合并失败');
  }
});

/**
 * POST /api/unified-drafts/:entityType/:entityId/rollback
 * 回滚到指定版本
 * body: { targetVersion }
 */
router.post('/:entityType/:entityId/rollback', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);
    const { targetVersion } = req.body as { targetVersion: number };

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }
    if (!targetVersion || !Number.isFinite(targetVersion)) {
      return res.status(400).json({ error: 'targetVersion 必填' });
    }

    const draft = rollbackToVersion(userId, entityType, entityId, targetVersion);
    if (!draft) {
      return res.status(404).json({ error: '目标版本不存在' });
    }
    res.json({
      draft: {
        id: draft.id,
        entity_type: draft.entity_type,
        entity_id: draft.entity_id,
        version: draft.version,
        label: draft.label,
        is_branch: draft.is_branch,
        fork_from: draft.fork_from,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      },
    });
  } catch (error: any) {
    respondInternalError(res, error, '回滚失败');
  }
});

/**
 * DELETE /api/unified-drafts/:entityType/:entityId/:draftId
 * 删除指定草稿
 */
router.delete('/:entityType/:entityId/:draftId', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);
    const draftId = parseInt(req.params.draftId, 10);

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }
    if (!Number.isFinite(draftId)) {
      return res.status(400).json({ error: '无效的草稿 ID' });
    }

    const success = deleteDraft(userId, draftId);
    if (!success) {
      return res.status(404).json({ error: '草稿不存在' });
    }
    res.json({ success: true });
  } catch (error: any) {
    respondInternalError(res, error, '删除草稿失败');
  }
});

/**
 * DELETE /api/unified-drafts/:entityType/:entityId
 * 删除实体的所有草稿（归档成功后调用）
 */
router.delete('/:entityType/:entityId', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const entityType = req.params.entityType as EntityType;
    const entityId = req.params.entityId === 'new' ? null : parseInt(req.params.entityId, 10);

    if (!['followup', 'report', 'observation'].includes(entityType)) {
      return res.status(400).json({ error: '无效的实体类型' });
    }
    if (entityId !== null && !Number.isFinite(entityId)) {
      return res.status(400).json({ error: '无效的实体 ID' });
    }

    const count = deleteEntityDrafts(userId, entityType, entityId);
    res.json({ success: true, deletedCount: count });
  } catch (error: any) {
    respondInternalError(res, error, '清空草稿失败');
  }
});

export default router;