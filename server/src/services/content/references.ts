import { db } from '../../config/database.js';
import { log } from '../../utils/logger.js';

export type EntityType = 'observation' | 'followup' | 'report' | 'student_profile' | 'knowledge_index' | 'knowledge_chunk' | 'parent_view';
export type RefRole = 'cites' | 'derives_from' | 'supplements';

export interface ContentReference {
  id: number;
  source_type: EntityType;
  source_id: number;
  target_type: EntityType;
  target_id: number;
  ref_role: RefRole;
  /** 归属用户；knowledge_index 等全局共享实体为 NULL */
  user_id: number | null;
  created_at: string;
}

export interface ChangeEvent {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  changed_fields: string; // JSON array
  version: number;
  notified: boolean;
  /** 归属用户；NULL 为无法确认归属的历史/虚拟事件，不对普通用户展示 */
  user_id: number | null;
  created_at: string;
}

// ============ 归属解析 ============

// 每种 entity_type 的归属表。knowledge_index 当前是全局共享，无归属表。
const OWNER_TABLE: Record<EntityType, string | null> = {
  observation: 'observations',
  followup: 'followups',
  report: 'monthly_reports',
  // student_profiles 同时以 profile.id 与 student_id 被外部引用，两者都能定位归属
  student_profile: 'student_profiles',
  knowledge_index: null,
  knowledge_chunk: 'group_knowledge_chunks',
  parent_view: 'parent_views',
};

/**
 * 返回实体归属的 user_id。
 *   - 找不到归属表（knowledge_index）→ null（全局共享）
 *   - 表存在但行不存在 / 行无 user_id → undefined（调用方应视为非法访问）
 *   - 正常 → 该实体的 user_id
 */
export function resolveEntityOwner(entityType: EntityType, entityId: number): number | null | undefined {
  const table = OWNER_TABLE[entityType];
  if (!table) return null; // 全局共享实体
  let row: { user_id?: number } | undefined;
  if (entityType === 'student_profile') {
    // student_profile 的对外 entityId 一律是 profile.id；不能用 student_id 猜测归属，
    // 否则不同用户的 profile.id / student.id 撞号时可能越权。
    row = db.prepare(
      `SELECT user_id FROM ${table} WHERE id = ?`
    ).get(entityId) as { user_id?: number } | undefined;
  } else {
    row = db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).get(entityId) as { user_id?: number } | undefined;
  }
  if (!row) return undefined;
  return row.user_id ?? undefined;
}

/**
 * 校验实体归属当前用户。
 *   · knowledge_index 等无归属实体：登录用户均可访问（全局共享）
 *   · 其它实体：必须存在且 user_id 与当前用户匹配
 */
export function ownsEntity(userId: number, entityType: EntityType, entityId: number): boolean {
  const owner = resolveEntityOwner(entityType, entityId);
  if (owner === null) return true; // 全局共享
  if (owner === undefined) return false; // 实体不存在
  return owner === userId;
}

/**
 * 建立引用关系。user_id 取 source 实体归属（调用方需已 verifyOwnership）。
 * 若 source 是全局共享实体（knowledge_index），引用行 user_id = NULL。
 */
export function createReference(
  userId: number,
  sourceType: EntityType,
  sourceId: number,
  targetType: EntityType,
  targetId: number,
  refRole: RefRole = 'cites'
): number | null {
  try {
    const owner = resolveEntityOwner(sourceType, sourceId);
    // 全局共享 source（如 knowledge_index）→ user_id = NULL；
    // 其余（含不存在实体，调用方已验证）→ 写 userId
    const ownerId = owner === null ? null : userId;
    const result = db.prepare(`
      INSERT OR IGNORE INTO content_references (source_type, source_id, target_type, target_id, ref_role, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sourceType, sourceId, targetType, targetId, refRole, ownerId);

    if (result.changes > 0) {
      log.debug({ userId: ownerId, sourceType, sourceId, targetType, targetId, refRole }, '创建内容引用');
      return result.lastInsertRowid as number;
    }
    return null; // 已存在
  } catch (error: any) {
    log.error({ error: error.message }, '创建引用失败');
    return null;
  }
}

/**
 * 批量建立引用（事务）。所有引用归属取各自 source 实体。
 */
export function createReferences(
  userId: number,
  refs: Array<{ sourceType: EntityType; sourceId: number; targetType: EntityType; targetId: number; refRole?: RefRole }>
): number {
  const tx = db.transaction(() => {
    let count = 0;
    for (const ref of refs) {
      const owner = resolveEntityOwner(ref.sourceType, ref.sourceId);
      const ownerId = owner === null ? null : userId;
      const result = db.prepare(`
        INSERT OR IGNORE INTO content_references (source_type, source_id, target_type, target_id, ref_role, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(ref.sourceType, ref.sourceId, ref.targetType, ref.targetId, ref.refRole || 'cites', ownerId);
      if (result.changes > 0) count++;
    }
    return count;
  });
  return tx();
}

/**
 * 获取某实体引用的所有目标（出链）。
 * 不在此处按 user 过滤：调用方必须先通过 ownsEntity 校验 source 实体归属，
 * 命中后再读它的出链是安全的（同一实体的出链属于同一 owner）。
 */
export function getOutgoingReferences(sourceType: EntityType, sourceId: number): ContentReference[] {
  return db.prepare(`
    SELECT * FROM content_references WHERE source_type = ? AND source_id = ?
  `).all(sourceType, sourceId) as ContentReference[];
}

/**
 * 获取引用某实体的所有来源（入链）。
 * 入链可能来自多个 user（跨 user 引用被业务侧拒绝，但历史数据/全局共享实体可能存在）。
 * 这里仍按 target 定位（调用方先 ownsEntity 校验目标归属），不额外按 user 过滤，
 * 以保持「看某个实体的完整引用图」语义。
 */
export function getIncomingReferences(targetType: EntityType, targetId: number): ContentReference[] {
  return db.prepare(`
    SELECT * FROM content_references WHERE target_type = ? AND target_id = ?
  `).all(targetType, targetId) as ContentReference[];
}

/**
 * 删除引用。调用方需已 verify source 实体归属。
 */
export function deleteReference(
  sourceType: EntityType,
  sourceId: number,
  targetType: EntityType,
  targetId: number,
  refRole: RefRole
): boolean {
  const result = db.prepare(`
    DELETE FROM content_references
    WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND ref_role = ?
  `).run(sourceType, sourceId, targetType, targetId, refRole);
  return result.changes > 0;
}

/**
 * 删除实体的所有出链。调用方需已 verify source 实体归属。
 */
export function deleteOutgoingReferences(sourceType: EntityType, sourceId: number): number {
  const result = db.prepare(`
    DELETE FROM content_references WHERE source_type = ? AND source_id = ?
  `).run(sourceType, sourceId);
  return result.changes;
}

export class ReferenceSyncError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ReferenceSyncError';
  }
}

/** 每条引用独立计算待同步事件，不读取/修改全局 notified 状态。 */
export function getPendingReferenceChanges(referenceId: number, userId: number, limit = 20): ChangeEvent[] {
  const ref = db.prepare(
    'SELECT target_type, target_id, last_synced_event_id FROM content_references WHERE id = ? AND user_id = ?'
  ).get(referenceId, userId) as { target_type: EntityType; target_id: number; last_synced_event_id: number } | undefined;
  if (!ref) return [];
  return db.prepare(
    `SELECT * FROM content_change_events
     WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND id > ?
     ORDER BY id DESC LIMIT ?`
  ).all(userId, ref.target_type, ref.target_id, ref.last_synced_event_id || 0, Math.min(Math.max(limit, 1), 100)) as ChangeEvent[];
}

export interface ReferenceSyncResult {
  referenceId: number;
  reportId: number;
  targetField: 'summary_intro' | 'plan_intro';
  content: string;
  syncedEventId: number;
}

/**
 * 将观察记录的最新已选字段同步到月报总结/规划。
 * 目标字段严格白名单，来源与目标都必须属于当前用户；同步进度只推进当前引用。
 */
export function syncObservationToReport(
  userId: number,
  referenceId: number,
  targetField: 'summary_intro' | 'plan_intro',
  sourceField: 'report' | 'class_notes' = 'report'
): ReferenceSyncResult {
  if (!['summary_intro', 'plan_intro'].includes(targetField) || !['report', 'class_notes'].includes(sourceField)) {
    throw new ReferenceSyncError(400, '同步字段无效');
  }
  return db.transaction((): ReferenceSyncResult => {
    const ref = db.prepare(
      `SELECT * FROM content_references
       WHERE id = ? AND user_id = ? AND source_type = 'report' AND target_type = 'observation'`
    ).get(referenceId, userId) as (ContentReference & { last_synced_event_id?: number }) | undefined;
    if (!ref) throw new ReferenceSyncError(404, '可同步的观察记录引用不存在');
    const observation = db.prepare(
      `SELECT id, report, class_notes FROM observations WHERE id = ? AND user_id = ?`
    ).get(ref.target_id, userId) as { id: number; report: string; class_notes: string } | undefined;
    if (!observation) throw new ReferenceSyncError(404, '观察记录不存在或无权访问');
    const report = db.prepare(
      'SELECT id FROM monthly_reports WHERE id = ? AND user_id = ?'
    ).get(ref.source_id, userId);
    if (!report) throw new ReferenceSyncError(404, '月报不存在或无权访问');
    const content = String(observation[sourceField] || '').trim();
    if (!content) throw new ReferenceSyncError(409, '观察记录的所选字段为空，无法同步');
    const latestEvent = db.prepare(
      `SELECT COALESCE(MAX(id), 0) AS id FROM content_change_events
       WHERE user_id = ? AND entity_type = 'observation' AND entity_id = ?`
    ).get(userId, ref.target_id) as { id: number };
    db.prepare(
      `UPDATE monthly_reports SET ${targetField} = ?, updated_at = datetime('now', '+8 hours')
       WHERE id = ? AND user_id = ?`
    ).run(content, ref.source_id, userId);
    db.prepare(
      `UPDATE content_references
       SET last_synced_event_id = ?, last_synced_at = datetime('now', '+8 hours')
       WHERE id = ? AND user_id = ?`
    ).run(latestEvent.id, referenceId, userId);
    recordChangeEvent('report', ref.source_id, ['reference_sync', targetField], 2, userId);
    return {
      referenceId,
      reportId: ref.source_id,
      targetField,
      content,
      syncedEventId: latestEvent.id,
    };
  })();
}

/**
 * 记录变更事件。调用方必须显式传入已鉴权的归属用户。
 * 即使 knowledge_index / knowledge_chunk 使用虚拟 id=0，也按本次操作人归属，
 * 不生成全员可见的全局事件。实体被删除后也仍能正确记录归属。
 */
export function recordChangeEvent(
  entityType: EntityType,
  entityId: number,
  changedFields: string[],
  version: number,
  userId: number
): number | null {
  try {
    const result = db.prepare(`
      INSERT INTO content_change_events (entity_type, entity_id, changed_fields, version, user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(entityType, entityId, JSON.stringify(changedFields), version, userId);

    log.debug({ userId, entityType, entityId, changedFields, version }, '记录变更事件');
    return result.lastInsertRowid as number;
  } catch (error: any) {
    log.error({ error: error.message }, '记录变更事件失败');
    return null;
  }
}

/**
 * 获取未通知的变更事件。
 * 按 user 过滤：只返回该 user 自己的事件；NULL 归属事件不对普通用户展示。
 * userId 缺省时返回全部，仅供受信任的后台任务使用。
 */
export function getUnnotifiedChanges(limit = 100, userId?: number): ChangeEvent[] {
  if (userId === undefined) {
    return db.prepare(`
      SELECT * FROM content_change_events
      WHERE notified = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as ChangeEvent[];
  }
  return db.prepare(`
    SELECT * FROM content_change_events
    WHERE notified = 0 AND user_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(userId, limit) as ChangeEvent[];
}

/**
 * 标记变更事件已通知。
 * userId 提供时只允许标记本人事件，防止越权标记。
 */
export function markChangesNotified(eventIds: number[], userId?: number): number {
  if (eventIds.length === 0) return 0;
  const placeholders = eventIds.map(() => '?').join(',');
  if (userId === undefined) {
    const result = db.prepare(`
      UPDATE content_change_events SET notified = 1 WHERE id IN (${placeholders})
    `).run(...eventIds);
    return result.changes;
  }
  const result = db.prepare(`
    UPDATE content_change_events SET notified = 1
    WHERE id IN (${placeholders}) AND user_id = ?
  `).run(...eventIds, userId);
  return result.changes;
}

/**
 * 获取实体的变更历史。调用方需已 verify 实体归属。
 */
export function getEntityChangeHistory(entityType: EntityType, entityId: number, limit = 50): ChangeEvent[] {
  return db.prepare(`
    SELECT * FROM content_change_events
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(entityType, entityId, limit) as ChangeEvent[];
}

/**
 * 清理旧变更事件（保留最近 N 天）。
 * userId 提供时只清理该 user 自己的事件；不提供时全局清理（仅供管理员/定时任务）。
 */
export function cleanupOldChangeEvents(retainDays = 90, userId?: number): number {
  if (userId === undefined) {
    const result = db.prepare(`
      DELETE FROM content_change_events
      WHERE created_at < datetime('now', '+8 hours', '-' || ? || ' days')
    `).run(retainDays);
    return result.changes;
  }
  const result = db.prepare(`
    DELETE FROM content_change_events
    WHERE created_at < datetime('now', '+8 hours', '-' || ? || ' days') AND user_id = ?
  `).run(retainDays, userId);
  return result.changes;
}

/**
 * 获取引用统计（用于仪表盘）。
 * 严格按 user 过滤：只统计该 user 自己的引用。全局共享实体（user_id IS NULL）
 * 不计入个人统计，避免 A 用户看到 B 的引用数字。
 */
export function getReferenceStats(userId: number): {
  totalRefs: number;
  byRole: Record<string, number>;
  bySourceType: Record<string, number>;
  byTargetType: Record<string, number>;
} {
  const totalRefs = db.prepare(
    'SELECT COUNT(*) as c FROM content_references WHERE user_id = ?'
  ).get(userId) as { c: number };

  const byRole = db.prepare(`
    SELECT ref_role, COUNT(*) as c FROM content_references WHERE user_id = ? GROUP BY ref_role
  `).all(userId) as { ref_role: string; c: number }[];

  const bySourceType = db.prepare(`
    SELECT source_type, COUNT(*) as c FROM content_references WHERE user_id = ? GROUP BY source_type
  `).all(userId) as { source_type: string; c: number }[];

  const byTargetType = db.prepare(`
    SELECT target_type, COUNT(*) as c FROM content_references WHERE user_id = ? GROUP BY target_type
  `).all(userId) as { target_type: string; c: number }[];

  return {
    totalRefs: totalRefs?.c || 0,
    byRole: Object.fromEntries(byRole.map(r => [r.ref_role, r.c])),
    bySourceType: Object.fromEntries(bySourceType.map(r => [r.source_type, r.c])),
    byTargetType: Object.fromEntries(byTargetType.map(r => [r.target_type, r.c])),
  };
}
