import { renewalDb } from './db.js';
import type { ManagerProductTargets } from './managerTargetService.js';
import { normalizeStatus, countByStatus, StandardStatus } from '@shared/statusDictionary.js';

/**
 * 续费看板指标聚合。
 *
 * 原则：**不重算业务指标**。用户在 Excel 里已经算好的数（预存率/续科率/激励差额/续生率…）
 * 直接按 teacher_stats / manager_perf 的列读出来展示。
 * 这里只做「读 + 分组 + 排序」，不做任何业务口径换算。
 * 唯二例外：
 *   - 科组对比：把教师按科组归并（这是展示需求，不是新业务口径）
 *   - 漏斗/风险清单：直接数 grid_students 的 status 分布（状态是解析时复刻条件格式算好的）
 */

/** 教师统计行（4 个 tab 共用形状，extra 装 tab 特有拆分列） */
export interface TeacherStatDto {
  tab: string;
  teacherName: string | null;
  teacherNo: string | null;
  subjectGroup: string | null;
  baseCount: number | null;
  prepaidCount: number | null;
  prepaidRate: number | null;
  renewedCount: number | null;
  renewRate: number | null;
  incentiveGap: number | null;
  extra: Record<string, number | null>;
  studentCount: number;
}

/** 学生网格行；身份字段为可选新增字段，原有 name/status/slot 保持不变。 */
export interface AnalyticsStudentDto {
  name: string;
  status: string;
  studentId?: string | null;
  identityKey?: string;
  ambiguous?: boolean;
}

/** 教师统计明细（含每个学生及其颜色状态） */
export interface TeacherStatFull extends TeacherStatDto {
  /** 稳定行身份：同名教师的学生明细与展开状态不能共用姓名键。 */
  teacherStatId: number;
  students: (AnalyticsStudentDto & { slot: number })[];
}

/** 科组汇总（把教师按科组归并，用于科组对比柱状图） */
export interface GroupSummary {
  subjectGroup: string;
  teacherCount: number;
  baseCount: number;
  prepaidCount: number;
  renewedCount: number;
  prepaidRate: number | null;
  renewRate: number | null;
  incentiveGap: number;
}

/** 学管业绩行 */
export interface ManagerPerfDto {
  managerName: string;
  renew: { one2one: number|null; one2many: number|null; small: number|null; other: number|null; total: number|null };
  newsign: { one2one: number|null; one2many: number|null; small: number|null; other: number|null; total: number|null };
  renewedCount: number | null;
  tutoredCount: number | null;
  renewRate: number | null;
  /** 有效总任务：人工覆盖优先，否则沿用 Excel。 */
  taskAmount: number | null;
  /** Excel 导入的总任务原值，不随人工覆盖变化。 */
  importedTaskAmount: number | null;
  /** 与早期任务编辑契约兼容的同义字段。 */
  importedTargetAmount: number | null;
  productTargets: ManagerProductTargets;
  /** 四产品分别为续费+新签；total 始终取 Excel 的真实现金流合计。 */
  productCashflow: ManagerProductTargets & { total: number | null };
  cashflowTotal: number | null;
  completionRate: number | null;
  actualStudents: number | null;
  perStudent: number | null;
  avgOrder: number | null;
  gap80: number | null;
}

/** 续生漏斗（按学管） */
export interface FunnelDto {
  managerName: string;
  students: number;
  classedLast1: number;
  classedLast2: number;
  renewed: number;
  renewRate: number | null;
}

/** 风险学生（未续费且近期无课消） */
export interface RiskStudentPage {
  rows: RiskStudentDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

export interface RiskStudentDto {
  managerName: string | null;
  studentId: string | null;
  /** 跟进记录稳定键：优先学生编号，否则使用当前批次的源行号。 */
  studentKey: string;
  sourceRow: number;
  studentName: string;
  grade: string | null;
  enrollDays: number | null;
  coef: number | null;
  type: string | null;
  courseProduct: string | null;
  classLast1: number | null;
  classLast2: number | null;
}

/** 教师 × 学管 矩阵单元格 */
export interface MentorMatrixCell {
  teacherName: string;
  managerName: string;
  studentCount: number;
  prepaidCount: number;
  renewedCount: number;
  prepaidRate: number | null;
  renewRate: number | null;
  students: AnalyticsStudentDto[];
}

/** 教师 × 学管 矩阵 */
export interface MentorMatrix {
  teachers: string[];
  managers: string[];
  cells: MentorMatrixCell[];
  totalPrepaid: number;
  totalRenewed: number;
  totalStudents: number;
}

/** 教师 × 年级 矩阵单元格 */
export interface TeacherGradeMatrixCell {
  teacherName: string;
  grade: string;
  studentCount: number;
  prepaidCount: number;
  renewedCount: number;
  prepaidRate: number | null;
  renewRate: number | null;
  students: AnalyticsStudentDto[];
}

/** 教师 × 年级 矩阵 */
export interface TeacherGradeMatrix {
  teachers: string[];
  grades: string[];
  cells: TeacherGradeMatrixCell[];
  totalPrepaid: number;
  totalRenewed: number;
  totalStudents: number;
}

/** 科组 × 年级 矩阵单元格 */
export interface GroupGradeMatrixCell {
  subjectGroup: string;
  grade: string;
  studentCount: number;
  prepaidCount: number;
  renewedCount: number;
  prepaidRate: number | null;
  renewRate: number | null;
  students: AnalyticsStudentDto[];
}

/** 科组 × 年级 矩阵 */
export interface GroupGradeMatrix {
  subjectGroups: string[];
  grades: string[];
  cells: GroupGradeMatrixCell[];
  totalPrepaid: number;
  totalRenewed: number;
  totalStudents: number;
}

/** 整体续费概览（预交/到期/续费/流失率） */
export interface RateOverview {
  total: number;
  prepaidCount: number;
  expiredCount: number;
  renewedCount: number;
  lostCount: number;
  prepaidRate: number;
  expiredRate: number;
  renewedRate: number;
  lostRate: number;
  overall: {
    baseCount: number;
    prepaidCount: number;
    renewedCount: number;
    prepaidRate: number;
    renewRate: number;
  };
  byManager: Array<{
    managerName: string;
    baseCount: number;
    prepaidCount: number;
    renewedCount: number;
    prepaidRate: number;
    renewRate: number;
  }>;
  byGroup: Array<{
    subjectGroup: string;
    baseCount: number;
    prepaidCount: number;
    renewedCount: number;
    prepaidRate: number;
    renewRate: number;
  }>;
}

/** 多期对比：单期指标快照 */
export interface PeriodSnapshot {
  reportId: number;
  statMonth: string | null;
  centerName: string | null;
  uploadedAt: string;
  totalStudents: number;
  prepaidCount: number;
  expiredCount: number;
  renewedCount: number;
  lostCount: number;
  prepaidRate: number;
  expiredRate: number;
  renewedRate: number;
  lostRate: number;
  overallPrepaidRate: number;
  overallRenewRate: number;
  byManager: Array<{
    managerName: string;
    baseCount: number;
    prepaidCount: number;
    renewedCount: number;
    prepaidRate: number;
    renewRate: number;
  }>;
  byGroup: Array<{
    subjectGroup: string;
    baseCount: number;
    prepaidCount: number;
    renewedCount: number;
    prepaidRate: number;
    renewRate: number;
  }>;
}

/** 多期对比响应 */
export interface MultiPeriodComparison {
  periods: PeriodSnapshot[];
  trends: {
    totalStudents: number[];
    prepaidRate: number[];
    renewedRate: number[];
    lostRate: number[];
  };
}

/** 多期对比查询参数 */
export interface MultiPeriodQuery {
  userId: number;
  centerName?: string;
  limit?: number;
  months?: string[];  // 指定月份，如 ['2026-09', '2026-10', '2026-11']
}

const TABS = new Set(['incentive', 'stage', 'mentor', 'hours']);

function assertTab(tab: string): string {
  if (!TABS.has(tab)) throw new Error('未知的统计表 tab: ' + tab);
  return tab;
}

/**
 * Legacy 兼容：为没有 teacher_stat_id 的旧报表按 source_row 关联学生。
 * 仅用于早期上传的数据（v2026.10 之前），新数据流以 teacher_stat_id 为准。
 * 后续可在迁移完成后移除此函数。
 */
function attachLegacyStudents(
  teacherRows: any[],
  studentRows: any[]
): Map<number, TeacherStatFull['students']> {
  const legacyStudentsBySourceRow = new Map<number, TeacherStatFull['students']>();
  for (const row of studentRows) {
    if (row.teacher_stat_id !== null && row.teacher_stat_id !== undefined) continue;
    const key = row.source_row as number | null;
    if (key === null || key === undefined) continue;
    const student = {
      name: row.student_name,
      status: row.status,
      slot: row.slot_index,
      studentId: row.student_id ?? null,
      identityKey: `grid:${row.id}`,
    };
    const bucket = legacyStudentsBySourceRow.get(key) ?? [];
    bucket.push(student);
    legacyStudentsBySourceRow.set(key, bucket);
  }
  return legacyStudentsBySourceRow;
}

/** 教师统计明细（含学生网格），tab 必填 */
export function getTeacherStats(reportId: number, tab: string): TeacherStatFull[] {
  assertTab(tab);
  const rows = renewalDb.prepare(`
    SELECT ts.id, ts.source_row, ts.teacher_name, ts.teacher_no, ts.subject_group,
           ts.base_count, ts.prepaid_count, ts.prepaid_rate,
           ts.renewed_count, ts.renew_rate, ts.incentive_gap,
           ts.extra_json, ts.student_count
    FROM teacher_stats ts
    WHERE ts.report_id = ? AND ts.tab = ?
    ORDER BY ts.sort_order
  `).all(reportId, tab) as any[];

  // 一次读取整 tab，避免教师逐行查询；姓名只用于展示，不参与关联。
  const studentRows = renewalDb.prepare(`
    SELECT id, teacher_stat_id, source_row, student_id, student_name, status, slot_index
    FROM grid_students
    WHERE report_id = ? AND tab = ?
    ORDER BY slot_index, id
  `).all(reportId, tab) as any[];

  const studentsByStatId = new Map<number, TeacherStatFull['students']>();
  const legacyStudentsBySourceRow = attachLegacyStudents(rows, studentRows);

  for (const row of studentRows) {
    if (row.teacher_stat_id === null || row.teacher_stat_id === undefined) continue;
    const student = {
      name: row.student_name,
      status: row.status,
      slot: row.slot_index,
      studentId: row.student_id ?? null,
      identityKey: `grid:${row.id}`,
    };
    const key = row.teacher_stat_id as number;
    const bucket = studentsByStatId.get(key) ?? [];
    bucket.push(student);
    studentsByStatId.set(key, bucket);
  }

  return rows.map(r => {
    // 新数据只认 teacher_stat_id；legacy 空值才回退到同一 report/tab 下的 source_row。
    const students = studentsByStatId.get(r.id)
      ?? (r.source_row !== null && r.source_row !== undefined
        ? legacyStudentsBySourceRow.get(r.source_row)
        : undefined)
      ?? [];
    return {
      tab,
      teacherStatId: r.id,
      teacherName: r.teacher_name,
      teacherNo: r.teacher_no,
      subjectGroup: r.subject_group,
      baseCount: r.base_count,
      prepaidCount: r.prepaid_count,
      prepaidRate: r.prepaid_rate,
      renewedCount: r.renewed_count,
      renewRate: r.renew_rate,
      incentiveGap: r.incentive_gap,
      extra: r.extra_json ? JSON.parse(r.extra_json) : {},
      studentCount: r.student_count ?? 0,
      students,
    };
  });
}

/** 科组对比（把教师按科组归并） */
export function getGroupComparison(reportId: number, tab: string): GroupSummary[] {
  assertTab(tab);
  const rows = renewalDb.prepare(`
    SELECT subject_group,
           COUNT(*) AS teacher_count,
           COALESCE(SUM(base_count), 0) AS base_count,
           COALESCE(SUM(prepaid_count), 0) AS prepaid_count,
           COALESCE(SUM(renewed_count), 0) AS renewed_count,
           COALESCE(SUM(prepaid_count), 0) * 100.0 / NULLIF(COALESCE(SUM(base_count), 0), 0) AS prepaid_rate,
           COALESCE(SUM(renewed_count), 0) * 100.0 / NULLIF(COALESCE(SUM(base_count), 0), 0) AS renew_rate,
           COALESCE(SUM(incentive_gap), 0) AS incentive_gap
    FROM teacher_stats
    WHERE report_id = ? AND tab = ?
    GROUP BY subject_group
    ORDER BY base_count DESC
  `).all(reportId, tab) as any[];

  return rows.map(r => ({
    subjectGroup: r.subject_group ?? '未知科组',
    teacherCount: r.teacher_count,
    baseCount: r.base_count,
    prepaidCount: r.prepaid_count,
    renewedCount: r.renewed_count,
    prepaidRate: r.prepaid_rate ?? null,
    renewRate: r.renew_rate ?? null,
    incentiveGap: r.incentive_gap,
  }));
}

/** 学管业绩（含人工覆盖的任务合并视图） */
export function getManagerPerf(reportId: number, userId: number): ManagerPerfDto[] {
  const rows = renewalDb.prepare(`
    SELECT mp.*,
           COALESCE(rmt.target_amount, mp.task_amount) AS effective_task_amount,
           rmt.one2one_target, rmt.one2many_target, rmt.small_target, rmt.other_target,
           rmt.created_at AS target_created_at, rmt.updated_at AS target_updated_at
    FROM manager_perf mp
    LEFT JOIN renewal_manager_target rmt
      ON rmt.report_id = mp.report_id AND rmt.user_id = ? AND rmt.manager_name = mp.manager_name
    WHERE mp.report_id = ?
    ORDER BY COALESCE(mp.source_row, 2147483647), mp.id
  `).all(userId, reportId) as any[];

  return rows.map(r => {
    const importedTaskAmount = r.task_amount ?? null;
    const effectiveTaskAmount = r.effective_task_amount ?? r.task_amount ?? null;
    const importedTargetAmount = importedTaskAmount; // 兼容旧字段
    const productTargets: ManagerProductTargets = {
      one2one: r.one2one_target ?? null,
      one2many: r.one2many_target ?? null,
      small: r.small_target ?? null,
      other: r.other_target ?? null,
    };
    const hasProductData = (r.renew_1v1 ?? 0) + (r.renew_1vN ?? 0) + (r.renew_small ?? 0) + (r.renew_other ?? 0) + (r.newsign_1v1 ?? 0) + (r.newsign_1vN ?? 0) + (r.newsign_small ?? 0) + (r.newsign_other ?? 0) > 0;
    const productCashflow = {
      one2one: hasProductData ? (r.renew_1v1 ?? 0) + (r.newsign_1v1 ?? 0) : null,
      one2many: hasProductData ? (r.renew_1vN ?? 0) + (r.newsign_1vN ?? 0) : null,
      small: hasProductData ? (r.renew_small ?? 0) + (r.newsign_small ?? 0) : null,
      other: hasProductData ? (r.renew_other ?? 0) + (r.newsign_other ?? 0) : null,
      total: r.cashflow_total ?? 0,
    };
    return {
      managerName: r.manager_name,
      renew: { one2one: r.renew_1v1, one2many: r.renew_1vN, small: r.renew_small, other: r.renew_other, total: r.renew_total },
      newsign: { one2one: r.newsign_1v1, one2many: r.newsign_1vN, small: r.newsign_small, other: r.newsign_other, total: r.newsign_total },
      renewedCount: r.renewed_count,
      tutoredCount: r.tutored_count,
      renewRate: r.renew_rate,
      taskAmount: effectiveTaskAmount,
      importedTaskAmount,
      importedTargetAmount,
      productTargets,
      productCashflow,
      cashflowTotal: r.cashflow_total,
      completionRate: (() => {
        const taskAmt = r.effective_task_amount ?? r.task_amount ?? null;
        const cashAmt = r.cashflow_total ?? 0;
        // If effective task amount is 0 (explicitly cleared), return null
        if (taskAmt === 0) return null;
        return (taskAmt && taskAmt > 0 && cashAmt > 0) ? Math.round((cashAmt / taskAmt) * 10000) / 100 : (r.completion_rate ?? null);
      })(),
      actualStudents: r.actual_students,
      perStudent: r.per_student,
      avgOrder: r.avg_order,
      gap80: (() => {
        const taskAmt = r.effective_task_amount ?? r.task_amount ?? null;
        const cashAmt = r.cashflow_total ?? 0;
        return (taskAmt && taskAmt > 0) ? Math.round((taskAmt * 0.8 - cashAmt) * 100) / 100 : (r.gap_80 ?? null);
      })(),
    };
  });
}

/** 续生漏斗 */
export function getFunnel(reportId: number): FunnelDto[] {
  const rows = renewalDb.prepare(`
    SELECT manager_name, COUNT(*) AS students,
           SUM(COALESCE(class_last1, 0)) AS classed_last1,
           SUM(COALESCE(class_last2, 0)) AS classed_last2,
           SUM(COALESCE(renewed, 0)) AS renewed
    FROM student_funnel
    WHERE report_id = ?
    GROUP BY manager_name
    ORDER BY COALESCE(source_row, 2147483647), id
  `).all(reportId) as any[];

  return rows.map(r => ({
    managerName: r.manager_name,
    students: r.students,
    classedLast1: r.classed_last1,
    classedLast2: r.classed_last2,
    renewed: r.renewed,
    renewRate: r.students > 0 ? (r.renewed / r.students) * 100 : null,
  }));
}

/** 风险学生分页（未续费且近期无课消） */
export function getRiskStudentsPage(reportId: number, page: number, pageSize: number): RiskStudentPage {
  const total = renewalDb.prepare('SELECT COUNT(*) AS cnt FROM student_funnel WHERE report_id = ? AND renewed = 0 AND class_last1 = 0').get(reportId) as { cnt: number };
  const totalCount = total.cnt;
  const totalPages = Math.ceil(totalCount / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = renewalDb.prepare(`
    SELECT manager_name, student_id, student_name, source_row,
           grade, enroll_days, coef, type, course_product,
           class_last1, class_last2
    FROM student_funnel
    WHERE report_id = ? AND renewed = 0 AND class_last1 = 0
    ORDER BY COALESCE(source_row, 2147483647), id
    LIMIT ? OFFSET ?
  `).all(reportId, pageSize, offset) as any[];

  return {
    rows: rows.map(r => ({
      managerName: r.manager_name,
      studentId: r.student_id,
      studentKey: r.student_id ?? `source_row:${r.source_row}`,
      sourceRow: r.source_row,
      studentName: r.student_name,
      grade: r.grade,
      enrollDays: r.enroll_days,
      coef: r.coef,
      type: r.type,
      courseProduct: r.course_product,
      classLast1: r.class_last1,
      classLast2: r.class_last2,
    })),
    total: totalCount,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  };
}
/** 获取所有风险学生（不分页，用于简单场景） */
export function getRiskStudents(reportId: number): RiskStudentPage['rows'] {
  const page = getRiskStudentsPage(reportId, 1, 10000);
  return page.rows;
}



/** 加载 mentor 网格学生（含学管、年级、科组）用于矩阵与概览 */
interface MentorStudent {
  teacherName: string;
  managerName: string;
  subjectGroup: string;
  grade: string | null;
  status: string;
  studentId: string | null;
  studentName: string | null;
  sourceRow: number;
  slotIndex: number;
  ambiguous?: boolean;
}
function loadMentorStudents(reportId: number): MentorStudent[] { // First, get all grid students for mentor tab
  const gridRows = renewalDb.prepare(`
    SELECT gs.teacher_name, gs.student_name, gs.status, gs.student_id, gs.source_row,
           gs.teacher_stat_id, gs.slot_index
    FROM grid_students gs
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
    ORDER BY gs.slot_index, gs.id
  `).all(reportId) as any[];

  // Get all funnel students for this report
  const funnelRows = renewalDb.prepare(`
    SELECT student_id, student_name, manager_name, grade, source_row
    FROM student_funnel
    WHERE report_id = ?
  `).all(reportId) as any[];

  // Get teacher_stats for subject_group
  const teacherStats = new Map<number, { subject_group: string }>();
  for (const ts of renewalDb.prepare('SELECT id, subject_group FROM teacher_stats WHERE report_id = ?').all(reportId) as any[]) {
    teacherStats.set(ts.id, { subject_group: ts.subject_group });
  }

  // Build lookup maps for funnel students - deduplicate by (student_id, manager_name, grade)
  // This handles legacy Excel import duplicates
  const funnelByStudentId = new Map<string, any[]>();
  const funnelByName = new Map<string, any[]>();
  const funnelNamesWithStudentId = new Set<string>();
  
  // Track unique combinations to deduplicate
  const seenFunnelKeys = new Set<string>();
  for (const f of funnelRows) {
    const key = `${f.student_id || ''}|${f.manager_name}|${f.grade}`;
    if (seenFunnelKeys.has(key)) continue;
    seenFunnelKeys.add(key);
    
    if (f.student_id) {
      const arr = funnelByStudentId.get(f.student_id) || [];
      arr.push(f);
      funnelByStudentId.set(f.student_id, arr);
      funnelNamesWithStudentId.add(f.student_name);
    }
    const nameArr = funnelByName.get(f.student_name) || [];
    nameArr.push(f);
    funnelByName.set(f.student_name, nameArr);
  }

  // Count grid students by (name, source_row) for ambiguity detection
  // Same name + same source_row = same student entry (legacy duplicate)
  // Same name + different source_row = different students
  const gridNameSourceCount = new Map<string, number>();
  for (const gs of gridRows) {
    const key = `${gs.student_name}|${gs.source_row}`;
    gridNameSourceCount.set(key, (gridNameSourceCount.get(key) || 0) + 1);
  }

  // Also count by name only for fallback matching
  const gridNameCount = new Map<string, number>();
  for (const gs of gridRows) {
    gridNameCount.set(gs.student_name, (gridNameCount.get(gs.student_name) || 0) + 1);
  }

  // Match grid students to funnel students
  return gridRows.map(gs => {
    let managerName = '未分配学管';
    let grade: string | null = null;
    let funnelSourceRow: number | null = null;
    let ambiguous = false;
    let matchedStudentId: string | null = gs.student_id;

    // Try exact student_id match first
    if (gs.student_id) {
      const matches = funnelByStudentId.get(gs.student_id);
      if (matches && matches.length > 0) {
        // After deduplication, if still multiple matches with different managers/grades -> ambiguous
        if (matches.length > 1) {
          ambiguous = true;
          managerName = '未分配学管';
        } else {
          // Single match - check if student_name also matches
          const match = matches[0];
          if (match.student_name !== gs.student_name) {
            // student_id matches but name doesn't - ambiguous
            ambiguous = true;
            managerName = '未分配学管';
          } else {
            managerName = match.manager_name && match.manager_name.trim() ? match.manager_name : '未分配学管';
            grade = match.grade && match.grade.trim() ? match.grade : '未分配年级';
            funnelSourceRow = match.source_row;
          }
        }
      } else {
        // Grid has student_id but no match in funnel by ID
        // Check if funnel has this name with null student_id (legacy data)
        // If so, and name is unique, we can match by name
        const nameMatches = funnelByName.get(gs.student_name);
        const funnelHasStudentIdForName = funnelNamesWithStudentId.has(gs.student_name);
        
        if (nameMatches && nameMatches.length > 0 && !funnelHasStudentIdForName) {
          // Funnel has this name but no student_id for it - can try name match
          if (nameMatches.length > 1 || (gridNameCount.get(gs.student_name) || 0) > 1) {
            ambiguous = true;
            managerName = '未分配学管';
          } else {
            const match = nameMatches[0];
            managerName = match.manager_name && match.manager_name.trim() ? match.manager_name : '未分配学管';
            grade = match.grade && match.grade.trim() ? match.grade : '未分配年级';
            funnelSourceRow = match.source_row;
            matchedStudentId = match.student_id ?? gs.student_id;
          }
        } else {
          // Funnel has a different student_id for this name, or no match at all
          ambiguous = true;
          managerName = '未分配学管';
        }
      }
    }

    // Fallback: match by student_name ONLY if grid has NO student_id
    if (managerName === '未分配学管' && !ambiguous && !gs.student_id) {
      const nameMatches = funnelByName.get(gs.student_name);
      if (nameMatches && nameMatches.length > 0) {
        // Check for ambiguity: multiple funnel students with same name, or multiple grid students with same name+source_row
        if (nameMatches.length > 1 || (gridNameSourceCount.get(`${gs.student_name}|${gs.source_row}`) || 0) > 1) {
          ambiguous = true;
          managerName = '未分配学管';
        } else {
          // Single match in both grid and funnel
          const match = nameMatches[0];
          managerName = match.manager_name && match.manager_name.trim() ? match.manager_name : '未分配学管';
          grade = match.grade && match.grade.trim() ? match.grade : '未分配年级';
          funnelSourceRow = match.source_row;
          matchedStudentId = match.student_id;
        }
      }
    }

    const subjectGroup = gs.teacher_stat_id ? teacherStats.get(gs.teacher_stat_id)?.subject_group : null;

    return {
      teacherName: gs.teacher_name ?? '未分配教师',
      managerName,
      subjectGroup: subjectGroup ?? '未知科组',
      grade,
      status: gs.status,
      studentId: matchedStudentId,
      studentName: gs.student_name,
      sourceRow: gs.source_row,
      slotIndex: gs.slot_index,
      ambiguous,
    };
  });
}

function toAnalyticsStudent(s: MentorStudent): AnalyticsStudentDto {
  // Include slotIndex in identityKey to distinguish same-name, same-sourceRow students
  const identityKey = s.studentId 
    ? `sid:${s.studentId}` 
    : `src:${s.sourceRow}:${s.slotIndex ?? 0}`;
  return {
    name: s.studentName ?? '',
    status: s.status,
    studentId: s.studentId,
    identityKey,
    ambiguous: s.ambiguous,
  };
}

/** 教师 × 学管 矩阵 */
export function getMentorMatrix(reportId: number): MentorMatrix {
  const cellMap = new Map<string, MentorMatrixCell>();
  const teachers = new Set<string>();
  const managers = new Set<string>();

  const addManager = (value: unknown) => {
    const name = String(value ?? '').trim();
    if (name && name !== '未分配学管') managers.add(name);
  };

  // 保持业绩表源行顺序；续生率中额外出现的学管随后补入，避免任何一套来源单独限制矩阵列。
  const managerRows = renewalDb.prepare(`
    SELECT manager_name FROM manager_perf
    WHERE report_id = ?
    ORDER BY COALESCE(source_row, 2147483647), id
  `).all(reportId) as { manager_name: string | null }[];
  managerRows.forEach(row => addManager(row.manager_name));
  const funnelManagerRows = renewalDb.prepare(`
    SELECT manager_name FROM student_funnel
    WHERE report_id = ?
    ORDER BY COALESCE(source_row, 2147483647), id
  `).all(reportId) as { manager_name: string | null }[];
  funnelManagerRows.forEach(row => addManager(row.manager_name));

  const students = loadMentorStudents(reportId);
  for (const student of students) {
    const { teacherName, managerName } = student;
    teachers.add(teacherName);
    addManager(managerName);
    const key = JSON.stringify([teacherName, managerName]);
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        teacherName, managerName,
        studentCount: 0, prepaidCount: 0, renewedCount: 0,
        prepaidRate: null, renewRate: null, students: [],
      };
      cellMap.set(key, cell);
    }
    cell.studentCount++;
    const stdStatus = normalizeStatus(student.status);
    if (stdStatus === 'prepaid') cell.prepaidCount++;
    if (stdStatus === 'renewed') cell.renewedCount++;
    cell.students.push(toAnalyticsStudent(student));
  }

  let totalPrepaid = 0, totalRenewed = 0, totalStudents = 0;
  for (const cell of cellMap.values()) {
    cell.prepaidRate = cell.studentCount > 0 ? (cell.prepaidCount / cell.studentCount) * 100 : null;
    cell.renewRate = cell.studentCount > 0 ? (cell.renewedCount / cell.studentCount) * 100 : null;
    totalPrepaid += cell.prepaidCount;
    totalRenewed += cell.renewedCount;
    totalStudents += cell.studentCount;
  }

  if (students.some(student => student.managerName === '未分配学管')) managers.add('未分配学管');

  return {
    teachers: Array.from(teachers).sort(),
    managers: Array.from(managers),
    cells: Array.from(cellMap.values()).sort((a, b) =>
      a.teacherName.localeCompare(b.teacherName) || a.managerName.localeCompare(b.managerName)),
    totalPrepaid,
    totalRenewed,
    totalStudents,
  };
}

/** 教师 × 年级 矩阵（基于 mentor 网格，优先按 student_id 关联年级）。 */
export function getTeacherGradeMatrix(reportId: number): TeacherGradeMatrix {
  const cellMap = new Map<string, TeacherGradeMatrixCell>();
  const teachers = new Set<string>();
  const grades = new Set<string>();

  for (const student of loadMentorStudents(reportId)) {
    const teacher = student.teacherName;
    const grade = student.grade || '未分配年级';
    teachers.add(teacher);
    grades.add(grade);

    const key = JSON.stringify([teacher, grade]);
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        teacherName: teacher,
        grade,
        studentCount: 0,
        prepaidCount: 0,
        renewedCount: 0,
        prepaidRate: null,
        renewRate: null,
        students: [],
      };
      cellMap.set(key, cell);
    }
    cell.studentCount++;
    const stdStatus = normalizeStatus(student.status);
    if (stdStatus === 'prepaid') cell.prepaidCount++;
    if (stdStatus === 'renewed') cell.renewedCount++;
    cell.students.push(toAnalyticsStudent(student));
  }

  for (const cell of cellMap.values()) {
    cell.prepaidRate = cell.studentCount > 0 ? (cell.prepaidCount / cell.studentCount) * 100 : null;
    cell.renewRate = cell.studentCount > 0 ? (cell.renewedCount / cell.studentCount) * 100 : null;
  }

  const gradeOrder: Record<string, number> = { '高三': 1, '高二': 2, '高一': 3, '初三': 4, '初二': 5, '初一': 6, '小学': 7, '未分配年级': 99 };
  let totalPrepaid = 0, totalRenewed = 0, totalStudents = 0;
  for (const cell of cellMap.values()) {
    totalPrepaid += cell.prepaidCount;
    totalRenewed += cell.renewedCount;
    totalStudents += cell.studentCount;
  }

  return {
    teachers: Array.from(teachers).sort(),
    grades: Array.from(grades).sort((a, b) => (gradeOrder[a] ?? 50) - (gradeOrder[b] ?? 50)),
    cells: Array.from(cellMap.values()),
    totalPrepaid,
    totalRenewed,
    totalStudents,
  };
}

/** 科组 × 年级 矩阵（基于 mentor 网格，按精确关联后的 subject_group 归并）。 */
export function getGroupGradeMatrix(reportId: number): GroupGradeMatrix {
  const cellMap = new Map<string, GroupGradeMatrixCell>();
  const subjectGroups = new Set<string>();
  const grades = new Set<string>();

  for (const student of loadMentorStudents(reportId)) {
    const subjectGroup = student.subjectGroup;
    const grade = student.grade || '未分配年级';
    subjectGroups.add(subjectGroup);
    grades.add(grade);

    const key = JSON.stringify([subjectGroup, grade]);
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        subjectGroup,
        grade,
        studentCount: 0,
        prepaidCount: 0,
        renewedCount: 0,
        prepaidRate: null,
        renewRate: null,
        students: [],
      };
      cellMap.set(key, cell);
    }
    cell.studentCount++;
    const stdStatus = normalizeStatus(student.status);
    if (stdStatus === 'prepaid') cell.prepaidCount++;
    if (stdStatus === 'renewed') cell.renewedCount++;
    cell.students.push(toAnalyticsStudent(student));
  }

  for (const cell of cellMap.values()) {
    cell.prepaidRate = cell.studentCount > 0 ? (cell.prepaidCount / cell.studentCount) * 100 : null;
    cell.renewRate = cell.studentCount > 0 ? (cell.renewedCount / cell.studentCount) * 100 : null;
  }

  const gradeOrder: Record<string, number> = { '高三': 1, '高二': 2, '高一': 3, '初三': 4, '初二': 5, '初一': 6, '小学': 7, '未分配年级': 99 };
  let totalPrepaid = 0, totalRenewed = 0, totalStudents = 0;
  for (const cell of cellMap.values()) {
    totalPrepaid += cell.prepaidCount;
    totalRenewed += cell.renewedCount;
    totalStudents += cell.studentCount;
  }

  return {
    subjectGroups: Array.from(subjectGroups).sort(),
    grades: Array.from(grades).sort((a, b) => (gradeOrder[a] ?? 50) - (gradeOrder[b] ?? 50)),
    cells: Array.from(cellMap.values()),
    totalPrepaid,
    totalRenewed,
    totalStudents,
  };
}

/**
 * 构建单期快照（复用 getRateOverview 逻辑，返回结构化对象供多期对比使用）
 */
function buildPeriodSnapshot(reportId: number, tab: string = 'mentor'): PeriodSnapshot {
  const students = loadMentorStudents(reportId);
  const rawStatuses = students.map(s => s.status);
  const counts = countByStatus(rawStatuses);
  const total = students.length;

  type Aggregate = { baseCount: number; prepaidCount: number; renewedCount: number };
  const aggregateBy = (keyOf: (student: MentorStudent) => string) => {
    const stats = new Map<string, Aggregate>();
    for (const student of students) {
      const key = keyOf(student);
      if (!stats.has(key)) stats.set(key, { baseCount: 0, prepaidCount: 0, renewedCount: 0 });
      const stat = stats.get(key)!;
      stat.baseCount++;
      const stdStatus = normalizeStatus(student.status);
      if (stdStatus === 'prepaid') stat.prepaidCount++;
      else if (stdStatus === 'renewed') stat.renewedCount++;
    }
    return stats;
  };

  const managerStats = aggregateBy(student => student.managerName);
  const groupRows = renewalDb.prepare(`
    SELECT subject_group,
           COALESCE(SUM(base_count), 0) AS base_count,
           COALESCE(SUM(prepaid_count), 0) AS prepaid_count,
           COALESCE(SUM(renewed_count), 0) AS renewed_count,
           COALESCE(SUM(prepaid_count), 0) * 100.0 / NULLIF(COALESCE(SUM(base_count), 0), 0) AS prepaid_rate,
           COALESCE(SUM(renewed_count), 0) * 100.0 / NULLIF(COALESCE(SUM(base_count), 0), 0) AS renew_rate
    FROM teacher_stats
    WHERE report_id = ? AND tab = ?
    GROUP BY subject_group
  `).all(reportId, tab) as any[];

  const groupStats = new Map<string, Aggregate>();
  for (const row of groupRows) {
    groupStats.set(row.subject_group ?? '未知科组', {
      baseCount: row.base_count,
      prepaidCount: row.prepaid_count,
      renewedCount: row.renewed_count,
    });
  }

  const withRates = (stat: Aggregate) => ({
    baseCount: stat.baseCount,
    prepaidCount: stat.prepaidCount,
    renewedCount: stat.renewedCount,
    prepaidRate: stat.baseCount > 0 ? (stat.prepaidCount / stat.baseCount) * 100 : 0,
    renewRate: stat.baseCount > 0 ? (stat.renewedCount / stat.baseCount) * 100 : 0,
  });

  const byManager = Array.from(managerStats.entries())
    .map(([managerName, stat]) => ({ managerName, ...withRates(stat) }))
    .sort((a, b) => a.managerName.localeCompare(b.managerName));
  const byGroup = Array.from(groupStats.entries())
    .map(([subjectGroup, stat]) => ({ subjectGroup, ...withRates(stat) }))
    .sort((a, b) => a.subjectGroup.localeCompare(b.subjectGroup));

  const report = renewalDb.prepare('SELECT stat_month, center_name, uploaded_at FROM renewal_report WHERE id = ?').get(reportId) as { stat_month: string | null; center_name: string | null; uploaded_at: string } | null;

  return {
    reportId,
    statMonth: report?.stat_month ?? null,
    centerName: report?.center_name ?? null,
    uploadedAt: report?.uploaded_at ?? '',
    totalStudents: total,
    prepaidCount: counts.prepaid,
    expiredCount: counts.expired,
    renewedCount: counts.renewed,
    lostCount: counts.lost,
    prepaidRate: total > 0 ? (counts.prepaid / total) * 100 : 0,
    expiredRate: total > 0 ? (counts.expired / total) * 100 : 0,
    renewedRate: total > 0 ? (counts.renewed / total) * 100 : 0,
    lostRate: total > 0 ? (counts.lost / total) * 100 : 0,
    overallPrepaidRate: total > 0 ? (counts.prepaid / total) * 100 : 0,
    overallRenewRate: total > 0 ? (counts.renewed / total) * 100 : 0,
    byManager,
    byGroup,
  };
}

/** 多期对比：按用户、校区、月份筛选报表并生成趋势数据 */
export function getMultiPeriodComparison(query: MultiPeriodQuery): MultiPeriodComparison {
  const { userId, centerName, limit = 12, months } = query;

  let whereClause = 'WHERE uploaded_by = ?';
  const params: any[] = [userId];

  if (centerName) {
    whereClause += ' AND center_name = ?';
    params.push(centerName);
  }

  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    whereClause += ` AND stat_month IN (${placeholders})`;
    params.push(...months);
  }

  const reports = renewalDb.prepare(`
    SELECT id, stat_month, center_name, uploaded_at
    FROM renewal_report
    ${whereClause}
    ORDER BY uploaded_at DESC
    LIMIT ?
  `).all(...params, limit) as Array<{ id: number; stat_month: string | null; center_name: string | null; uploaded_at: string }>;

  const periods = reports.map(r => buildPeriodSnapshot(r.id)).reverse(); // 时间正序

  // 趋势数组按时间正序
  const trends = {
    totalStudents: periods.map(p => p.totalStudents),
    prepaidRate: periods.map(p => p.prepaidRate),
    renewedRate: periods.map(p => p.renewedRate),
    lostRate: periods.map(p => p.lostRate),
  };

  return { periods, trends };
}


/**
 * 矩阵单元格学生明细（分页、筛选、排序）。
 * 支持三种矩阵类型：mentor (教师×学管)、grade (教师×年级)、group (科组×年级)。
 * 用于前端单元格钻取详情页。
 */
export interface CellDetailQuery {
  reportId: number;
  type: 'mentor' | 'grade' | 'group';
  rowKey: string;      // teacherName / teacherName / subjectGroup
  colKey: string;      // managerName / grade / grade
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'status' | 'grade' | 'enrollDays' | 'classLast1' | 'classLast2';
  sortDir?: 'asc' | 'desc';
  statusFilter?: string;  // 按状态筛选
}

export interface CellDetailStudent {
  studentId: string | null;
  studentName: string;
  status: string;
  grade: string | null;
  enrollDays: number | null;
  courseProduct: string | null;
  classLast1: number | null;
  classLast2: number | null;
  coef: number | null;
  type: string | null;
  managerName: string | null;
  subjectGroup: string | null;
}

export interface CellDetailPage {
  rows: CellDetailStudent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  summary: {
    studentCount: number;
    prepaidCount: number;
    renewedCount: number;
    stoppedCount: number;
    closedCount: number;
    grade3Count: number;
    normalCount: number;
    prepaidRate: number | null;
    renewRate: number | null;
  };
}

export function getCellDetail(query: CellDetailQuery): CellDetailPage {
  const { reportId, type, rowKey, colKey, page = 1, pageSize = 50, sortBy = 'name', sortDir = 'asc', statusFilter } = query;

  // Build WHERE clause based on matrix type
  let whereClause = '';
  let params: (string | number)[] = [reportId];

  if (type === 'mentor') {
    whereClause = `gs.teacher_name = ? AND gs.manager_name = ?`;
    params.push(rowKey, colKey);
  } else if (type === 'grade') {
    whereClause = `gs.teacher_name = ? AND sf.grade = ?`;
    params.push(rowKey, colKey);
  } else if (type === 'group') {
    whereClause = `gs.subject_group = ? AND sf.grade = ?`;
    params.push(rowKey, colKey);
  } else {
    throw new Error('未知的矩阵类型: ' + type);
  }

  if (statusFilter) {
    whereClause += ` AND gs.status = ?`;
    params.push(statusFilter);
  }

  // Valid sort columns
  const sortColumns: Record<string, string> = {
    name: 'gs.student_name',
    status: 'gs.status',
    grade: 'sf.grade',
    enrollDays: 'sf.enroll_days',
    classLast1: 'sf.class_last1',
    classLast2: 'sf.class_last2',
  };
  const sortColumn = sortColumns[sortBy] || 'gs.student_name';
  const sortDirection = sortDir === 'desc' ? 'DESC' : 'ASC';

  // Get total count
  const countQuery = `SELECT COUNT(*) AS cnt FROM grid_students gs
    LEFT JOIN student_funnel sf ON sf.report_id = gs.report_id AND sf.student_id = gs.student_id
    WHERE gs.report_id = ? AND ${whereClause}`;
  const totalResult = renewalDb.prepare(countQuery).get(...params) as { cnt: number };
  const total = totalResult.cnt;

  // Get paginated data
  const offset = (page - 1) * pageSize;
  const dataQuery = `SELECT
    gs.student_id, gs.student_name, gs.status,
    sf.grade, sf.enroll_days, sf.course_product,
    sf.class_last1, sf.class_last2, sf.coef, sf.type,
    gs.manager_name, gs.subject_group
  FROM grid_students gs
  LEFT JOIN student_funnel sf ON sf.report_id = gs.report_id AND sf.student_id = gs.student_id
  WHERE gs.report_id = ? AND ${whereClause}
  ORDER BY ${sortColumn} ${sortDirection}, gs.id
  LIMIT ? OFFSET ?`;

  const rows = renewalDb.prepare(dataQuery).all(...params, pageSize, offset) as any[];

  const mappedRows: CellDetailStudent[] = rows.map(r => ({
    studentId: r.student_id,
    studentName: r.student_name,
    status: r.status,
    grade: r.grade,
    enrollDays: r.enroll_days,
    courseProduct: r.course_product,
    classLast1: r.class_last1,
    classLast2: r.class_last2,
    coef: r.coef,
    type: r.type,
    managerName: r.manager_name,
    subjectGroup: r.subject_group,
  }));

  // Calculate summary statistics
  const allRowsQuery = `SELECT gs.status FROM grid_students gs
    LEFT JOIN student_funnel sf ON sf.report_id = gs.report_id AND sf.student_id = gs.student_id
    WHERE gs.report_id = ? AND ${whereClause}`;
  const allRows = renewalDb.prepare(allRowsQuery).all(...params) as { status: string }[];
  
  const summary = {
    studentCount: total,
    prepaidCount: allRows.filter(r => r.status === 'prepaid').length,
    renewedCount: allRows.filter(r => r.status === 'renewed').length,
    stoppedCount: allRows.filter(r => r.status === 'stopped').length,
    closedCount: allRows.filter(r => r.status === 'closed').length,
    grade3Count: allRows.filter(r => r.status === 'grade3').length,
    normalCount: allRows.filter(r => r.status === 'normal').length,
    prepaidRate: total > 0 ? (allRows.filter(r => r.status === 'prepaid').length / total) * 100 : null,
    renewRate: total > 0 ? (allRows.filter(r => r.status === 'renewed').length / total) * 100 : null,
  };

  return {
    rows: mappedRows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasMore: page < Math.ceil(total / pageSize),
    summary,
  };
}

/** 获取可用的统计月份列表（供前端下拉选择） */
export function getAvailableStatMonths(userId: number): string[] {
  const rows = renewalDb.prepare(`
    SELECT DISTINCT stat_month
    FROM renewal_report
    WHERE uploaded_by = ? AND stat_month IS NOT NULL
    ORDER BY stat_month DESC
  `).all(userId) as { stat_month: string }[];
  return rows.map(r => r.stat_month);
}

/** 获取可用的校区列表（供前端下拉选择） */
export function getAvailableCenters(userId: number): string[] {
  const rows = renewalDb.prepare(`
    SELECT DISTINCT center_name
    FROM renewal_report
    WHERE uploaded_by = ? AND center_name IS NOT NULL
    ORDER BY center_name
  `).all(userId) as { center_name: string }[];
  return rows.map(r => r.center_name);
}

/** 整体续费概览（预交/到期/续费/流失率环形图数据）。 */
export function getRateOverview(reportId: number, tab: string = 'mentor'): RateOverview {
  const snapshot = buildPeriodSnapshot(reportId, tab);
  return {
    total: snapshot.totalStudents,
    prepaidCount: snapshot.prepaidCount,
    expiredCount: snapshot.expiredCount,
    renewedCount: snapshot.renewedCount,
    lostCount: snapshot.lostCount,
    prepaidRate: snapshot.prepaidRate,
    expiredRate: snapshot.expiredRate,
    renewedRate: snapshot.renewedRate,
    lostRate: snapshot.lostRate,
    overall: {
      baseCount: snapshot.totalStudents,
      prepaidCount: snapshot.prepaidCount,
      renewedCount: snapshot.renewedCount,
      prepaidRate: snapshot.overallPrepaidRate,
      renewRate: snapshot.overallRenewRate,
    },
    byManager: snapshot.byManager,
    byGroup: snapshot.byGroup,
  };
}

/** 学生网格颜色状态分布（全部 4 个 tab 合并）
 * 返回原始网格颜色状态（renewed/prepaid/stopped/closed/grade3/normal），
 * 用于前端图例展示，不做业务归一化。 */
export function getStudentStatusSummary(reportId: number): { status: string; count: number }[] {
  const rows = renewalDb.prepare(`
    SELECT status, COUNT(*) AS cnt FROM grid_students
    WHERE report_id = ?
    GROUP BY status
    ORDER BY cnt DESC
  `).all(reportId) as { status: string; cnt: number }[];
  return rows.map(r => ({ status: r.status, count: r.cnt }));
}
