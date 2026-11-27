import { renewalDb } from './db.js';
import type { ManagerProductTargets } from './managerTargetService.js';

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

const TABS = new Set(['incentive', 'stage', 'mentor', 'hours']);

function assertTab(tab: string): string {
  if (!TABS.has(tab)) throw new Error('未知的统计表 tab: ' + tab);
  return tab;
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
  const legacyStudentsBySourceRow = new Map<number, TeacherStatFull['students']>();
  for (const row of studentRows) {
    const student = {
      name: row.student_name,
      status: row.status,
      slot: row.slot_index,
      studentId: row.student_id ?? null,
      identityKey: `grid:${row.id}`,
    };
    const target = row.teacher_stat_id !== null && row.teacher_stat_id !== undefined
      ? studentsByStatId
      : legacyStudentsBySourceRow;
    const key = row.teacher_stat_id !== null && row.teacher_stat_id !== undefined
      ? row.teacher_stat_id as number
      : row.source_row as number | null;
    // legacy 数据以 report_id/tab/source_row 精确关联；缺 source_row 时不按姓名猜测。
    if (key === null || key === undefined) continue;
    const bucket = target.get(key) ?? [];
    bucket.push(student);
    target.set(key, bucket);
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
    prepaidRate: r.prepaid_rate,
    renewRate: r.renew_rate,
    incentiveGap: r.incentive_gap,
  }));
}

/** 学管业绩：产品现金流只汇总分项，合计仍保留 Excel 导入的真实值。 */
export function getManagerPerf(reportId: number, userId: number): ManagerPerfDto[] {
  const rows = renewalDb.prepare(`
    SELECT p.manager_name,
           p.renew_1v1, p.renew_1vN, p.renew_small, p.renew_other, p.renew_total,
           p.newsign_1v1, p.newsign_1vN, p.newsign_small, p.newsign_other, p.newsign_total,
           p.renewed_count, p.tutored_count, p.renew_rate, p.task_amount, p.cashflow_total,
           p.completion_rate, p.actual_students, p.per_student, p.avg_order, p.gap_80,
           t.target_amount AS target_override,
           t.one2one_target, t.one2many_target, t.small_target, t.other_target
    FROM manager_perf p
    LEFT JOIN renewal_manager_target t
      ON t.report_id = p.report_id AND t.user_id = ? AND t.manager_name = p.manager_name
    WHERE p.report_id = ?
    ORDER BY p.cashflow_total DESC
  `).all(userId, reportId) as any[];

  const addNullable = (left: number | null, right: number | null): number | null => {
    if (left === null && right === null) return null;
    return (left ?? 0) + (right ?? 0);
  };

  return rows.map(r => {
    const taskAmount = r.target_override ?? r.task_amount;
    // 有有效任务时重算；旧 Excel 只有完成率、没有任务额时保留导入的百分比。
    const completionRate = taskAmount === null
      ? r.completion_rate
      : r.cashflow_total !== null && taskAmount > 0
        ? (r.cashflow_total / taskAmount) * 100
        : null;
    const gap80 = r.cashflow_total !== null && taskAmount !== null
      ? taskAmount * 0.8 - r.cashflow_total
      : null;
    return {
      managerName: r.manager_name,
      renew: {
        one2one: r.renew_1v1, one2many: r.renew_1vN, small: r.renew_small,
        other: r.renew_other, total: r.renew_total,
      },
      newsign: {
        one2one: r.newsign_1v1, one2many: r.newsign_1vN, small: r.newsign_small,
        other: r.newsign_other, total: r.newsign_total,
      },
      renewedCount: r.renewed_count,
      tutoredCount: r.tutored_count,
      renewRate: r.renew_rate,
      taskAmount,
      importedTaskAmount: r.task_amount,
      importedTargetAmount: r.task_amount,
      productTargets: {
        one2one: r.one2one_target,
        one2many: r.one2many_target,
        small: r.small_target,
        other: r.other_target,
      },
      productCashflow: {
        one2one: addNullable(r.renew_1v1, r.newsign_1v1),
        one2many: addNullable(r.renew_1vN, r.newsign_1vN),
        small: addNullable(r.renew_small, r.newsign_small),
        other: addNullable(r.renew_other, r.newsign_other),
        total: r.cashflow_total,
      },
      cashflowTotal: r.cashflow_total,
      completionRate,
      actualStudents: r.actual_students,
      perStudent: r.per_student,
      avgOrder: r.avg_order,
      gap80,
    };
  });
}

/** 续生漏斗（按学管聚合） */
export function getFunnel(reportId: number): FunnelDto[] {
  const rows = renewalDb.prepare(`
    SELECT manager_name,
           COUNT(*) AS students,
           COALESCE(SUM(class_last1), 0) AS classed_last1,
           COALESCE(SUM(class_last2), 0) AS classed_last2,
           COALESCE(SUM(renewed), 0) AS renewed
    FROM student_funnel
    WHERE report_id = ? AND manager_name IS NOT NULL
    GROUP BY manager_name
    ORDER BY students DESC
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

/**
 * 风险学生清单：未续费、且上 1 个月无课消（含"上2个月有课消但上1个月消失"的沉默学生）。
 * 判定完全基于 Excel 里的原始标记列，不做任何预测。
 */
const RISK_WHERE = `
  FROM student_funnel
  WHERE report_id = ?
    AND renewed = 0
    AND class_last1 = 0
    AND student_name NOT IN ('小计', '合计')
`;

function queryRiskStudents(reportId: number, limit: number, offset = 0): RiskStudentDto[] {
  const rows = renewalDb.prepare(`
    SELECT manager_name, student_id, student_name, source_row, grade, enroll_days, coef,
           type, course_product, class_last1, class_last2,
           COUNT(*) OVER (PARTITION BY student_id) AS student_id_risk_rows
    ${RISK_WHERE}
    ORDER BY class_last2 DESC, enroll_days DESC, source_row ASC, student_id ASC
    LIMIT ? OFFSET ?
  `).all(reportId, limit, offset) as any[];
  return rows.map(r => ({
    managerName: r.manager_name,
    studentId: r.student_id,
    studentKey: r.student_id && r.student_id_risk_rows === 1 ? r.student_id : `source_row:${r.source_row}`,
    sourceRow: r.source_row,
    studentName: r.student_name,
    grade: r.grade,
    enrollDays: r.enroll_days,
    coef: r.coef,
    type: r.type,
    courseProduct: r.course_product,
    classLast1: r.class_last1,
    classLast2: r.class_last2,
  }));
}

export function getRiskStudents(reportId: number, limit = 200): RiskStudentDto[] {
  return queryRiskStudents(reportId, limit);
}

export function getRiskStudentsPage(reportId: number, page = 1, pageSize = 50): RiskStudentPage {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0
    ? Math.min(200, Math.floor(pageSize))
    : 50;
  const total = (renewalDb.prepare(`SELECT COUNT(*) AS count ${RISK_WHERE}`).get(reportId) as { count: number }).count;
  const rows = queryRiskStudents(reportId, safePageSize, (safePage - 1) * safePageSize);
  return {
    rows, total, page: safePage, pageSize: safePageSize,
    totalPages: Math.ceil(total / safePageSize),
    hasMore: safePage * safePageSize < total,
  };
}

interface FunnelIdentityRow {
  student_id: string | null;
  student_name: string | null;
  manager_name: string | null;
  grade: string | null;
}

interface MentorStudent {
  teacherName: string;
  studentName: string;
  studentId: string | null;
  identityKey: string;
  ambiguous: boolean;
  managerName: string;
  grade: string | null;
  subjectGroup: string;
  status: string;
}

function addIdentityCandidate(index: Map<string, FunnelIdentityRow[]>, key: string, row: FunnelIdentityRow): void {
  const bucket = index.get(key) ?? [];
  bucket.push(row);
  index.set(key, bucket);
}

function identityValues(rows: FunnelIdentityRow[], field: 'student_id' | 'student_name' | 'manager_name' | 'grade'): Set<string> {
  return new Set(rows.map(row => row[field]?.trim()).filter((value): value is string => Boolean(value)));
}

/** 逐网格行读取学生；ID 精确关联，legacy 姓名关联只在无歧义时采用。 */
function loadMentorStudents(reportId: number): MentorStudent[] {
  const gridRows = renewalDb.prepare(`
    SELECT gs.id, gs.teacher_name, gs.student_id, gs.student_name, gs.status,
           COALESCE(direct_ts.subject_group, legacy_ts.subject_group, gs.subject_group) AS subject_group
    FROM grid_students gs
    LEFT JOIN teacher_stats direct_ts
      ON direct_ts.id = gs.teacher_stat_id
     AND direct_ts.report_id = gs.report_id
     AND direct_ts.tab = gs.tab
    LEFT JOIN teacher_stats legacy_ts
      ON gs.teacher_stat_id IS NULL
     AND legacy_ts.report_id = gs.report_id
     AND legacy_ts.tab = gs.tab
     AND legacy_ts.source_row = gs.source_row
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
    ORDER BY gs.teacher_name, gs.student_name, gs.slot_index, gs.id
  `).all(reportId) as {
    id: number; teacher_name: string | null; student_id: string | null;
    student_name: string | null; status: string | null; subject_group: string | null;
  }[];
  const funnelRows = renewalDb.prepare(`
    SELECT student_id, student_name, manager_name, grade
    FROM student_funnel
    WHERE report_id = ? AND student_name NOT IN ('小计', '合计')
    ORDER BY id
  `).all(reportId) as FunnelIdentityRow[];

  const funnelById = new Map<string, FunnelIdentityRow[]>();
  const funnelByName = new Map<string, FunnelIdentityRow[]>();
  for (const row of funnelRows) {
    const studentId = row.student_id?.trim();
    const studentName = row.student_name?.trim();
    if (studentId) addIdentityCandidate(funnelById, studentId, row);
    if (studentName) addIdentityCandidate(funnelByName, studentName, row);
  }

  const students: MentorStudent[] = [];
  for (const row of gridRows) {
    const studentName = row.student_name?.trim();
    if (!studentName) continue;
    const studentId = row.student_id?.trim() || null;
    const idCandidates = studentId ? funnelById.get(studentId) ?? [] : [];
    const nameCandidates = funnelByName.get(studentName) ?? [];
    // 编号命中时只信任编号；编号未命中时，可用唯一姓名补齐旧表缺失的编号列。
    // 若姓名记录明确指向另一个编号，则保留冲突，绝不把一个学生并到另一个学管。
    const candidates = idCandidates.length > 0 ? idCandidates : nameCandidates;
    const candidateIds = identityValues(candidates, 'student_id');
    const candidateNames = identityValues(candidates, 'student_name');
    const managerNames = identityValues(candidates, 'manager_name');
    const grades = identityValues(candidates, 'grade');
    const conflictingId = idCandidates.length === 0 && Boolean(studentId)
      && Array.from(candidateIds).some(candidateId => candidateId !== studentId);
    const identityAmbiguous = conflictingId || (!studentId && candidateIds.size > 1);
    const ambiguous = identityAmbiguous
      || candidateNames.size > 1
      || managerNames.size > 1
      || grades.size > 1;
    const managerName = !identityAmbiguous && managerNames.size === 1
      ? Array.from(managerNames)[0]
      : '未分配学管';
    const grade = !identityAmbiguous && grades.size === 1
      ? Array.from(grades)[0]
      : null;
    const resolvedStudentId = studentId ?? (candidateIds.size === 1 ? Array.from(candidateIds)[0] : null);
    students.push({
      teacherName: row.teacher_name?.trim() || '未填写教师',
      studentName,
      studentId: resolvedStudentId,
      identityKey: `grid:${row.id}`,
      ambiguous,
      managerName,
      grade,
      subjectGroup: row.subject_group?.trim() || '未知科组',
      status: row.status || 'normal',
    });
  }
  return students;
}

function toAnalyticsStudent(student: MentorStudent): AnalyticsStudentDto {
  return {
    name: student.studentName,
    status: student.status,
    studentId: student.studentId,
    identityKey: student.identityKey,
    ambiguous: student.ambiguous,
  };
}

/**
 * 教师 × 学管矩阵：单元格只统计 mentor 网格学生。
 * 学管轴必须来自业绩表与续生率明细的完整名单，不能从稀疏单元格反推，
 * 否则暂无匹配学生的学管会整列消失。
 */
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
    // JSON 复合键不会像 "|" 拼接那样在名称本身含分隔符时碰撞。
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
    if (student.status === 'prepaid') cell.prepaidCount++;
    if (student.status === 'renewed') cell.renewedCount++;
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

  // 未分配桶固定置于最后；它表示学生归属缺失或冲突，不属于业绩表学管名单。
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
/**
 * 教师 × 年级 矩阵（基于 mentor 网格，优先按 student_id 关联年级）。
 */
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
    if (student.status === 'prepaid') cell.prepaidCount++;
    if (student.status === 'renewed') cell.renewedCount++;
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

/**
 * 科组 × 年级 矩阵（基于 mentor 网格，按精确关联后的 subject_group 归并）。
 */
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
    if (student.status === 'prepaid') cell.prepaidCount++;
    if (student.status === 'renewed') cell.renewedCount++;
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
 * 整体续费概览（预交/到期/续费/流失率环形图数据）。
 */
export function getRateOverview(reportId: number): RateOverview {
  // 状态只来自 mentor 网格；保留同名学生的独立网格行及其各自状态。
  const students = loadMentorStudents(reportId);
  const counts = { prepaid: 0, expired: 0, renewed: 0, lost: 0 };
  for (const student of students) {
    const status = student.status.toLowerCase();
    if (status === 'prepaid' || status === '预交') counts.prepaid++;
    else if (status === 'expired' || status === '到期未续') counts.expired++;
    else if (status === 'renewed' || status === '已续费') counts.renewed++;
    else if (status === 'lost' || status === '流失') counts.lost++;
    else counts.expired++;
  }
  const total = students.length;

  type Aggregate = { baseCount: number; prepaidCount: number; renewedCount: number };
  const aggregateBy = (keyOf: (student: MentorStudent) => string) => {
    const stats = new Map<string, Aggregate>();
    for (const student of students) {
      const key = keyOf(student);
      if (!stats.has(key)) stats.set(key, { baseCount: 0, prepaidCount: 0, renewedCount: 0 });
      const stat = stats.get(key)!;
      stat.baseCount++;
      const status = student.status.toLowerCase();
      if (status === 'prepaid' || status === '预交') stat.prepaidCount++;
      else if (status === 'renewed' || status === '已续费') stat.renewedCount++;
    }
    return stats;
  };
  const managerStats = aggregateBy(student => student.managerName);
  const groupStats = aggregateBy(student => student.subjectGroup);
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

  if (total === 0) {
    return {
      total: 0, prepaidCount: 0, expiredCount: 0, renewedCount: 0, lostCount: 0,
      prepaidRate: 0, expiredRate: 0, renewedRate: 0, lostRate: 0,
      overall: { baseCount: 0, prepaidCount: 0, renewedCount: 0, prepaidRate: 0, renewRate: 0 },
      byManager: [], byGroup: [],
    };
  }

  return {
    total,
    prepaidCount: counts.prepaid,
    expiredCount: counts.expired,
    renewedCount: counts.renewed,
    lostCount: counts.lost,
    prepaidRate: (counts.prepaid / total) * 100,
    expiredRate: (counts.expired / total) * 100,
    renewedRate: (counts.renewed / total) * 100,
    lostRate: (counts.lost / total) * 100,
    overall: {
      baseCount: total,
      prepaidCount: counts.prepaid,
      renewedCount: counts.renewed,
      prepaidRate: (counts.prepaid / total) * 100,
      renewRate: (counts.renewed / total) * 100,
    },
    byManager,
    byGroup,
  };
}


/** 学生网格颜色状态分布（全部 4 个 tab 合并） */
export function getStudentStatusSummary(reportId: number): { status: string; count: number }[] {
  const rows = renewalDb.prepare(
    `
    SELECT status, COUNT(*) AS cnt FROM grid_students
    WHERE report_id = ?
    GROUP BY status
    ORDER BY cnt DESC
    `
  ).all(reportId) as { status: string; cnt: number }[];
  return rows.map(r => ({ status: r.status, count: r.cnt }));
}
