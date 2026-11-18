/**
 * BI 数据导入服务。
 *
 * 导入流程：
 *   1. 接收上传的 xlsx 文件
 *   2. 创建 upload_batch 记录（status=pending）
 *   3. 调用对应 parser 解析
 *   4. 将 records 写入对应 raw_* 表（status=parsed）
 *   5. 错误行写入 import_error
 *   6. 标记 batch 为 committed
 *
 * 所有操作在一个事务中完成，失败则回滚并标记 batch 为 failed。
 */
import { biDb } from './db.js';
import { PARSERS } from './parsers.js';
import type { MapperResult } from './mappers.js';
import { log } from '../utils/logger.js';
import type { FileType } from './fileRegistry.js';

export interface ImportOptions {
  fileType: FileType;
  filePath: string;
  fileName: string;
  fileSize: number;
  uploadedBy: number;
  note?: string;
}

export interface ImportResult {
  batchId: number;
  status: 'committed' | 'failed';
  totalRows: number;
  successRows: number;
  errorRows: number;
  errors: { rowNumber: number; errorCode: string; errorMessage: string }[];
}

/**
 * 获取 raw 表名（按 file_type）
 */
function getTableName(fileType: FileType): string {
  const mapping: Record<string, string> = {
    student_snapshot: 'raw_student_snapshot',
    subject_snapshot: 'raw_subject_snapshot',
    renew_close_ratio: 'raw_renew_close_ratio',
    xusheng_detail: 'raw_xusheng_detail',
    xuke_detail: 'raw_xuke_detail',
    scheduled_course: 'raw_scheduled_course',
    voucher: 'raw_voucher',
    personal_perf: 'raw_personal_perf',
  };
  return mapping[fileType] || '';
}

/**
 * 获取 raw 表的列名（排除 id, batch_id, created_at，这些自动生成）
 */
function getTableColumns(tableName: string): string[] {
  const cols = biDb.prepare('PRAGMA table_info(' + tableName + ')').all() as { name: string; pk: number }[];
  return cols
    .filter(c => !['id', 'batch_id', 'created_at'].includes(c.name) && !c.pk)
    .map(c => c.name);
}

/**
 * 导入一个 xlsx 文件到 bi.db。
 */
export async function importBiFile(options: ImportOptions): Promise<ImportResult> {
  const { fileType, filePath, fileName, fileSize, uploadedBy, note } = options;

  const parser = PARSERS[fileType];
  if (!parser) {
    throw new Error(`不支持的文件类型: ${fileType}`);
  }

  const tableName = getTableName(fileType);
  if (!tableName) {
    throw new Error(`文件类型 ${fileType} 没有对应的数据表`);
  }

  // 创建 batch 记录
  const batchResult = biDb.prepare(`
    INSERT INTO upload_batch (file_type, file_name, file_size, uploaded_by, status, note)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(fileType, fileName, fileSize, uploadedBy, note ?? null);
  const batchId = Number(batchResult.lastInsertRowid);

  log.info({ batchId, fileType, fileName }, 'BI 导入开始');

  try {
    // 解析文件
    const parsed: MapperResult = await parser(filePath);

    const columns = getTableColumns(tableName);
    const placeholders = columns.map(() => '?').join(', ');
    const columnList = columns.join(', ');
    const insertSql = `INSERT INTO ${tableName} (batch_id, ${columnList}) VALUES (?, ${placeholders})`;

    // 预处理：voucher 类型需要特殊处理（student_links）
    let records = parsed.records;
    let voucherLinks: Map<number, { student_id: string | null; student_name: string | null; student_grade: string | null; link_kind: string; position: number }[]> | null = null;

    if (fileType === 'voucher') {
      voucherLinks = new Map();
      records = (records as { student_links?: unknown[]; __row_number: number }[]).map((rec, idx) => {
        if (rec.student_links && Array.isArray(rec.student_links)) {
          voucherLinks!.set(idx, rec.student_links as typeof voucherLinks extends Map<number, infer V> ? V[] : never);
        }
        // 移除 student_links，不入库
        const { student_links, ...dbRecord } = rec as Record<string, unknown>;
        return dbRecord;
      });
    }

    const insertStmt = biDb.prepare(insertSql);
    const errorStmt = biDb.prepare(`
      INSERT INTO import_error (batch_id, row_number, error_code, error_message, raw_data)
      VALUES (?, ?, ?, ?, ?)
    `);

    let successRows = 0;
    let errorRows = parsed.errors.length;

    const tx = biDb.transaction(() => {
      // 写入数据行
      for (let idx = 0; idx < records.length; idx++) {
        const rec = records[idx] as Record<string, unknown>;
        const values = columns.map(col => {
          const val = rec[col];
          return val === undefined ? null : val;
        });
        insertStmt.run(batchId, ...values);
        successRows++;

        // 写入 voucher 学生关联
        if (voucherLinks && voucherLinks.has(idx)) {
          const links = voucherLinks.get(idx)!;
          const linkStmt = biDb.prepare(`
            INSERT INTO voucher_student_link
              (voucher_id, student_id, student_name, student_grade, link_kind, position)
            VALUES
              ((SELECT id FROM raw_voucher WHERE batch_id = ? ORDER BY id LIMIT 1 OFFSET ?), ?, ?, ?, ?, ?)
          `);
          // 注意：需要拿到刚插入的 voucher id
          // 由于批量插入后 id 是连续的，可以用 batch_id + offset 推算
          // 更稳妥的方式是改用 lastInsertRowid，但事务中不便
          // 这里用子查询方案
          for (const link of links) {
            linkStmt.run(
              batchId,
              idx,
              link.student_id,
              link.student_name,
              link.student_grade,
              link.link_kind,
              link.position
            );
          }
        }
      }

      // 写入解析错误
      for (const err of parsed.errors) {
        errorStmt.run(batchId, err.rowNumber, err.errorCode, err.errorMessage, JSON.stringify(err.rawData));
      }

      // 更新 batch 状态
      biDb.prepare(`
        UPDATE upload_batch SET status = 'committed', row_count = ?, error_count = ?
        WHERE id = ?
      `).run(successRows, errorRows, batchId);
    });

    tx();

    log.info({ batchId, successRows, errorRows }, 'BI 导入完成');

    return {
      batchId,
      status: 'committed',
      totalRows: successRows + errorRows,
      successRows,
      errorRows,
      errors: parsed.errors.map(e => ({
        rowNumber: e.rowNumber,
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
      })),
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ batchId, error: errMsg }, 'BI 导入失败');

    // 标记 batch 失败（不在事务中，允许标记）
    biDb.prepare("UPDATE upload_batch SET status = 'failed' WHERE id = ?").run(batchId);

    return {
      batchId,
      status: 'failed',
      totalRows: 0,
      successRows: 0,
      errorRows: 0,
      errors: [{ rowNumber: 0, errorCode: 'PARSE_ERROR', errorMessage: errMsg }],
    };
  }
}

/**
 * 删除一个 batch（整批回滚用）。
 * CASCADE 会自动删除关联的 raw_* 行和 import_error 行。
 */
export function deleteBatch(batchId: number): void {
  const batch = biDb.prepare('SELECT file_type FROM upload_batch WHERE id = ?').get(batchId) as { file_type: string } | undefined;
  if (!batch) {
    throw new Error(`Batch ${batchId} 不存在`);
  }

  const tableName = getTableName(batch.file_type as FileType);
  if (!tableName) {
    throw new Error(`未知文件类型: ${batch.file_type}`);
  }

  const tx = biDb.transaction(() => {
    biDb.prepare(`DELETE FROM ${tableName} WHERE batch_id = ?`).run(batchId);
    biDb.prepare('DELETE FROM import_error WHERE batch_id = ?').run(batchId);
    biDb.prepare('DELETE FROM upload_batch WHERE id = ?').run(batchId);
  });
  tx();

  log.info({ batchId, tableName }, 'BI batch 已删除');
}

/**
 * 获取 batch 列表
 */
export function listBatches(options: { fileType?: string; limit?: number; offset?: number } = {}): unknown[] {
  const { fileType, limit = 50, offset = 0 } = options;
  let sql = 'SELECT * FROM upload_batch';
  const params: unknown[] = [];
  if (fileType) {
    sql += ' WHERE file_type = ?';
    params.push(fileType);
  }
  sql += ' ORDER BY uploaded_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return biDb.prepare(sql).all(...params);
}

/**
 * 获取 batch 详情（含错误行）
 */
export function getBatchDetail(batchId: number): { batch: unknown; errors: unknown[] } {
  const batch = biDb.prepare('SELECT * FROM upload_batch WHERE id = ?').get(batchId);
  if (!batch) {
    throw new Error(`Batch ${batchId} 不存在`);
  }
  const errors = biDb.prepare('SELECT * FROM import_error WHERE batch_id = ? ORDER BY row_number').all(batchId);
  return { batch, errors };
}
