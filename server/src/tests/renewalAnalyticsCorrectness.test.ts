import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { initRenewalDb, renewalDb } from '../renewal/db.js';
import {
  getGroupComparison,
  getGroupGradeMatrix,
  getMentorMatrix,
  getRateOverview,
  getRiskStudents,
  getRiskStudentsPage,
  getTeacherGradeMatrix,
  getTeacherStats,
} from '../renewal/analytics.js';

let modernReportId: number;
let legacyReportId: number;

function addReport(fileName: string): number {
  const result = renewalDb.prepare('INSERT INTO renewal_report (file_name) VALUES (?)').run(fileName);
  return Number(result.lastInsertRowid);
}

function addTeacher(options: {
  reportId: number;
  sourceRow: number;
  teacherName: string;
  subjectGroup?: string;
  baseCount?: number;
  prepaidCount?: number;
  renewedCount?: number;
  studentCount?: number;
  sortOrder?: number;
}): number {
  const result = renewalDb.prepare(`
    INSERT INTO teacher_stats (
      report_id, tab, teacher_name, subject_group, base_count, prepaid_count,
      renewed_count, student_count, sort_order, source_row
    ) VALUES (?, 'mentor', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.reportId,
    options.teacherName,
    options.subjectGroup ?? '数学',
    options.baseCount ?? null,
    options.prepaidCount ?? null,
    options.renewedCount ?? null,
    options.studentCount ?? 0,
    options.sortOrder ?? options.sourceRow,
    options.sourceRow,
  );
  return Number(result.lastInsertRowid);
}

function addGridStudent(options: {
  reportId: number;
  teacherStatId: number | null;
  sourceRow: number | null;
  teacherName: string;
  studentId: string | null;
  studentName: string;
  status: string;
  slotIndex: number;
  subjectGroup?: string;
}): void {
  renewalDb.prepare(`
    INSERT INTO grid_students (
      report_id, tab, teacher_stat_id, teacher_name, subject_group, student_id,
      student_name, status, slot_index, source_row
    ) VALUES (?, 'mentor', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.reportId,
    options.teacherStatId,
    options.teacherName,
    options.subjectGroup ?? '数学',
    options.studentId,
    options.studentName,
    options.status,
    options.slotIndex,
    options.sourceRow,
  );
}

function addFunnelStudent(options: {
  reportId: number;
  studentId: string;
  studentName: string;
  managerName: string;
  grade: string;
  sourceRow: number;
}): void {
  renewalDb.prepare(`
    INSERT INTO student_funnel (
      report_id, manager_name, student_id, student_name, grade, renewed, source_row
    ) VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(
    options.reportId,
    options.managerName,
    options.studentId,
    options.studentName,
    options.grade,
    options.sourceRow,
  );
}

before(() => {
  initRenewalDb();
  modernReportId = addReport('synthetic-modern.xlsx');
  const firstTeacher = addTeacher({
    reportId: modernReportId,
    sourceRow: 10,
    teacherName: '同名教师',
    baseCount: 3,
    prepaidCount: 1,
    renewedCount: 1,
    studentCount: 1,
    sortOrder: 1,
  });
  const secondTeacher = addTeacher({
    reportId: modernReportId,
    sourceRow: 20,
    teacherName: '同名教师',
    baseCount: 0,
    prepaidCount: 0,
    renewedCount: 0,
    studentCount: 1,
    sortOrder: 2,
  });
  addGridStudent({
    reportId: modernReportId,
    teacherStatId: firstTeacher,
    sourceRow: 10,
    teacherName: '同名教师',
    studentId: 'S001',
    studentName: '同名学生',
    status: 'prepaid',
    slotIndex: 0,
  });
  addGridStudent({
    reportId: modernReportId,
    teacherStatId: secondTeacher,
    sourceRow: 20,
    teacherName: '同名教师',
    studentId: 'S002',
    studentName: '同名学生',
    status: 'renewed',
    slotIndex: 0,
  });
  addFunnelStudent({ reportId: modernReportId, studentId: 'S001', studentName: '同名学生', managerName: '学管甲', grade: '高一', sourceRow: 101 });
  // 同一来源重复行不得被误报为歧义。
  addFunnelStudent({ reportId: modernReportId, studentId: 'S001', studentName: '同名学生', managerName: '学管甲', grade: '高一', sourceRow: 102 });
  addFunnelStudent({ reportId: modernReportId, studentId: 'S002', studentName: '同名学生', managerName: '学管乙', grade: '高三', sourceRow: 103 });

  legacyReportId = addReport('synthetic-legacy.xlsx');
  addTeacher({ reportId: legacyReportId, sourceRow: 30, teacherName: '同名旧师', subjectGroup: 'legacy组', studentCount: 1, sortOrder: 1 });
  addTeacher({ reportId: legacyReportId, sourceRow: 40, teacherName: '同名旧师', subjectGroup: 'legacy组', studentCount: 2, sortOrder: 2 });
  addGridStudent({ reportId: legacyReportId, teacherStatId: null, sourceRow: 30, teacherName: '同名旧师', studentId: null, studentName: '旧生甲', status: 'prepaid', slotIndex: 0, subjectGroup: 'legacy组' });
  addGridStudent({ reportId: legacyReportId, teacherStatId: null, sourceRow: 40, teacherName: '同名旧师', studentId: null, studentName: '同名旧生', status: 'renewed', slotIndex: 0, subjectGroup: 'legacy组' });
  addGridStudent({ reportId: legacyReportId, teacherStatId: null, sourceRow: 40, teacherName: '同名旧师', studentId: null, studentName: '同名旧生', status: 'expired', slotIndex: 1, subjectGroup: 'legacy组' });
  addFunnelStudent({ reportId: legacyReportId, studentId: 'L001', studentName: '旧生甲', managerName: '旧学管甲', grade: '初二', sourceRow: 201 });
  addFunnelStudent({ reportId: legacyReportId, studentId: 'L002', studentName: '同名旧生', managerName: '旧学管乙', grade: '高一', sourceRow: 202 });
  addFunnelStudent({ reportId: legacyReportId, studentId: 'L003', studentName: '同名旧生', managerName: '旧学管丙', grade: '高三', sourceRow: 203 });
});

after(() => {
  renewalDb.close();
});

test('group-compare 的预交率和续费率与教师统计统一使用 0–100', () => {
  const group = getGroupComparison(modernReportId, 'mentor').find(row => row.subjectGroup === '数学');
  assert.ok(group);
  assert.equal(group.baseCount, 3);
  assert.equal(group.prepaidCount, 1);
  assert.equal(group.renewedCount, 1);
  assert.ok(Math.abs(group.prepaidRate! - 100 / 3) < 1e-10);
  assert.ok(Math.abs(group.renewRate! - 100 / 3) < 1e-10);
});

test('同名教师按 teacher_stat_id 隔离，且整 tab 学生只查询一次', () => {
  const originalPrepare = renewalDb.prepare;
  let gridQueries = 0;
  (renewalDb as any).prepare = (sql: string) => {
    if (/FROM\s+grid_students/i.test(sql)) gridQueries++;
    return originalPrepare.call(renewalDb, sql);
  };
  let stats: ReturnType<typeof getTeacherStats>;
  try {
    stats = getTeacherStats(modernReportId, 'mentor');
  } finally {
    (renewalDb as any).prepare = originalPrepare;
  }
  assert.equal(gridQueries, 1);
  assert.equal(stats.length, 2);
  assert.deepEqual(stats.map(row => row.students.map(student => student.studentId)), [['S001'], ['S002']]);
  assert.deepEqual(
    stats.map(row => row.students.map(({ name, status, slot }) => ({ name, status, slot }))),
    [
      [{ name: '同名学生', status: 'prepaid', slot: 0 }],
      [{ name: '同名学生', status: 'renewed', slot: 0 }],
    ],
  );
});

test('同名学生按不同 ID 保留学管、年级、状态和独立身份', () => {
  const mentor = getMentorMatrix(modernReportId);
  const students = mentor.cells.flatMap(cell => cell.students);
  assert.equal(mentor.totalStudents, 2);
  assert.deepEqual(students.map(student => student.studentId).sort(), ['S001', 'S002']);
  assert.equal(new Set(students.map(student => student.identityKey)).size, 2);
  assert.ok(students.every(student => student.ambiguous === false));
  assert.equal(mentor.cells.find(cell => cell.managerName === '学管甲')?.students[0].status, 'prepaid');
  assert.equal(mentor.cells.find(cell => cell.managerName === '学管乙')?.students[0].status, 'renewed');

  const teacherGrade = getTeacherGradeMatrix(modernReportId);
  assert.equal(teacherGrade.totalStudents, 2);
  assert.equal(teacherGrade.cells.find(cell => cell.grade === '高一')?.students[0].studentId, 'S001');
  assert.equal(teacherGrade.cells.find(cell => cell.grade === '高三')?.students[0].studentId, 'S002');
  const groupGrade = getGroupGradeMatrix(modernReportId);
  assert.equal(groupGrade.totalStudents, 2);
  assert.equal(groupGrade.cells.find(cell => cell.grade === '高一')?.students[0].status, 'prepaid');
  assert.equal(groupGrade.cells.find(cell => cell.grade === '高三')?.students[0].status, 'renewed');

  const overview = getRateOverview(modernReportId);
  assert.equal(overview.total, 2);
  assert.equal(overview.prepaidCount, 1);
  assert.equal(overview.renewedCount, 1);
  assert.equal(overview.byManager.find(row => row.managerName === '学管甲')?.prepaidCount, 1);
  assert.equal(overview.byManager.find(row => row.managerName === '学管乙')?.renewedCount, 1);
});

test('矩阵保留业绩表与续生率的完整学管轴，稀疏单元格仍只统计网格学生', () => {
  const reportId = addReport('complete-manager-axis.xlsx');
  const teacherId = addTeacher({ reportId, sourceRow: 10, teacherName: '矩阵教师', studentCount: 1 });
  addGridStudent({
    reportId, teacherStatId: teacherId, sourceRow: 10, teacherName: '矩阵教师',
    studentId: 'MATRIX-S001', studentName: '矩阵学生', status: 'prepaid', slotIndex: 0,
  });
  addFunnelStudent({
    reportId, studentId: 'MATRIX-S001', studentName: '矩阵学生',
    managerName: '学管乙', grade: '初二', sourceRow: 100,
  });
  const insertManager = renewalDb.prepare(
    'INSERT INTO manager_perf (report_id, manager_name, source_row) VALUES (?, ?, ?)',
  );
  const performanceManagers = ['学管甲', '学管乙', '学管丙', '学管丁', '学管戊', '学管己'];
  performanceManagers.forEach((name, index) => insertManager.run(reportId, name, index + 1));
  // 只在续生率明细出现、没有 mentor 网格学生的学管也必须保留列。
  addFunnelStudent({
    reportId, studentId: 'MATRIX-S999', studentName: '非网格学生',
    managerName: '仅续生率学管', grade: '高一', sourceRow: 101,
  });

  const matrix = getMentorMatrix(reportId);
  assert.deepEqual(matrix.managers, [...performanceManagers, '仅续生率学管']);
  assert.equal(matrix.totalStudents, 1);
  assert.equal(matrix.totalPrepaid, 1);
  assert.equal(matrix.cells.length, 1);
  assert.equal(matrix.cells[0].managerName, '学管乙');
  assert.equal(matrix.cells[0].studentCount, 1);
});

test('legacy 空 ID 按 source_row 关联教师，同名歧义保留独立行并进入未分配桶', () => {
  const stats = getTeacherStats(legacyReportId, 'mentor');
  assert.deepEqual(stats.map(row => row.students.map(student => student.name)), [['旧生甲'], ['同名旧生', '同名旧生']]);
  assert.ok(stats.every(row => row.students.every(student => student.studentId === null)));

  const mentor = getMentorMatrix(legacyReportId);
  assert.equal(mentor.totalStudents, 3);
  assert.equal(mentor.cells.find(cell => cell.managerName === '旧学管甲')?.studentCount, 1);
  assert.equal(mentor.cells.some(cell => cell.managerName === '旧学管乙' || cell.managerName === '旧学管丙'), false);
  const unassigned = mentor.cells.find(cell => cell.managerName === '未分配学管');
  assert.ok(unassigned);
  assert.equal(unassigned.studentCount, 2);
  assert.deepEqual(unassigned.students.map(student => student.status).sort(), ['expired', 'renewed']);
  assert.ok(unassigned.students.every(student => student.ambiguous === true));
  assert.equal(new Set(unassigned.students.map(student => student.identityKey)).size, 2);

  const teacherGrade = getTeacherGradeMatrix(legacyReportId);
  assert.deepEqual(teacherGrade.grades, ['初二', '未分配年级']);
  assert.equal(teacherGrade.cells.find(cell => cell.grade === '初二')?.studentCount, 1);
  const unknownGrade = teacherGrade.cells.find(cell => cell.grade === '未分配年级');
  assert.equal(unknownGrade?.studentCount, 2);
  assert.ok(unknownGrade?.students.every(student => student.ambiguous === true));

  const overview = getRateOverview(legacyReportId);
  assert.equal(overview.total, 3);
  assert.equal(overview.prepaidCount, 1);
  assert.equal(overview.renewedCount, 1);
  assert.equal(overview.expiredCount, 1);
  assert.equal(overview.byManager.find(row => row.managerName === '未分配学管')?.baseCount, 2);
});


test('风险清单提供跟进稳定键，缺学生编号时回退源行号', () => {
  renewalDb.prepare(`
    INSERT INTO student_funnel (report_id, student_id, student_name, source_row, renewed, class_last1)
    VALUES (?, 'RISK-S001', '独立编号学生', 998, 0, 0)
  `).run(modernReportId);
  renewalDb.prepare(`
    INSERT INTO student_funnel (report_id, student_id, student_name, source_row, renewed, class_last1)
    VALUES (?, NULL, '无编号学生', 999, 0, 0)
  `).run(modernReportId);
  const risks = getRiskStudents(modernReportId);
  assert.equal(risks.find(row => row.studentId === 'RISK-S001')?.studentKey, 'RISK-S001');
  const fallback = risks.find(row => row.studentName === '无编号学生');
  assert.equal(fallback?.studentKey, 'source_row:999');
  assert.equal(fallback?.sourceRow, 999);
});


test('风险清单分页返回全量计数，跨页无遗漏且无重复', () => {
  const reportId = addReport('risk-pagination.xlsx');
  const insert = renewalDb.prepare(`
    INSERT INTO student_funnel (
      report_id, student_id, student_name, source_row, renewed, class_last1, class_last2, enroll_days
    ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  `);
  renewalDb.transaction(() => {
    for (let index = 1; index <= 205; index += 1) {
      insert.run(reportId, `P${String(index).padStart(3, '0')}`, `学生${index}`, index, index % 3, index);
    }
  })();
  const first = getRiskStudentsPage(reportId, 1, 200);
  const second = getRiskStudentsPage(reportId, 2, 200);
  assert.equal(first.total, 205);
  assert.equal(first.totalPages, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.rows.length, 200);
  assert.equal(second.rows.length, 5);
  assert.equal(second.hasMore, false);
  const keys = [...first.rows, ...second.rows].map(row => row.studentKey);
  assert.equal(new Set(keys).size, 205);
  assert.equal(getRiskStudentsPage(reportId, 3, 200).rows.length, 0);
});

test('编号未命中时按唯一姓名补配学管，明确编号冲突仍隔离', () => {
  const reportId = addReport('identity-fallback.xlsx');
  const teacherId = addTeacher({ reportId, sourceRow: 10, teacherName: '关联教师', studentCount: 5 });
  const grid = (studentId: string | null, studentName: string, slotIndex: number) => addGridStudent({
    reportId, teacherStatId: teacherId, sourceRow: 10, teacherName: '关联教师',
    studentId, studentName, status: 'prepaid', slotIndex,
  });
  grid('A-LOCAL', '编号缺失', 0);
  grid('B-LOCAL', '编号冲突', 1);
  grid(null, '姓名唯一', 2);
  grid(null, '同名多人', 3);
  grid('E-ID', '编号优先', 4);
  const funnel = (studentId: string | null, studentName: string, managerName: string, sourceRow: number) => {
    renewalDb.prepare(`
      INSERT INTO student_funnel (report_id, student_id, student_name, manager_name, grade, renewed, source_row)
      VALUES (?, ?, ?, ?, '初二', 0, ?)
    `).run(reportId, studentId, studentName, managerName, sourceRow);
  };
  funnel(null, '编号缺失', '学管甲', 1);
  funnel('B-OTHER', '编号冲突', '学管乙', 2);
  funnel('C-ID', '姓名唯一', '学管丙', 3);
  funnel('D-ID-1', '同名多人', '学管丁', 4);
  funnel('D-ID-2', '同名多人', '学管丁', 5);
  funnel('E-ID', '编号优先', '学管戊', 6);
  funnel('E-OTHER', '编号优先', '另一学管', 7);

  const matrix = getMentorMatrix(reportId);
  const cells = matrix.cells.flatMap(cell => cell.students.map(student => ({ manager: cell.managerName, ...student })));
  assert.equal(cells.find(row => row.name === '编号缺失')?.manager, '学管甲');
  assert.equal(cells.find(row => row.name === '编号缺失')?.studentId, 'A-LOCAL');
  assert.equal(cells.find(row => row.name === '编号冲突')?.manager, '未分配学管');
  assert.equal(cells.find(row => row.name === '编号冲突')?.ambiguous, true);
  assert.equal(cells.find(row => row.name === '姓名唯一')?.manager, '学管丙');
  assert.equal(cells.find(row => row.name === '姓名唯一')?.studentId, 'C-ID');
  assert.equal(cells.find(row => row.name === '同名多人')?.manager, '未分配学管');
  assert.equal(cells.find(row => row.name === '编号优先')?.manager, '学管戊');
  const overview = getRateOverview(reportId);
  assert.deepEqual(
    overview.byManager.filter(row => row.baseCount > 0).map(row => [row.managerName, row.baseCount]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [['学管丙', 1], ['学管戊', 1], ['学管甲', 1], ['未分配学管', 2]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
});
