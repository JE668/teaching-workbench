import './setup.js';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createUser, req, startServer, stopServer } from './helpers.js';
import { parseFunnel } from '../renewal/parser.js';

let token = '';
let reportId = 0;

function setHeader(ws: ExcelJS.Worksheet, col: number, value: string, merge = false) {
  ws.getRow(3).getCell(col).value = value;
  if (merge) ws.mergeCells(3, col, 4, col);
}

function addStageLikeSheet(wb: ExcelJS.Workbook, name: string, mentor: boolean) {
  const ws = wb.addWorksheet(name);
  setHeader(ws, 2, '教师', true);
  setHeader(ws, 3, '工号', true);
  setHeader(ws, 4, '科组', true);
  setHeader(ws, 5, '学生总数', true);
  ws.mergeCells(3, 6, 3, 8);
  ws.getRow(3).getCell(6).value = '在读人数';
  ws.mergeCells(3, 9, 3, 11);
  ws.getRow(3).getCell(9).value = '预存人数';
  ['非毕业班', '初三', '高三'].forEach((v, i) => {
    ws.getRow(4).getCell(6 + i).value = v;
    ws.getRow(4).getCell(9 + i).value = v;
  });
  setHeader(ws, 12, '总预存人数', true);
  setHeader(ws, 13, '总预存率', true);
  setHeader(ws, 14, '总续生数', true);
  setHeader(ws, 15, '续生率', true);
  setHeader(ws, 16, '80%人数差值', true);

  const row = ws.getRow(5);
  row.getCell(2).value = '张老师';
  row.getCell(3).value = 'T001';
  row.getCell(4).value = '数学组';
  row.getCell(5).value = 3;
  [2, 1, 0].forEach((v, i) => row.getCell(6 + i).value = v);
  [1, 1, 0].forEach((v, i) => row.getCell(9 + i).value = v);
  row.getCell(12).value = 2;
  row.getCell(13).value = 2 / 3;
  row.getCell(14).value = 1;
  row.getCell(15).value = 1;
  row.getCell(16).value = -1;
  [28, 29, 30].forEach((col, i) => row.getCell(col).value = ['学生A', '学生B', '学生C'][i]);

  if (mentor) {
    // 空行不能终止后续教师解析；两个名称/学管组合在旧的 "|" 拼接键下会碰撞。
    const special = [
      { row: 7, teacher: '甲|乙', student: '学生D', prepaid: 1 },
      { row: 8, teacher: '甲', student: '学生E', prepaid: 0 },
    ];
    for (const item of special) {
      const r = ws.getRow(item.row);
      r.getCell(2).value = item.teacher;
      r.getCell(4).value = '数学组';
      r.getCell(5).value = 1;
      r.getCell(12).value = item.prepaid;
      r.getCell(13).value = item.prepaid;
      r.getCell(14).value = 0;
      r.getCell(15).value = 0;
      r.getCell(28).value = item.student;
    }
    ws.getRow(9).getCell(2).value = '学习中心';
  } else {
    ws.getRow(6).getCell(2).value = '学习中心';
  }
}

function buildWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  addStageLikeSheet(wb, '教师统计表 (学段)', false);
  addStageLikeSheet(wb, '教师统计表 (学管) ', true);

  const hours = wb.addWorksheet('教师统计表(课时)');
  setHeader(hours, 2, '教师', true);
  setHeader(hours, 3, '工号', true);
  setHeader(hours, 4, '科组', true);
  setHeader(hours, 5, '学生\n总数', true);
  hours.mergeCells(3, 6, 3, 7);
  hours.getRow(3).getCell(6).value = '在读人数';
  hours.mergeCells(3, 8, 3, 9);
  hours.getRow(3).getCell(8).value = '预存人数';
  ['0-80', '80+'].forEach((v, i) => {
    hours.getRow(4).getCell(6 + i).value = v;
    hours.getRow(4).getCell(8 + i).value = v;
  });
  // 课时表真实总计列叫「预存数」，不能误中「预存人数80+」拆分列。
  setHeader(hours, 10, '预存数', true);
  setHeader(hours, 11, '预存率', true);
  setHeader(hours, 12, '续生数', true);
  setHeader(hours, 13, '续生率', true);
  setHeader(hours, 14, '80%人数差值', true);
  const hr = hours.getRow(5);
  hr.getCell(2).value = '张老师';
  hr.getCell(4).value = '数学组';
  hr.getCell(5).value = 3;
  hr.getCell(6).value = 1;
  hr.getCell(7).value = 2;
  hr.getCell(8).value = 1;
  hr.getCell(9).value = 1;
  hr.getCell(10).value = 2;
  hr.getCell(11).value = '66.67%';
  hr.getCell(12).value = 1;
  hr.getCell(13).value = 0.5;
  [23, 24, 25].forEach((col, i) => hr.getCell(col).value = ['学生A', '学生B', '学生C'][i]);

  const colors = wb.addWorksheet('续科率');
  [
    ['张老师', '学生A', '是', '否'],
    ['张老师', '学生B', '否', '是'],
  ].forEach((values, i) => {
    const r = colors.getRow(i + 2);
    r.getCell(6).value = values[0];
    r.getCell(8).value = values[1];
    r.getCell(22).value = values[2];
    r.getCell(27).value = values[3];
  });

  const funnel = wb.addWorksheet('续生率');
  const funnelRows = [
    ['M1', 'S001', '学生A'],
    ['M1', 'S001', '学生A'], // 重复来源行不得放大矩阵/概览
    ['M1', 'S002', '学生B'],
    [null, 'S003', '学生C'],
    ['丙', 'S004', '学生D'],
    ['乙|丙', 'S005', '学生E'],
  ];
  funnelRows.forEach((values, i) => {
    const r = funnel.getRow(i + 2);
    if (values[0]) r.getCell(5).value = values[0];
    r.getCell(8).value = values[1];
    r.getCell(9).value = values[2];
  });

  const perf = wb.addWorksheet('学管业绩统计表');
  perf.getRow(5).getCell(1).value = 'M1';
  perf.getRow(5).getCell(14).value = 0.85;
  perf.getRow(5).getCell(17).value = '75%';
  return wb;
}

before(async () => {
  await startServer();
  token = await createUser('renewal-regression');
  const wb = buildWorkbook();
  const buf = await wb.xlsx.writeBuffer() as any;
  const form = new FormData();
  form.append('file', new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'renewal-regression.xlsx');
  const uploaded = await req('POST', '/api/renewal/upload', { token, raw: form });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  reportId = uploaded.body.report.reportId;
});

after(async () => {
  await stopServer();
});

test('学段与课时读取多层表头、总预存和全部拆分明细', async () => {
  for (const tab of ['stage', 'hours']) {
    const res = await req('GET', `/api/renewal/dashboard/teacher-stats?reportId=${reportId}&tab=${tab}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rows.length, 1);
    const row = res.body.rows[0];
    assert.equal(row.baseCount, 3);
    assert.equal(row.prepaidCount, 2, `${tab} 总预存不能取首个拆分列`);
    assert.equal(row.renewedCount, 1);
    assert.equal(row.incentiveGap, tab === 'stage' ? -1 : null);
    if (tab === 'stage') {
      assert.deepEqual(row.extra, {
        enroll_nongrad: 2, enroll_g9: 1, enroll_g12: 0,
        prepaid_nongrad: 1, prepaid_g9: 1, prepaid_g12: 0,
      });
      assert.ok(Math.abs(row.prepaidRate - 200 / 3) < 1e-9);
      assert.equal(row.renewRate, 100, 'Excel 数值 1 表示 100%');
    } else {
      assert.deepEqual(row.extra, {
        enroll_0_80: 1, enroll_80p: 2,
        prepaid_0_80: 1, prepaid_80p: 1,
      });
      assert.equal(row.prepaidRate, 66.67);
      assert.equal(row.renewRate, 50);
    }
  }
});

test('学管矩阵返回教师×学管，空值/重复来源/复合键均不放大或串格', async () => {
  const res = await req('GET', `/api/renewal/analytics/mentor-matrix?reportId=${reportId}`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const matrix = res.body.matrix;
  assert.equal(matrix.totalStudents, 5);
  assert.equal(matrix.totalPrepaid, 1);
  assert.equal(matrix.totalRenewed, 1);
  assert.equal(matrix.cells.length, 4);
  const m1 = matrix.cells.find((c: any) => c.teacherName === '张老师' && c.managerName === 'M1');
  assert.equal(m1.studentCount, 2);
  assert.equal(m1.prepaidCount, 1);
  assert.equal(m1.renewedCount, 1);
  const unassigned = matrix.cells.find((c: any) => c.teacherName === '张老师' && c.managerName === '未分配学管');
  assert.equal(unassigned.studentCount, 1);
  for (const [teacherName, managerName, studentName] of [
    ['甲|乙', '丙', '学生D'],
    ['甲', '乙|丙', '学生E'],
  ]) {
    const cell = matrix.cells.find((c: any) => c.teacherName === teacherName && c.managerName === managerName);
    assert.equal(cell.studentCount, 1);
    assert.deepEqual(cell.students.map((s: any) => s.name), [studentName]);
  }
});

test('学管联动概览不再查询不存在的 student_funnel.status', async () => {
  const res = await req('GET', `/api/renewal/analytics/rate-overview?reportId=${reportId}`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const overview = res.body.overview;
  assert.equal(overview.total, 5);
  assert.equal(overview.prepaidCount, 1);
  assert.equal(overview.renewedCount, 1);
  assert.equal(overview.expiredCount, 3);
  assert.equal(overview.byManager.reduce((sum: number, row: any) => sum + row.baseCount, 0), 5);
  assert.equal(overview.byGroup.reduce((sum: number, row: any) => sum + row.baseCount, 0), 5);
});

test('学管业绩比率统一为 0–100', async () => {
  const res = await req('GET', `/api/renewal/analytics/manager-perf?reportId=${reportId}`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.rows[0].renewRate, 85);
  assert.equal(res.body.rows[0].completionRate, 75);
});

test('续生率主表无学生时回退学管学生映射并保留空学管桶', () => {
  const wb = new ExcelJS.Workbook();
  const primary = wb.addWorksheet('续生率');
  primary.getRow(1).getCell(9).value = '学生';
  const fallback = wb.addWorksheet('学管学生');
  const rows = [
    { student: '学生A', grade: '初三', manager: 'M1', renewed: '是' },
    { student: '学生B', grade: '高一', manager: null, renewed: '否' },
  ];
  rows.forEach((item, index) => {
    const row = fallback.getRow(index + 2);
    row.getCell(1).value = item.student;
    row.getCell(2).value = item.grade;
    if (item.manager) row.getCell(3).value = item.manager;
    row.getCell(9).value = item.renewed;
  });
  assert.deepEqual(parseFunnel(wb).map(row => ({
    studentName: row.studentName,
    managerName: row.managerName,
    grade: row.grade,
    renewed: row.renewed,
  })), [
    { studentName: '学生A', managerName: 'M1', grade: '初三', renewed: 1 },
    { studentName: '学生B', managerName: null, grade: '高一', renewed: 0 },
  ]);
});
