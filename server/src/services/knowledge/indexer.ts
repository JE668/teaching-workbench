import { db } from '../../config/database.js';
import { generateEmbedding, serializeEmbedding } from './vectorStore.js';
import { recordChangeEvent } from '../../services/content/references.js';

/** 索引任务状态 */
export interface IndexJobStatus {
  processed: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * 将文本按段落/长度分块
 */
function chunkText(text: string, maxChunkSize = 1500, overlap = 200): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length + para.length <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        // 保留 overlap 字符作为下一块的开头
        currentChunk = currentChunk.slice(-overlap) + '\n\n' + para;
      } else {
        // 单段落超过 maxChunkSize，强制切分
        for (let i = 0; i < para.length; i += maxChunkSize - overlap) {
          chunks.push(para.slice(i, i + maxChunkSize));
        }
        currentChunk = '';
      }
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());

  return chunks.filter(c => c.length > 50); // 过滤过短片段
}

/**
 * 从 followup/observation/report 生成分块并入库
 */
async function indexSourceItem(params: {
  userId: number;
  subjectGroup: string;
  sourceType: 'followup' | 'report' | 'observation';
  sourceId: number;
  text: string;
  metadata: Record<string, any>;
}): Promise<number> {
  const { userId, subjectGroup, sourceType, sourceId, text, metadata } = params;

  if (!text || text.trim().length < 50) return 0;

  const chunks = chunkText(text);
  const pending: { text: string; embedding: Buffer; metadataJson: string }[] = [];
  for (const textChunk of chunks) {
    try {
      const embedding = serializeEmbedding(await generateEmbedding(textChunk, userId));
      pending.push({
        text: textChunk,
        embedding,
        metadataJson: JSON.stringify({
          ...metadata,
          source_type: sourceType,
          source_id: sourceId,
          chunk_length: textChunk.length,
        }),
      });
    } catch (error: any) {
      console.error(`[Indexer] Failed to index chunk for ${sourceType}#${sourceId}:`, error.message);
    }
  }

  // 同一来源重复索引采用事务替换，避免每次增量任务都追加重复分块。
  db.transaction(() => {
    db.prepare('DELETE FROM group_knowledge_chunks WHERE user_id = ? AND source_type = ? AND source_id = ?')
      .run(userId, sourceType, sourceId);
    const insert = db.prepare(
      `INSERT INTO group_knowledge_chunks
       (user_id, subject_group, source_type, source_id, chunk_text, embedding, metadata_json, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
    );
    for (const item of pending) {
      insert.run(userId, subjectGroup, sourceType, sourceId, item.text, item.embedding, item.metadataJson);
    }
  })();
  return pending.length;
}

/**
 * 索引单个回访记录
 */
export async function indexFollowup(userId: number, followupId: number): Promise<number> {
  const row = db.prepare(
    `SELECT f.id, f.user_id, f.student_id, f.content, f.created_at, s.name as student_name, s.subject AS subject_group, s.grade
     FROM followups f
     JOIN students s ON s.id = f.student_id AND s.user_id = f.user_id
     WHERE f.id = ? AND f.user_id = ?`
  ).get(followupId, userId) as { id: number; user_id: number; student_id: number; content: string; created_at: string; student_name: string; subject_group: string; grade: string } | undefined;

  if (!row) return 0;

  const metadata = {
    student_id: row.student_id,
    student_name: row.student_name,
    grade: row.grade,
    followup_created_at: row.created_at,
  };

  return indexSourceItem({
    userId,
    subjectGroup: row.subject_group,
    sourceType: 'followup',
    sourceId: row.id,
    text: row.content,
    metadata,
  });
}

/**
 * 索引单个观察记录
 */
export async function indexObservation(userId: number, observationId: number): Promise<number> {
  const row = db.prepare(
    `SELECT o.id, o.user_id, o.student_name, o.subject AS subject_group, o.grade,
            o.topic, o.class_notes, o.report, o.overall_grade, o.observed_at, o.created_at
     FROM observations o
     WHERE o.id = ? AND o.user_id = ?`
  ).get(observationId, userId) as {
    id: number; user_id: number; student_name: string | null; subject_group: string | null; grade: string | null;
    topic: string; class_notes: string; report: string; overall_grade: string | null; observed_at: string | null; created_at: string;
  } | undefined;

  if (!row) return 0;

  const metadata = {
    student_name: row.student_name,
    grade: row.grade,
    overall_grade: row.overall_grade,
    topic: row.topic,
    observation_created_at: row.observed_at || row.created_at,
  };
  const text = [row.topic, row.class_notes, row.report]
    .filter(part => typeof part === 'string' && part.trim())
    .join('\n\n');

  return indexSourceItem({
    userId,
    subjectGroup: row.subject_group || '未分科',
    sourceType: 'observation',
    sourceId: row.id,
    text,
    metadata,
  });
}

/**
 * 索引单个月报
 */
export async function indexReport(userId: number, reportId: number): Promise<number> {
  const report = db.prepare(
    `SELECT r.id, r.user_id, r.student_id, r.year_month, s.name as student_name, s.subject AS subject_group, s.grade
     FROM monthly_reports r
     JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
     WHERE r.id = ? AND r.user_id = ?`
  ).get(reportId, userId) as { id: number; user_id: number; student_id: number; year_month: string; student_name: string; subject_group: string; grade: string } | undefined;

  if (!report) return 0;

  // 获取报告条目
  const items = db.prepare(
    `SELECT kind, content FROM report_items WHERE report_id = ? AND user_id = ?`
  ).all(reportId, userId) as { kind: string; content: string }[];

  const fullText = items.map(i => `[${i.kind}] ${i.content}`).join('\n\n');
  if (!fullText.trim()) return 0;

  const metadata = {
    student_id: report.student_id,
    student_name: report.student_name,
    grade: report.grade,
    report_year_month: report.year_month,
  };

  return indexSourceItem({
    userId,
    subjectGroup: report.subject_group,
    sourceType: 'report',
    sourceId: report.id,
    text: fullText,
    metadata,
  });
}

/**
 * 增量索引：处理指定时间范围内的新增/更新内容
 */
export async function incrementalIndex(params: {
  userId: number;
  subjectGroup?: string;
  since?: string; // ISO 日期
  types?: ('followup' | 'report' | 'observation')[];
}): Promise<IndexJobStatus> {
  const { userId, subjectGroup, since, types = ['followup', 'report', 'observation'] } = params;

  const status: IndexJobStatus = { processed: 0, failed: 0, skipped: 0, errors: [] };
  // 表/列别名只来自下方常量，所有外部值都使用 SQLite 参数绑定。
  const filters = (alias: 'f' | 'o' | 'r', dateColumn: 'created_at' | 'year_month') => {
    const where = [`${alias}.user_id = ?`];
    const values: (number | string)[] = [userId];
    if (subjectGroup) {
      where.push(`${alias === 'o' ? 'o.subject' : 's.subject'} = ?`);
      values.push(subjectGroup);
    }
    if (since) {
      where.push(`${alias}.${dateColumn} >= ?`);
      values.push(since);
    }
    return { where: where.join(' AND '), values };
  };

  // 索引回访
  if (types.includes('followup')) {
    const filter = filters('f', 'created_at');
    const followups = db.prepare(
      `SELECT f.id FROM followups f
       JOIN students s ON s.id = f.student_id AND s.user_id = f.user_id
       WHERE ${filter.where}
       ORDER BY f.created_at DESC`
    ).all(...filter.values) as { id: number }[];

    for (const f of followups) {
      try {
        const count = await indexFollowup(userId, f.id);
        if (count > 0) status.processed++;
        else status.skipped++;
      } catch (error: any) {
        status.failed++;
        status.errors.push(`followup ${f.id}: ${error.message}`);
      }
    }
  }

  // 索引观察
  if (types.includes('observation')) {
    const filter = filters('o', 'created_at');
    const observations = db.prepare(
      `SELECT o.id FROM observations o
       WHERE ${filter.where}
       ORDER BY o.created_at DESC`
    ).all(...filter.values) as { id: number }[];

    for (const o of observations) {
      try {
        const count = await indexObservation(userId, o.id);
        if (count > 0) status.processed++;
        else status.skipped++;
      } catch (error: any) {
        status.failed++;
        status.errors.push(`observation ${o.id}: ${error.message}`);
      }
    }
  }

  // 索引月报
  if (types.includes('report')) {
    const filter = filters('r', 'created_at');
    const reports = db.prepare(
      `SELECT r.id FROM monthly_reports r
       JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
       WHERE ${filter.where}
       ORDER BY r.year_month DESC`
    ).all(...filter.values) as { id: number }[];

    for (const r of reports) {
      try {
        const count = await indexReport(userId, r.id);
        if (count > 0) status.processed++;
        else status.skipped++;
      } catch (error: any) {
        status.failed++;
        status.errors.push(`report ${r.id}: ${error.message}`);
      }
    }
  }

  return status;
}

/**
 * 全量重建索引（慎用）
 */
export async function rebuildIndex(params: {
  userId: number;
  subjectGroup?: string;
}): Promise<IndexJobStatus> {
  const { userId, subjectGroup } = params;

  // 先清空该用户/教研组的索引
  if (subjectGroup) {
    db.prepare(`DELETE FROM group_knowledge_chunks WHERE user_id = ? AND subject_group = ?`).run(userId, subjectGroup);
  } else {
    db.prepare(`DELETE FROM group_knowledge_chunks WHERE user_id = ?`).run(userId);
  }

  return incrementalIndex({ userId, subjectGroup });
}

/**
 * 删除特定源的索引（源被删除时调用）
 */
export async function deleteSourceIndex(userId: number, sourceType: 'followup' | 'report' | 'observation', sourceId: number): Promise<number> {
  const result = db.prepare(
    `DELETE FROM group_knowledge_chunks WHERE user_id = ? AND source_type = ? AND source_id = ?`
  ).run(userId, sourceType, sourceId);

  return result.changes;
}

/**
 * 记录索引变更事件
 */
export async function recordIndexChangeEvent(userId: number, sourceType: 'followup' | 'report' | 'observation', sourceId: number, action: 'created' | 'updated' | 'deleted'): Promise<void> {
  await recordChangeEvent('knowledge_chunk', 0, [`${action}:${sourceType}:${sourceId}`], 1, userId);
}
