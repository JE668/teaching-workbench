import ExcelJS from 'exceljs';
import { renewalDb, SQL_NOW } from './db.js';
import fs from 'fs';
import { createHash } from 'crypto';
import { log } from '../utils/logger.js';
import {
  buildColorContext,
  parseTeacherStats,
  parseManagerPerf,
  parseFunnel,
  extractReportMeta,
  inspectRenewalWorkbookQuality,
  type GridStatus,
  type RenewalQualityIssue,
} from './parser.js';

/**
 * 续费看板上传服务。
 *
 * 上传一份 xlsx（用户在 Excel 里已做好的续费统计表）→ 事务内解析入库 →
 * 看板页直接查库出图。整批可删，删了就是「重传一遍」。
 */

export interface ReportSummary {
  reportId: number;
  fileName: string;
  fileSize: number;
  statMonth: string | null;
  centerName: string | null;
  rowCount: number;
  errorCount: number;
  status: string;
  uploadedAt: string;
  /** 同内容重复上传时为 true；新增字段不影响旧调用方。 */
  deduplicated?: boolean;
}

/** 把一行教师统计 + 学生网格入库 */
function insertTeacherStats(reportId: number, rows: ReturnType<typeof parseTeacherStats>): {
  teacherRows: number;
  studentRows: number;
  errors: number;
} {
  const insTeacher = renewalDb.prepare(`
    INSERT INTO teacher_stats
      (report_id, tab, teacher_name, teacher_no, subject_group,
       base_count, prepaid_count, prepaid_rate, renewed_count, renew_rate,
       incentive_gap, extra_json, student_count, sort_order, source_row)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insStudent = renewalDb.prepare(`
    INSERT INTO grid_students
      (report_id, tab, teacher_name, subject_group, teacher_stat_id, student_id,
       student_name, status, slot_index, source_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let teacherRows = 0;
  let studentRows = 0;

  rows.forEach((row, idx) => {
    const teacherResult = insTeacher.run(
      reportId,
      row.tab,
      row.teacherName || null,
      row.teacherNo ?? null,
      row.subjectGroup ?? null,
      row.baseCount ?? null,
      row.prepaidCount ?? null,
      row.prepaidRate ?? null,
      row.renewedCount ?? null,
      row.renewRate ?? null,
      row.incentiveGap ?? null,
      JSON.stringify(row.extra ?? {}),
      row.students.length,
      idx,
      row.sourceRow
    );
    const teacherStatId = Number(teacherResult.lastInsertRowid);
    teacherRows++;

    for (const s of row.students) {
      insStudent.run(
        reportId, row.tab, row.teacherName || null, row.subjectGroup ?? null,
        teacherStatId, s.studentId ?? null, s.name, s.status as GridStatus, s.slot, row.sourceRow
      );
      studentRows++;
    }
  });

  return { teacherRows, studentRows, errors: 0 };
}

function insertManagerPerf(reportId: number, rows: ReturnType<typeof parseManagerPerf>): number {
  const ins = renewalDb.prepare(`
    INSERT INTO manager_perf
      (report_id, manager_name,
       renew_1v1, renew_1vN, renew_small, renew_other, renew_total,
       newsign_1v1, newsign_1vN, newsign_small, newsign_other, newsign_total,
       renewed_count, tutored_count, renew_rate, task_amount, cashflow_total,
       completion_rate, actual_students, per_student, avg_order, gap_80, source_row)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  rows.forEach(r => {
    ins.run(
      reportId, r.managerName,
      r.renew.one2one ?? null, r.renew.one2many ?? null, r.renew.small ?? null,
      r.renew.other ?? null, r.renew.total ?? null,
      r.newsign.one2one ?? null, r.newsign.one2many ?? null, r.newsign.small ?? null,
      r.newsign.other ?? null, r.newsign.total ?? null,
      r.renewedCount ?? null, r.tutoredCount ?? null, r.renewRate ?? null,
      r.taskAmount ?? null, r.cashflowTotal ?? null, r.completionRate ?? null,
      r.actualStudents ?? null, r.perStudent ?? null, r.avgOrder ?? null,
      r.gap80 ?? null, r.sourceRow
    );
  });
  return rows.length;
}

function insertFunnel(reportId: number, rows: ReturnType<typeof parseFunnel>): number {
  const ins = renewalDb.prepare(`
    INSERT INTO student_funnel
      (report_id, manager_name, student_id, student_name, grade, first_enroll_date,
       enroll_days, coef, type, course_product, class_last1, class_last2, renewed, source_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  rows.forEach(r => {
    ins.run(
      reportId, r.managerName ?? null, r.studentId ?? null, r.studentName,
      r.grade ?? null, r.firstEnrollDate ?? null, r.enrollDays ?? null,
      r.coef ?? null, r.type ?? null, r.courseProduct ?? null,
      r.classLast1 ?? null, r.classLast2 ?? null, r.renewed ?? null, r.sourceRow
    );
  });
  return rows.length;
}

/**
 * 解析并入库一份续费统计表。整个流程在一个事务里：
 * 任何一步失败就把 renewal_report 状态置 failed 并回滚明细。
 */
/**
 * 解析并入库一份续费统计表。
 *
 * 两步走：
 *   1) 先在事务**外**做异步的 xlsx 解析（exceljs load 是 async）。
 *   2) 再在同步事务里批量插入。better-sqlite3 的事务回调必须是同步函数——
 *      若把 async 回调塞进去，事务会在解析完成前就 commit，插进去的明细是空壳。
 */
function toReportSummary(row: any, deduplicated = false): ReportSummary {
  return {
    reportId: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    statMonth: row.stat_month,
    centerName: row.center_name,
    rowCount: row.row_count ?? 0,
    errorCount: row.error_count ?? 0,
    status: row.status,
    uploadedAt: row.uploaded_at,
    deduplicated,
  };
}

function findReportByHash(fileHash: string, userId: number): ReportSummary | null {
  const row = renewalDb.prepare(`
    SELECT * FROM renewal_report
    WHERE file_hash = ? AND uploaded_by = ?
      AND status IN ('committed', 'committed_with_warnings', 'rejected', 'failed')
    ORDER BY id DESC LIMIT 1
  `).get(fileHash, userId);
  return row ? toReportSummary(row, true) : null;
}

function isFileHashConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('renewal_report.file_hash');
}

// 同一 Node 进程内的并发上传共享首个解析 Promise；数据库唯一索引再兜底多实例竞争。
const activeImports = new Map<string, Promise<ReportSummary>>();

async function runRenewalImport(
  buffer: Buffer,
  fileName: string,
  fileSize: number,
  uploadedBy: number,
  fileHash: string,
): Promise<ReportSummary> {
  const insReport = renewalDb.prepare(`
    INSERT INTO renewal_report (file_name, file_size, file_hash, uploaded_by, uploaded_at, status)
    VALUES (?, ?, ?, ?, ${SQL_NOW}, 'processing')
  `);
  const insError = renewalDb.prepare(`
    INSERT INTO renewal_import_error
      (report_id, sheet_name, row_number, column_number, field_name,
       error_type, severity, error_message, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertIssue = (reportId: number, issue: RenewalQualityIssue): void => {
    insError.run(
      reportId, issue.sheetName, issue.rowNumber, issue.columnNumber, issue.fieldName,
      issue.errorType, issue.severity, issue.errorMessage,
      issue.details ? JSON.stringify(issue.details) : null,
    );
  };

  let reportId = 0;
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs 与 Node 的 Buffer 类型声明不同，运行时使用同一份 Buffer 字节。
    await workbook.xlsx.load(
      buffer as unknown as Parameters<ExcelJS.Xlsx['load']>[0]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, '续费 xlsx 工作簿解析失败');
    const publicMessage = 'xlsx 解析失败：文件不是有效的工作簿或内容已损坏';
    try {
      const recordFailure = renewalDb.transaction(() => {
        const info = insReport.run(fileName, fileSize, fileHash, uploadedBy);
        reportId = Number(info.lastInsertRowid);
        insertIssue(reportId, {
          errorType: 'xlsx_parse_error', severity: 'error', sheetName: null,
          rowNumber: null, columnNumber: null, fieldName: null,
          errorMessage: publicMessage,
        });
        renewalDb.prepare(`
          UPDATE renewal_report SET status = 'failed', error_count = 1, note = ? WHERE id = ?
        `).run(publicMessage, reportId);
      });
      recordFailure();
    } catch (recordErr) {
      if (isFileHashConflict(recordErr)) {
        const duplicate = findReportByHash(fileHash, uploadedBy);
        if (duplicate) return duplicate;
      }
      throw recordErr;
    }
    throw new Error(publicMessage);
  }

  const meta = extractReportMeta(workbook);
  const colorCtx = buildColorContext(workbook);
  const parsedTeachers = parseTeacherStats(workbook, colorCtx);
  const parsedPerf = parseManagerPerf(workbook);
  const parsedFunnel = parseFunnel(workbook);
  const issues = inspectRenewalWorkbookQuality(
    workbook, parsedTeachers, parsedPerf, parsedFunnel,
  );
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  // formula_cache_missing 是预期行为（原表空值按空值导入），不应阻塞 committed 状态
  const hasBlockingWarnings = issues.some(
    (issue) => issue.severity === 'warning' && issue.errorType !== 'formula_cache_missing',
  );
  const status = hasErrors
    ? 'rejected'
    : hasBlockingWarnings ? 'committed_with_warnings' : 'committed';

  const run = renewalDb.transaction(() => {
    const info = insReport.run(fileName, fileSize, fileHash, uploadedBy);
    reportId = Number(info.lastInsertRowid);
    renewalDb.prepare('UPDATE renewal_report SET stat_month = ?, center_name = ? WHERE id = ?')
      .run(meta.statMonth, meta.centerName, reportId);

    let rowCount = 0;
    if (!hasErrors) {
      const teacherRows = insertTeacherStats(reportId, parsedTeachers);
      const perfRows = insertManagerPerf(reportId, parsedPerf);
      const funnelRows = insertFunnel(reportId, parsedFunnel);
      rowCount = teacherRows.teacherRows + teacherRows.studentRows + perfRows + funnelRows;
      log.info({
        reportId, rowCount, teacherRows: teacherRows.teacherRows, perfRows, funnelRows, meta, status,
      }, '续费统计表已导入');
    }
    for (const issue of issues) insertIssue(reportId, issue);
    renewalDb.prepare(`
      UPDATE renewal_report SET row_count = ?, error_count = ?, status = ? WHERE id = ?
    `).run(rowCount, issues.length, status, reportId);
  });
  try {
    run();
  } catch (err) {
    if (isFileHashConflict(err)) {
      const duplicate = findReportByHash(fileHash, uploadedBy);
      if (duplicate) return duplicate;
    }
    throw err;
  }

  const row = renewalDb.prepare('SELECT * FROM renewal_report WHERE id = ?').get(reportId);
  return toReportSummary(row);
}

export async function importRenewalFile(
  filePath: string,
  fileName: string,
  fileSize: number,
  uploadedBy: number
): Promise<ReportSummary> {
  const buffer = fs.readFileSync(filePath);
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  const importKey = `${uploadedBy}:${fileHash}`;
  const active = activeImports.get(importKey);
  if (active) return { ...await active, deduplicated: true };
  const existing = findReportByHash(fileHash, uploadedBy);
  if (existing) return existing;

  const task = runRenewalImport(buffer, fileName, fileSize, uploadedBy, fileHash);
  activeImports.set(importKey, task);
  try {
    return await task;
  } finally {
    if (activeImports.get(importKey) === task) activeImports.delete(importKey);
  }
}
/** 所有续费读取都先经过所有者校验；历史未绑定所有者的数据默认隐藏。 */
export function ownsReport(reportId: number, userId: number): boolean {
  return renewalDb.prepare('SELECT 1 FROM renewal_report WHERE id = ? AND uploaded_by = ?').get(reportId, userId) !== undefined;
}

/** 取当前用户最新一份已提交的报表 id；没有则 null */
export function latestReportId(userId: number): number | null {
  const row = renewalDb.prepare(`
    SELECT id FROM renewal_report
    WHERE uploaded_by = ? AND status IN ('committed', 'committed_with_warnings')
    ORDER BY uploaded_at DESC, id DESC LIMIT 1
  `).get(userId) as { id: number } | undefined;
  return row?.id ?? null;
}

/** 列出当前用户的报表批次（最新在前） */
export function listReports(userId: number): ReportSummary[] {
  const rows = renewalDb.prepare(`
    SELECT id, file_name, file_size, stat_month, center_name, row_count,
           error_count, status, uploaded_at
    FROM renewal_report WHERE uploaded_by = ? ORDER BY uploaded_at DESC, id DESC
  `).all(userId) as any[];
  return rows.map(r => ({
    reportId: r.id,
    fileName: r.file_name,
    fileSize: r.file_size,
    statMonth: r.stat_month,
    centerName: r.center_name,
    rowCount: r.row_count,
    errorCount: r.error_count,
    status: r.status,
    uploadedAt: r.uploaded_at,
  }));
}

/** 整批删除（明细随 FK CASCADE 一起删） */
export function deleteReport(reportId: number, userId: number): boolean {
  const info = renewalDb.prepare('DELETE FROM renewal_report WHERE id = ? AND uploaded_by = ?').run(reportId, userId);
  return info.changes > 0;
}
