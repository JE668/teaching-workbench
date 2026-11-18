import ExcelJS from 'exceljs';
import { renewalDb, SQL_NOW } from './db.js';
import fs from 'fs';
import { log } from '../utils/logger.js';
import {
  buildColorContext,
  parseTeacherStats,
  parseManagerPerf,
  parseFunnel,
  extractReportMeta,
  type GridStatus,
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
      (report_id, tab, teacher_name, subject_group, student_name, status, slot_index, source_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let teacherRows = 0;
  let studentRows = 0;

  rows.forEach((row, idx) => {
    insTeacher.run(
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
    teacherRows++;

    for (const s of row.students) {
      insStudent.run(
        reportId, row.tab, row.teacherName || null, row.subjectGroup ?? null,
        s.name, s.status as GridStatus, s.slot, row.sourceRow
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
export async function importRenewalFile(
  filePath: string,
  fileName: string,
  fileSize: number,
  uploadedBy: number | null
): Promise<ReportSummary> {
  const insReport = renewalDb.prepare(`
    INSERT INTO renewal_report (file_name, file_size, uploaded_by, uploaded_at, status)
    VALUES (?, ?, ?, ${SQL_NOW}, 'processing')
  `);
  const insError = renewalDb.prepare(`
    INSERT INTO renewal_import_error (report_id, sheet_name, row_number, error_message)
    VALUES (?, ?, ?, ?)
  `);

  let reportId = 0;

  // ---- 事务外：异步解析 ----
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs 4.4.0 在自己的 index.d.ts:1 声明了 `interface Buffer extends ArrayBuffer`，
    // 遮蔽了 node 全局 Buffer，因此不能直接 as Buffer。这里照抄 catalogImport.ts 的写法，
    // 用 Parameters<> 取 exceljs 自己声明的那个类型，避开两套 Buffer 的定义冲突。
    await workbook.xlsx.load(
      fs.readFileSync(filePath) as unknown as Parameters<ExcelJS.Xlsx['load']>[0]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const info = insReport.run(fileName, fileSize, uploadedBy);
    reportId = Number(info.lastInsertRowid);
    insError.run(reportId, null, null, 'xlsx 解析失败：' + msg.slice(0, 400));
    renewalDb.prepare("UPDATE renewal_report SET status = 'failed', note = ? WHERE id = ?")
      .run(msg.slice(0, 500), reportId);
    throw new Error('xlsx 解析失败：' + msg);
  }

  const meta = extractReportMeta(workbook);
  const colorCtx = buildColorContext(workbook);
  const parsedTeachers = parseTeacherStats(workbook, colorCtx);
  const parsedPerf = parseManagerPerf(workbook);
  const parsedFunnel = parseFunnel(workbook);

  // ---- 事务内：同步批量插入 ----
  const run = renewalDb.transaction(() => {
    const info = insReport.run(fileName, fileSize, uploadedBy);
    reportId = Number(info.lastInsertRowid);
    renewalDb.prepare('UPDATE renewal_report SET stat_month = ?, center_name = ? WHERE id = ?')
      .run(meta.statMonth, meta.centerName, reportId);
    const teacherRows = insertTeacherStats(reportId, parsedTeachers);
    const perfRows = insertManagerPerf(reportId, parsedPerf);
    const funnelRows = insertFunnel(reportId, parsedFunnel);
    const rowCount = teacherRows.teacherRows + teacherRows.studentRows + perfRows + funnelRows;
    renewalDb.prepare(`
      UPDATE renewal_report SET row_count = ?, error_count = ?, status = 'committed' WHERE id = ?
    `).run(rowCount, 0, reportId);
    log.info({ reportId, rowCount, teacherRows: teacherRows.teacherRows, perfRows, funnelRows, meta }, '续费统计表已导入');
  });
  run();

  const row = renewalDb.prepare('SELECT * FROM renewal_report WHERE id = ?').get(reportId) as any;
  return {
    reportId: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    statMonth: row.stat_month,
    centerName: row.center_name,
    rowCount: row.row_count,
    errorCount: row.error_count,
    status: row.status,
    uploadedAt: row.uploaded_at,
  };
}
/** 取最新一份已提交的报表 id；没有则 null */
export function latestReportId(): number | null {
  const row = renewalDb.prepare(`
    SELECT id FROM renewal_report
    WHERE status = 'committed'
    ORDER BY uploaded_at DESC, id DESC LIMIT 1
  `).get() as { id: number } | undefined;
  return row?.id ?? null;
}

/** 列出全部报表批次（最新在前） */
export function listReports(): ReportSummary[] {
  const rows = renewalDb.prepare(`
    SELECT id, file_name, file_size, stat_month, center_name, row_count,
           error_count, status, uploaded_at
    FROM renewal_report ORDER BY uploaded_at DESC, id DESC
  `).all() as any[];
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
export function deleteReport(reportId: number): boolean {
  const info = renewalDb.prepare('DELETE FROM renewal_report WHERE id = ?').run(reportId);
  return info.changes > 0;
}
