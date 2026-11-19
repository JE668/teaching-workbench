import { renewalDb } from './db.js';

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

/** 教师统计明细（含每个学生及其颜色状态） */
export interface TeacherStatFull extends TeacherStatDto {
  students: { name: string; status: string; slot: number }[];
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
  taskAmount: number | null;
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
export interface RiskStudentDto {
  managerName: string | null;
  studentId: string | null;
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
  students: { name: string; status: string }[];
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
  students: { name: string; status: string }[];
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
  students: { name: string; status: string }[];
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
    SELECT ts.teacher_name, ts.teacher_no, ts.subject_group,
           ts.base_count, ts.prepaid_count, ts.prepaid_rate,
           ts.renewed_count, ts.renew_rate, ts.incentive_gap,
           ts.extra_json, ts.student_count
    FROM teacher_stats ts
    WHERE ts.report_id = ? AND ts.tab = ?
    ORDER BY ts.sort_order
  `).all(reportId, tab) as any[];

  const insStudent = renewalDb.prepare(`
    SELECT student_name, status, slot_index FROM grid_students
    WHERE report_id = ? AND tab = ? AND teacher_name = ?
    ORDER BY slot_index
  `);

  return rows.map(r => ({
    tab,
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
    students: r.teacher_name
      ? (insStudent.all(reportId, tab, r.teacher_name) as { student_name: string; status: string; slot_index: number }[]).map(s => ({ name: s.student_name, status: s.status, slot: s.slot_index }))
      : [],
  }));
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
           COALESCE(SUM(prepaid_count), 0) * 1.0 / NULLIF(COALESCE(SUM(base_count), 0), 0) AS prepaid_rate,
           COALESCE(SUM(renewed_count), 0) * 1.0 / NULLIF(COALESCE(SUM(base_count), 0), 0) AS renew_rate,
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

/** 学管业绩 */
export function getManagerPerf(reportId: number): ManagerPerfDto[] {
  const rows = renewalDb.prepare(`
    SELECT manager_name,
           renew_1v1, renew_1vN, renew_small, renew_other, renew_total,
           newsign_1v1, newsign_1vN, newsign_small, newsign_other, newsign_total,
           renewed_count, tutored_count, renew_rate, task_amount, cashflow_total,
           completion_rate, actual_students, per_student, avg_order, gap_80
    FROM manager_perf
    WHERE report_id = ?
    ORDER BY cashflow_total DESC
  `).all(reportId) as any[];

  return rows.map(r => ({
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
    taskAmount: r.task_amount,
    cashflowTotal: r.cashflow_total,
    completionRate: r.completion_rate,
    actualStudents: r.actual_students,
    perStudent: r.per_student,
    avgOrder: r.avg_order,
    gap80: r.gap_80,
  }));
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
export function getRiskStudents(reportId: number, limit = 200): RiskStudentDto[] {
  const rows = renewalDb.prepare(`
    SELECT manager_name, student_id, student_name, grade, enroll_days, coef,
           type, course_product, class_last1, class_last2
    FROM student_funnel
    WHERE report_id = ?
      AND renewed = 0
      AND class_last1 = 0
      AND student_name NOT IN ('小计', '合计')
    ORDER BY class_last2 DESC, enroll_days DESC
    LIMIT ?
  `).all(reportId, limit) as any[];

  return rows.map(r => ({
    managerName: r.manager_name,
    studentId: r.student_id,
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

/**
 * 教师 × 学管 矩阵（仅 mentor tab 可用）。
 * 通过学生名关联 teacher_stats.grid_students 与 student_funnel.manager_name。
 */
export function getMentorMatrix(reportId: number): MentorMatrix {
  // 1. 取该报表 mentor tab 下所有老师的学生（带状态）
  const teacherStudents = renewalDb.prepare(`
    SELECT gs.teacher_name, gs.student_name, gs.status
    FROM grid_students gs
    JOIN teacher_stats ts ON ts.report_id = gs.report_id AND ts.tab = gs.tab AND ts.teacher_name = gs.teacher_name
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
  `).all(reportId) as { teacher_name: string; student_name: string; status: string }[];

  // 2. 取该报表所有学生的学管（student_funnel）
  const studentManagers = renewalDb.prepare(`
    SELECT student_name, manager_name FROM student_funnel
    WHERE report_id = ? AND manager_name IS NOT NULL AND student_name NOT IN ('小计', '合计')
  `).all(reportId) as { student_name: string; manager_name: string }[];

  const managerByStudent = new Map<string, string>();
  for (const sm of studentManagers) {
    managerByStudent.set(sm.student_name, sm.manager_name);
  }

  // 3. 聚合成矩阵
  const cellMap = new Map<string, MentorMatrixCell>(); // key: teacher|manager
  const teachers = new Set<string>();
  const managers = new Set<string>();

  for (const ts of teacherStudents) {
    const teacher = ts.teacher_name;
    const manager = managerByStudent.get(ts.student_name) || '未分配学管';
    teachers.add(teacher);
    managers.add(manager);

    const key = teacher + '|' + manager;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        teacherName: teacher,
        managerName: manager,
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
    if (ts.status === 'prepaid') cell.prepaidCount++;
    if (ts.status === 'renewed') cell.renewedCount++;
    cell.students.push({ name: ts.student_name, status: ts.status });
  }

  // 计算率
  for (const cell of cellMap.values()) {
    cell.prepaidRate = cell.studentCount > 0 ? (cell.prepaidCount / cell.studentCount) * 100 : null;
    cell.renewRate = cell.studentCount > 0 ? (cell.renewedCount / cell.studentCount) * 100 : null;
  }

  const sortedTeachers = Array.from(teachers).sort();
  const sortedManagers = Array.from(managers).sort();

  let totalPrepaid = 0, totalRenewed = 0, totalStudents = 0;
  for (const cell of cellMap.values()) {
    totalPrepaid += cell.prepaidCount;
    totalRenewed += cell.renewedCount;
    totalStudents += cell.studentCount;
  }

  return {
    teachers: sortedTeachers,
    managers: sortedManagers,
    cells: Array.from(cellMap.values()),
    totalPrepaid,
    totalRenewed,
    totalStudents,
  };
}
/**
 * 教师 × 年级 矩阵（基于 mentor tab 的学生网格，按学生名关联年级）。
 */
export function getTeacherGradeMatrix(reportId: number): TeacherGradeMatrix {
  // 1. 取该报表 mentor tab 下所有老师的学生（带状态）
  const teacherStudents = renewalDb.prepare(`
    SELECT gs.teacher_name, gs.student_name, gs.status
    FROM grid_students gs
    JOIN teacher_stats ts ON ts.report_id = gs.report_id AND ts.tab = gs.tab AND ts.teacher_name = gs.teacher_name
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
  `).all(reportId) as { teacher_name: string; student_name: string; status: string }[];

  // 2. 取该报表所有学生的年级（student_funnel）
  const studentGrades = renewalDb.prepare(`
    SELECT student_name, grade FROM student_funnel
    WHERE report_id = ? AND grade IS NOT NULL AND student_name NOT IN ('小计', '合计')
  `).all(reportId) as { student_name: string; grade: string }[];

  const gradeByStudent = new Map<string, string>();
  for (const sg of studentGrades) {
    gradeByStudent.set(sg.student_name, sg.grade);
  }

  // 3. 聚合成矩阵（按教师 × 年级）
  const cellMap = new Map<string, TeacherGradeMatrixCell>(); // key: teacher|grade
  const teachers = new Set<string>();
  const grades = new Set<string>();

  for (const ts of teacherStudents) {
    const teacher = ts.teacher_name;
    const grade = gradeByStudent.get(ts.student_name) || '未分配年级';
    teachers.add(teacher);
    grades.add(grade);

    const key = teacher + '|' + grade;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        teacherName: teacher,
        grade: grade,
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
    if (ts.status === 'prepaid') cell.prepaidCount++;
    if (ts.status === 'renewed') cell.renewedCount++;
    cell.students.push({ name: ts.student_name, status: ts.status });
  }

  // 计算率
  for (const cell of cellMap.values()) {
    cell.prepaidRate = cell.studentCount > 0 ? (cell.prepaidCount / cell.studentCount) * 100 : null;
    cell.renewRate = cell.studentCount > 0 ? (cell.renewedCount / cell.studentCount) * 100 : null;
  }

  const sortedTeachers = Array.from(teachers).sort();
  const gradeOrder: Record<string, number> = { '高三': 1, '高二': 2, '高一': 3, '初三': 4, '初二': 5, '初一': 6, '小学': 7, '未分配年级': 99 };
  const sortedGrades = Array.from(grades).sort((a, b) => (gradeOrder[a] ?? 50) - (gradeOrder[b] ?? 50));

  let totalPrepaid = 0, totalRenewed = 0, totalStudents = 0;
  for (const cell of cellMap.values()) {
    totalPrepaid += cell.prepaidCount;
    totalRenewed += cell.renewedCount;
    totalStudents += cell.studentCount;
  }

  return {
    teachers: sortedTeachers,
    grades: sortedGrades,
    cells: Array.from(cellMap.values()),
    totalPrepaid,
    totalRenewed,
    totalStudents,
  };
}

/**
 * 科组 × 年级 矩阵（基于 mentor tab 的学生网格，按 subject_group 归并）。
 */
export function getGroupGradeMatrix(reportId: number): GroupGradeMatrix {
  // 1. 取该报表 mentor tab 下所有老师的学生（带状态、科组）
  const teacherStudents = renewalDb.prepare(`
    SELECT gs.teacher_name, gs.student_name, gs.status, ts.subject_group
    FROM grid_students gs
    JOIN teacher_stats ts ON ts.report_id = gs.report_id AND ts.tab = gs.tab AND ts.teacher_name = gs.teacher_name
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
  `).all(reportId) as { teacher_name: string; student_name: string; status: string; subject_group: string | null }[];

  // 2. 取该报表所有学生的年级（student_funnel）
  const studentGrades = renewalDb.prepare(`
    SELECT student_name, grade FROM student_funnel
    WHERE report_id = ? AND grade IS NOT NULL AND student_name NOT IN ('小计', '合计')
  `).all(reportId) as { student_name: string; grade: string }[];

  const gradeByStudent = new Map<string, string>();
  for (const sg of studentGrades) {
    gradeByStudent.set(sg.student_name, sg.grade);
  }

  // 3. 聚合成矩阵（按科组 × 年级）
  const cellMap = new Map<string, GroupGradeMatrixCell>(); // key: subjectGroup|grade
  const subjectGroups = new Set<string>();
  const grades = new Set<string>();

  for (const ts of teacherStudents) {
    const subjectGroup = ts.subject_group || '未知科组';
    const grade = gradeByStudent.get(ts.student_name) || '未分配年级';
    subjectGroups.add(subjectGroup);
    grades.add(grade);

    const key = subjectGroup + '|' + grade;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = {
        subjectGroup: subjectGroup,
        grade: grade,
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
    if (ts.status === 'prepaid') cell.prepaidCount++;
    if (ts.status === 'renewed') cell.renewedCount++;
    cell.students.push({ name: ts.student_name, status: ts.status });
  }

  // 计算率
  for (const cell of cellMap.values()) {
    cell.prepaidRate = cell.studentCount > 0 ? (cell.prepaidCount / cell.studentCount) * 100 : null;
    cell.renewRate = cell.studentCount > 0 ? (cell.renewedCount / cell.studentCount) * 100 : null;
  }

  const sortedSubjectGroups = Array.from(subjectGroups).sort();
  const gradeOrder: Record<string, number> = { '高三': 1, '高二': 2, '高一': 3, '初三': 4, '初二': 5, '初一': 6, '小学': 7, '未分配年级': 99 };
  const sortedGrades = Array.from(grades).sort((a, b) => (gradeOrder[a] ?? 50) - (gradeOrder[b] ?? 50));

  let totalPrepaid = 0, totalRenewed = 0, totalStudents = 0;
  for (const cell of cellMap.values()) {
    totalPrepaid += cell.prepaidCount;
    totalRenewed += cell.renewedCount;
    totalStudents += cell.studentCount;
  }

  return {
    subjectGroups: sortedSubjectGroups,
    grades: sortedGrades,
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
  // 1. 取该报表 mentor tab 下的所有学生状态
  const students = renewalDb.prepare(`
    SELECT gs.student_name, gs.status
    FROM grid_students gs
    JOIN teacher_stats ts ON ts.report_id = gs.report_id AND ts.tab = gs.tab AND ts.teacher_name = gs.teacher_name
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
  `).all(reportId) as { student_name: string; status: string }[];

  // 2. 取该报表 student_funnel 表中的状态（更完整的状态信息）
  const funnelStudents = renewalDb.prepare(`
    SELECT student_name, status FROM student_funnel
    WHERE report_id = ? AND student_name NOT IN ('小计', '合计')
  `).all(reportId) as { student_name: string; status: string }[];

  // 合并去重：以 grid_students 为准，补充 funnel 状态
  const statusByStudent = new Map<string, string>();
  for (const s of funnelStudents) {
    statusByStudent.set(s.student_name, s.status);
  }
  for (const s of students) {
    if (!statusByStudent.has(s.student_name)) {
      statusByStudent.set(s.student_name, s.status);
    }
  }

  // 3. 统计各状态人数
  const counts = { prepaid: 0, expired: 0, renewed: 0, lost: 0 };
  for (const [, status] of statusByStudent) {
    const s = status.toLowerCase();
    if (s === 'prepaid' || s === '预交') counts.prepaid++;
    else if (s === 'expired' || s === '到期未续') counts.expired++;
    else if (s === 'renewed' || s === '已续费') counts.renewed++;
    else if (s === 'lost' || s === '流失') counts.lost++;
    else counts.expired++;
  }

  const total = counts.prepaid + counts.expired + counts.renewed + counts.lost;
  
  // 按学管统计（通过 student_funnel 关联 manager_name）
  const teacherStudents = renewalDb.prepare(`
    SELECT gs.teacher_name, gs.student_name, gs.status, sf.manager_name
    FROM grid_students gs
    JOIN student_funnel sf ON sf.report_id = gs.report_id AND sf.student_name = gs.student_name
    WHERE gs.report_id = ? AND gs.tab = 'mentor' AND sf.manager_name IS NOT NULL
  `).all(reportId) as { teacher_name: string; student_name: string; status: string; manager_name: string | null }[];

  const managerStats = new Map<string, { baseCount: number; prepaidCount: number; renewedCount: number }>();
  for (const ts of teacherStudents) {
    const manager = ts.manager_name || '未分配学管';
    if (!managerStats.has(manager)) {
      managerStats.set(manager, { baseCount: 0, prepaidCount: 0, renewedCount: 0 });
    }
    const stat = managerStats.get(manager)!;
    stat.baseCount++;
    const s = ts.status.toLowerCase();
    if (s === 'prepaid' || s === '预交') stat.prepaidCount++;
    else if (s === 'renewed' || s === '已续费') stat.renewedCount++;
  }

  const byManager = Array.from(managerStats.entries()).map(([managerName, stat]) => ({
    managerName,
    baseCount: stat.baseCount,
    prepaidCount: stat.prepaidCount,
    renewedCount: stat.renewedCount,
    prepaidRate: stat.baseCount > 0 ? (stat.prepaidCount / stat.baseCount) * 100 : 0,
    renewRate: stat.baseCount > 0 ? (stat.renewedCount / stat.baseCount) * 100 : 0,
  }));

  // 按科组统计（teacher_stats 有 subject_group）
  const teacherStudents2 = renewalDb.prepare(`
    SELECT gs.teacher_name, gs.student_name, gs.status, ts.subject_group
    FROM grid_students gs
    JOIN teacher_stats ts ON ts.report_id = gs.report_id AND ts.tab = gs.tab AND ts.teacher_name = gs.teacher_name
    WHERE gs.report_id = ? AND gs.tab = 'mentor'
  `).all(reportId) as { teacher_name: string; student_name: string; status: string; subject_group: string | null }[];

  const groupStats = new Map<string, { baseCount: number; prepaidCount: number; renewedCount: number }>();
  for (const ts of teacherStudents2) {
    const group = ts.subject_group || '未知科组';
    if (!groupStats.has(group)) {
      groupStats.set(group, { baseCount: 0, prepaidCount: 0, renewedCount: 0 });
    }
    const stat = groupStats.get(group)!;
    stat.baseCount++;
    const s = ts.status.toLowerCase();
    if (s === 'prepaid' || s === '预交') stat.prepaidCount++;
    else if (s === 'renewed' || s === '已续费') stat.renewedCount++;
  }

  const byGroup = Array.from(groupStats.entries()).map(([subjectGroup, stat]) => ({
    subjectGroup,
    baseCount: stat.baseCount,
    prepaidCount: stat.prepaidCount,
    renewedCount: stat.renewedCount,
    prepaidRate: stat.baseCount > 0 ? (stat.prepaidCount / stat.baseCount) * 100 : 0,
    renewRate: stat.baseCount > 0 ? (stat.renewedCount / stat.baseCount) * 100 : 0,
  }));

  if (total === 0) {
    return {
      total: 0,
      prepaidCount: 0,
      expiredCount: 0,
      renewedCount: 0,
      lostCount: 0,
      prepaidRate: 0,
      expiredRate: 0,
      renewedRate: 0,
      lostRate: 0,
      overall: {
        baseCount: 0,
        prepaidCount: 0,
        renewedCount: 0,
        prepaidRate: 0,
        renewRate: 0,
      },
      byManager: [],
      byGroup: [],
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
