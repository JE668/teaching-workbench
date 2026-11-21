import { db } from '../../config/database.js';

/**
 * 统一草稿版本管理服务
 * 支持 followup / report / observation 三类实体的：
 * - CRUD（创建/读取/更新/删除）
 * - 版本历史
 * - 分支/合并
 * - 冲突检测
 */

export type EntityType = 'followup' | 'report' | 'observation';

export interface UnifiedDraft {
  id: number;
  user_id: number;
  entity_type: EntityType;
  entity_id: number | null;
  version: number;
  content_json: string;
  base_version: number | null;
  fork_from: number | null;
  is_branch: number;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftVersion {
  id: number;
  version: number;
  content_json: string;
  label: string | null;
  is_branch: number;
  base_version: number | null;
  fork_from: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftInput {
  userId: number;
  entityType: EntityType;
  entityId: number | null;
  content: any;
  baseVersion?: number;
  forkFrom?: number;
  label?: string;
  /** 内部分支写入标记；普通保存始终创建主版本。 */
  isBranch?: boolean;
}

export interface MergeResult {
  success: boolean;
  mergedContent?: any;
  conflicts?: Array<{
    path: string;
    base: any;
    current: any;
    incoming: any;
  }>;
}

/**
 * 创建或更新草稿（主版本或分支）
 */
export function upsertDraft(input: CreateDraftInput): UnifiedDraft {
  const { userId, entityType, entityId, content, baseVersion, forkFrom, label, isBranch } = input;
  const contentJson = JSON.stringify(content);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const previousMain = isBranch ? undefined : db.prepare(
    `SELECT id, version FROM unified_drafts
     WHERE user_id = ? AND entity_type = ? AND entity_id IS ? AND is_branch = 0
     ORDER BY version DESC, id DESC LIMIT 1`
  ).get(userId, entityType, entityId) as { id: number; version: number } | undefined;

  const sourceDraft = forkFrom === undefined ? undefined : getDraftById(forkFrom);
  if (forkFrom !== undefined && (!sourceDraft
    || sourceDraft.user_id !== userId
    || sourceDraft.entity_type !== entityType
    || sourceDraft.entity_id !== entityId)) {
    throw new Error('分支来源不存在或不属于当前实体');
  }

  // 每次保存都追加不可变快照，不能再 UPDATE 覆盖历史版本。
  const nextVersion = db.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM unified_drafts
     WHERE user_id = ? AND entity_type = ? AND entity_id IS ?`
  ).get(userId, entityType, entityId) as { version: number };

  const result = db.prepare(`
    INSERT INTO unified_drafts
      (user_id, entity_type, entity_id, version, content_json, base_version, fork_from, is_branch, label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    entityType,
    entityId,
    nextVersion.version,
    contentJson,
    baseVersion ?? sourceDraft?.version ?? previousMain?.version ?? null,
    forkFrom ?? previousMain?.id ?? null,
    isBranch ? 1 : 0,
    label ?? null,
    now,
    now
  );

  return getDraftById(result.lastInsertRowid as number)!;
}

/**
 * 创建分支
 */
export function createBranch(
  userId: number,
  entityType: EntityType,
  entityId: number | null,
  baseDraftId: number,
  label: string,
  content: any
): UnifiedDraft {
  const baseDraft = getDraftById(baseDraftId);
  if (!baseDraft || baseDraft.user_id !== userId
    || baseDraft.entity_type !== entityType
    || baseDraft.entity_id !== entityId) {
    throw new Error('基础草稿不存在、无权限或不属于当前实体');
  }

  return upsertDraft({
    userId,
    entityType,
    entityId,
    content,
    baseVersion: baseDraft.version,
    forkFrom: baseDraftId,
    label,
    isBranch: true,
  });
}

/**
 * 获取草稿详情
 */
export function getDraftById(id: number): UnifiedDraft | null {
  return db.prepare('SELECT * FROM unified_drafts WHERE id = ?').get(id) as UnifiedDraft | null;
}

/**
 * 获取实体的当前主版本草稿
 */
export function getCurrentDraft(userId: number, entityType: EntityType, entityId: number | null): UnifiedDraft | null {
  return db.prepare(
    `SELECT * FROM unified_drafts
     WHERE user_id = ? AND entity_type = ? AND entity_id IS ? AND is_branch = 0
     ORDER BY version DESC, id DESC LIMIT 1`
  ).get(userId, entityType, entityId) as UnifiedDraft | null;
}

/**
 * 获取实体的所有版本历史（含分支）
 */
export function getDraftVersions(userId: number, entityType: EntityType, entityId: number | null): DraftVersion[] {
  return db.prepare(
    `SELECT id, version, content_json, label, is_branch, base_version, fork_from, created_at, updated_at
     FROM unified_drafts
     WHERE user_id = ? AND entity_type = ? AND entity_id IS ?
     ORDER BY created_at ASC, id ASC`
  ).all(userId, entityType, entityId) as DraftVersion[];
}

/**
 * 获取用户的所有草稿（按实体分组）
 */
export function getUserDrafts(userId: number): Map<EntityType, UnifiedDraft[]> {
  const rows = db.prepare(
    `SELECT * FROM unified_drafts
     WHERE user_id = ?
     ORDER BY entity_type, entity_id, version DESC`
  ).all(userId) as UnifiedDraft[];

  const grouped = new Map<EntityType, UnifiedDraft[]>();
  for (const row of rows) {
    const arr = grouped.get(row.entity_type) || [];
    arr.push(row);
    grouped.set(row.entity_type, arr);
  }
  return grouped;
}

/**
 * 删除草稿
 */
export function deleteDraft(userId: number, draftId: number): boolean {
  const result = db.prepare(
    'DELETE FROM unified_drafts WHERE id = ? AND user_id = ?'
  ).run(draftId, userId);
  return result.changes > 0;
}

/**
 * 删除实体的所有草稿（归档时调用）
 */
export function deleteEntityDrafts(userId: number, entityType: EntityType, entityId: number | null): number {
  const result = db.prepare(
    'DELETE FROM unified_drafts WHERE user_id = ? AND entity_type = ? AND entity_id IS ?'
  ).run(userId, entityType, entityId);
  return result.changes;
}

/**
 * 简单的三方合并（基于 JSON 对象的字段级合并）
 * 返回合并结果和冲突列表
 */
export function mergeDrafts(
  baseContent: any,
  currentContent: any,
  incomingContent: any
): MergeResult {
  const conflicts: MergeResult['conflicts'] = [];
  const merged: any = {};

  // 收集所有键
  const allKeys = new Set([
    ...Object.keys(baseContent || {}),
    ...Object.keys(currentContent || {}),
    ...Object.keys(incomingContent || {}),
  ]);

  for (const key of allKeys) {
    const baseVal = baseContent?.[key];
    const currentVal = currentContent?.[key];
    const incomingVal = incomingContent?.[key];

    // 三方相同或仅 incoming 变更
    if (JSON.stringify(baseVal) === JSON.stringify(currentVal) &&
        JSON.stringify(baseVal) !== JSON.stringify(incomingVal)) {
      merged[key] = incomingVal;
    }
    // 仅 current 变更
    else if (JSON.stringify(baseVal) !== JSON.stringify(currentVal) &&
             JSON.stringify(baseVal) === JSON.stringify(incomingVal)) {
      merged[key] = currentVal;
    }
    // 三方都变了且 current === incoming（相同修改）
    else if (JSON.stringify(currentVal) === JSON.stringify(incomingVal) &&
             JSON.stringify(baseVal) !== JSON.stringify(currentVal)) {
      merged[key] = currentVal;
    }
    // 真正的冲突：三方各不相同
    else if (JSON.stringify(baseVal) !== JSON.stringify(currentVal) &&
             JSON.stringify(baseVal) !== JSON.stringify(incomingVal) &&
             JSON.stringify(currentVal) !== JSON.stringify(incomingVal)) {
      conflicts.push({ path: key, base: baseVal, current: currentVal, incoming: incomingVal });
      // 以 current 为准，冲突由前端解决
      merged[key] = currentVal;
    }
    // 其他情况（如一方为 undefined）
    else {
      merged[key] = currentVal ?? incomingVal ?? baseVal;
    }
  }

  return {
    success: conflicts.length === 0,
    mergedContent: merged,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };
}

/**
 * 合并分支回主版本
 */
export function mergeBranch(
  userId: number,
  branchDraftId: number,
  targetEntityId: number | null
): { success: boolean; draftId?: number; conflicts?: MergeResult['conflicts'] } {
  const branch = getDraftById(branchDraftId);
  if (!branch || branch.user_id !== userId || !branch.is_branch || branch.entity_id !== targetEntityId) {
    throw new Error('分支草稿不存在、无权限或不属于目标实体');
  }

  const mainDraft = getCurrentDraft(userId, branch.entity_type, targetEntityId);
  if (!mainDraft) {
    throw new Error('目标主版本不存在');
  }

  const baseDraft = branch.fork_from ? getDraftById(branch.fork_from) : null;
  const baseContent = baseDraft ? JSON.parse(baseDraft.content_json) : {};
  const currentContent = JSON.parse(mainDraft.content_json);
  const incomingContent = JSON.parse(branch.content_json);

  const mergeResult = mergeDrafts(baseContent, currentContent, incomingContent);

  if (mergeResult.success) {
    // 无冲突，直接合并
    const updated = upsertDraft({
      userId,
      entityType: branch.entity_type,
      entityId: targetEntityId,
      content: mergeResult.mergedContent,
      baseVersion: mainDraft.version,
      forkFrom: branch.id,
      label: `合并 ${branch.label || `分支 v${branch.version}`}`,
    });
    // 保留分支节点，版本图才能追溯每次合并来源。
    return { success: true, draftId: updated.id };
  } else {
    // 有冲突，返回冲突信息供前端解决
    return { success: false, conflicts: mergeResult.conflicts };
  }
}

/**
 * 解决冲突后完成合并
 */
export function resolveMerge(
  userId: number,
  branchDraftId: number,
  targetEntityId: number | null,
  resolvedContent: any
): UnifiedDraft {
  const branch = getDraftById(branchDraftId);
  if (!branch || branch.user_id !== userId || !branch.is_branch || branch.entity_id !== targetEntityId) {
    throw new Error('分支草稿不存在、无权限或不属于目标实体');
  }
  const mainDraft = getCurrentDraft(userId, branch.entity_type, targetEntityId);
  if (!mainDraft) throw new Error('目标主版本不存在');

  return upsertDraft({
    userId,
    entityType: branch.entity_type,
    entityId: targetEntityId,
    content: resolvedContent,
    baseVersion: mainDraft.version,
    forkFrom: branch.id,
    label: `合并 ${branch.label || `分支 v${branch.version}`}`,
  });
}

/**
 * 回滚到指定版本
 */
export function rollbackToVersion(
  userId: number,
  entityType: EntityType,
  entityId: number | null,
  targetVersion: number
): UnifiedDraft | null {
  const versions = getDraftVersions(userId, entityType, entityId);
  const target = versions.find(v => v.is_branch === 0 && v.version === targetVersion);
  if (!target) return null;

  return upsertDraft({
    userId,
    entityType,
    entityId,
    content: JSON.parse(target.content_json),
    label: `回滚到 v${targetVersion}`,
  });
}

/**
 * 获取分支图数据（用于可视化版本树）
 */
export function getDraftGraph(userId: number, entityType: EntityType, entityId: number | null): {
  nodes: Array<{ id: number; version: number; label: string | null; isBranch: boolean; forkFrom: number | null; createdAt: string }>;
  edges: Array<{ from: number; to: number }>;
} {
  const versions = getDraftVersions(userId, entityType, entityId);
  const nodes = versions.map(v => ({
    id: v.id,
    version: v.version,
    label: v.label,
    isBranch: v.is_branch === 1,
    forkFrom: v.fork_from,
    createdAt: v.created_at,
  }));
  const edges = versions
    .filter(v => v.fork_from)
    .map(v => ({ from: v.fork_from!, to: v.id }));

  return { nodes, edges };
}