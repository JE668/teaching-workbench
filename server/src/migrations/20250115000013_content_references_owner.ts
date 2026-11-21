import type { Database } from 'better-sqlite3';

/**
 * 20250115000013 - content_references / content_change_events 归属隔离
 *
 * 修复跨用户泄露：
 *   - content_references 之前没有 user_id，getReferenceStats(userId) 全表统计，
 *     A 用户的引用关系会进 B 的仪表盘数字。
 *   - content_change_events 之前没有 user_id，GET /change-events 把所有人的变更
 *     事件一起返回；mark-notified 也允许标记任意 id。
 *
 * 方案：给两张表都加一列 nullable 的 user_id，再按 source_entity 的归属回填。
 *   - 能定位到 owner（observation/followup/report/student_profile/parent_view/
 *     knowledge_chunk）→ 写该 owner 的 user_id；
 *   - knowledge_index / id=0 等虚拟实体的历史事件写 NULL，普通用户接口不返回；
 *     新事件由调用方显式写入操作人 user_id，cleanup 由管理员门禁控制。
 *
 * 回填用子查询，找不到 owner 的行 user_id 保持 NULL，不丢数据也不误标归属。
 */
const migration = {
  version: '20250115000013',
  description: 'content_references/change_events 增加归属 user_id 并回填',
  up: (db: Database) => {
    const refCols = db.prepare('PRAGMA table_info(content_references)').all() as Array<{ name: string }>;
    if (!refCols.some((c) => c.name === 'user_id')) {
      db.exec('ALTER TABLE content_references ADD COLUMN user_id INTEGER;');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_content_refs_user ON content_references(user_id);');

    db.prepare(
      `UPDATE content_references SET user_id = (
         SELECT o.user_id FROM observations o WHERE o.id = content_references.source_id
       ) WHERE source_type = 'observation' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_references SET user_id = (
         SELECT f.user_id FROM followups f WHERE f.id = content_references.source_id
       ) WHERE source_type = 'followup' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_references SET user_id = (
         SELECT r.user_id FROM monthly_reports r WHERE r.id = content_references.source_id
       ) WHERE source_type = 'report' AND user_id IS NULL`
    ).run();
    // student_profile 只按 profile.id 回填；历史 student_id 无法无歧义判断归属，保持 NULL。
    db.prepare(
      `UPDATE content_references SET user_id = (
         SELECT sp.user_id FROM student_profiles sp
          WHERE sp.id = content_references.source_id
       ) WHERE source_type = 'student_profile' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_references SET user_id = (
         SELECT pv.user_id FROM parent_views pv WHERE pv.id = content_references.source_id
       ) WHERE source_type = 'parent_view' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_references SET user_id = (
         SELECT g.user_id FROM group_knowledge_chunks g WHERE g.id = content_references.source_id
       ) WHERE source_type = 'knowledge_chunk' AND user_id IS NULL`
    ).run();
    // knowledge_index：虚拟实体保持 NULL，不对普通用户展示。

    const evtCols = db.prepare('PRAGMA table_info(content_change_events)').all() as Array<{ name: string }>;
    if (!evtCols.some((c) => c.name === 'user_id')) {
      db.exec('ALTER TABLE content_change_events ADD COLUMN user_id INTEGER;');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_change_events_user ON content_change_events(user_id, notified);');

    db.prepare(
      `UPDATE content_change_events SET user_id = (
         SELECT o.user_id FROM observations o WHERE o.id = content_change_events.entity_id
       ) WHERE entity_type = 'observation' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_change_events SET user_id = (
         SELECT f.user_id FROM followups f WHERE f.id = content_change_events.entity_id
       ) WHERE entity_type = 'followup' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_change_events SET user_id = (
         SELECT r.user_id FROM monthly_reports r WHERE r.id = content_change_events.entity_id
       ) WHERE entity_type = 'report' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_change_events SET user_id = (
         SELECT sp.user_id FROM student_profiles sp
          WHERE sp.id = content_change_events.entity_id
       ) WHERE entity_type = 'student_profile' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_change_events SET user_id = (
         SELECT pv.user_id FROM parent_views pv WHERE pv.id = content_change_events.entity_id
       ) WHERE entity_type = 'parent_view' AND user_id IS NULL`
    ).run();
    db.prepare(
      `UPDATE content_change_events SET user_id = (
         SELECT g.user_id FROM group_knowledge_chunks g WHERE g.id = content_change_events.entity_id
       ) WHERE entity_type = 'knowledge_chunk' AND user_id IS NULL`
    ).run();
    // knowledge_index：虚拟实体保持 NULL，不对普通用户展示。
  },
  down: (db: Database) => {
    // SQLite ALTER TABLE DROP COLUMN 需 3.35+；保守处理：只删索引不动列，
    // 列残留无害（服务层不再依赖它之外的语义）。如需真删请使用重建表方案。
    db.exec('DROP INDEX IF EXISTS idx_content_refs_user;');
    db.exec('DROP INDEX IF EXISTS idx_change_events_user;');
    console.warn('回滚 20250115000013：索引已删除，user_id 列保留（无害冗余）');
  },
};

export default migration;
