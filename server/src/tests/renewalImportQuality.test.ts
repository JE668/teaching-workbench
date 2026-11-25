import './setup.js';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { createUser, req, startServer, stopServer, userIdOf } from './helpers.js';
import { initRenewalDb, renewalDb } from '../renewal/db.js';
import { latestReportId } from '../renewal/renewalService.js';
import { buildColorContext } from '../renewal/parser.js';

let token = '';
let userId = 0;

function buildValidWorkbook(marker = 'identity'): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const teacher = wb.addWorksheet('教师统计表(激励)');
  teacher.getCell('A1').value = `测试学习中心 2026年11月 ${marker}`;
  const headers: Record<number, string> = {
    2: '教师', 3: '工号', 4: '科组', 5: '学生基数', 6: '预存人数',
    7: '整体预存率', 8: '续科人数', 10: '系统续科率', 13: '激励差额',
  };
  for (const [col, value] of Object.entries(headers)) {
    teacher.getRow(3).getCell(Number(col)).value = value;
  }
  // 同名教师的两条来源记录必须分别关联到各自的 teacher_stats.id。
  for (const [row, student] of [[5, '网格学生甲'], [6, '网格学生乙']] as const) {
    teacher.getRow(row).getCell(2).value = '重复教师';
    teacher.getRow(row).getCell(3).value = row === 5 ? 10001 : 10002;
    teacher.getRow(row).getCell(4).value = '数学组';
    teacher.getRow(row).getCell(5).value = 1;
    teacher.getRow(row).getCell(6).value = 0;
    teacher.getRow(row).getCell(7).value = 0;
    teacher.getRow(row).getCell(8).value = row === 5 ? 1 : 0;
    teacher.getRow(row).getCell(10).value = row === 5 ? 100 : 0;
    teacher.getRow(row).getCell(13).value = 0;
    teacher.getRow(row).getCell(15).value = student;
  }

  const funnel = wb.addWorksheet('续生率');
  funnel.getRow(1).getCell(5).value = '学管师';
  funnel.getRow(1).getCell(8).value = '学生编号';
  funnel.getRow(1).getCell(9).value = '学生';
  funnel.getRow(2).getCell(5).value = '学管甲';
  funnel.getRow(2).getCell(8).value = 'S-A';
  funnel.getRow(2).getCell(9).value = '网格学生甲';
  funnel.getRow(2).getCell(18).value = '是';
  funnel.getRow(3).getCell(5).value = '学管甲';
  funnel.getRow(3).getCell(8).value = 10003;
  funnel.getRow(3).getCell(9).value = '漏斗学生丙';
  funnel.getRow(3).getCell(18).value = '否';

  // 乙不在续生率主表，验证会从续科率 I 列补充学生编号。
  const xuke = wb.addWorksheet('续科率');
  xuke.getRow(2).getCell(6).value = '重复教师';
  xuke.getRow(2).getCell(8).value = '网格学生乙';
  xuke.getRow(2).getCell(9).value = 'X-B';
  xuke.getRow(2).getCell(22).value = '否';

  const perf = wb.addWorksheet('学管业绩统计表');
  perf.getRow(5).getCell(1).value = '学管甲';
  perf.getRow(5).getCell(12).value = 1;
  perf.getRow(5).getCell(16).value = 12000;
  return wb;
}

async function workbookBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer() as any);
}

async function uploadBuffer(buffer: Buffer, fileName: string) {
  const form = new FormData();
  form.append('file', new Blob([buffer as any], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), fileName);
  return req('POST', '/api/renewal/upload', { token, raw: form });
}

async function uploadWorkbook(wb: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbookBuffer(wb);
  return { buffer, response: await uploadBuffer(buffer, fileName) };
}

before(async () => {
  await startServer();
  token = await createUser('renewal-quality-user');
  userId = userIdOf(token);
});

after(async () => {
  await stopServer();
});

test('学生编号从补充明细关联，同名编号冲突时保留身份不明确', () => {
  const wb = new ExcelJS.Workbook();
  const teacherStudent = wb.addWorksheet('老师学生');
  teacherStudent.getRow(2).getCell(2).value = '教师甲';
  teacherStudent.getRow(2).getCell(3).value = '同名学生';
  teacherStudent.getRow(2).getCell(24).value = 'S001';
  const detail = wb.addWorksheet('在读学生明细');
  detail.getRow(2).getCell(10).value = '同名学生';
  detail.getRow(2).getCell(11).value = 'S001';
  detail.getRow(2).getCell(12).value = '初三';
  detail.getRow(3).getCell(10).value = '另一学生';
  detail.getRow(3).getCell(11).value = 'S002';
  const resolved = buildColorContext(wb);
  assert.equal(resolved.studentIdMap.get('同名学生'), 'S001');
  assert.equal(resolved.studentIdMap.get('另一学生'), 'S002');

  detail.getRow(2).getCell(11).value = 'CONFLICT';
  const ambiguous = buildColorContext(wb);
  assert.equal(ambiguous.studentIdMap.has('同名学生'), false);
  assert.equal(ambiguous.studentIdMap.get('另一学生'), 'S002');
});

describe('续费导入质量、身份关联与幂等', () => {
  test('initRenewalDb 可重复升级旧库并保留旧行', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE renewal_report (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        stat_month TEXT,
        center_name TEXT,
        uploaded_by INTEGER,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_count INTEGER,
        error_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'processing',
        note TEXT
      );
      CREATE TABLE grid_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        tab TEXT NOT NULL,
        teacher_name TEXT,
        subject_group TEXT,
        student_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'normal',
        slot_index INTEGER,
        source_row INTEGER
      );
      CREATE TABLE renewal_import_error (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        sheet_name TEXT,
        row_number INTEGER,
        error_message TEXT
      );
      INSERT INTO renewal_report (file_name, status) VALUES ('legacy.xlsx', 'committed');
      INSERT INTO grid_students (report_id, tab, student_name) VALUES (1, 'incentive', '旧学生');
      INSERT INTO renewal_import_error (report_id, error_message) VALUES (1, '旧错误');
    `);
    initRenewalDb(legacy);
    initRenewalDb(legacy);

    const gridColumns = legacy.prepare('PRAGMA table_info(grid_students)').all() as Array<{ name: string }>;
    const reportColumns = legacy.prepare('PRAGMA table_info(renewal_report)').all() as Array<{ name: string }>;
    const errorColumns = legacy.prepare('PRAGMA table_info(renewal_import_error)').all() as Array<{ name: string }>;
    assert.ok(gridColumns.some((column) => column.name === 'teacher_stat_id'));
    assert.ok(gridColumns.some((column) => column.name === 'student_id'));
    assert.ok(reportColumns.some((column) => column.name === 'file_hash'));
    for (const field of ['error_type', 'severity', 'column_number', 'field_name', 'details_json']) {
      assert.ok(errorColumns.some((column) => column.name === field), field);
    }
    assert.equal((legacy.prepare('SELECT file_name FROM renewal_report WHERE id = 1').get() as any).file_name, 'legacy.xlsx');
    const oldError = legacy.prepare('SELECT error_type, severity FROM renewal_import_error WHERE id = 1').get() as any;
    assert.deepEqual(oldError, { error_type: 'parse_error', severity: 'error' });
    const oldGrid = legacy.prepare('SELECT teacher_stat_id, student_id FROM grid_students WHERE id = 1').get() as any;
    assert.deepEqual(oldGrid, { teacher_stat_id: null, student_id: null });
    legacy.close();
  });

  test('空工作簿生成结构化错误并拒绝提交', async () => {
    const { response } = await uploadWorkbook(new ExcelJS.Workbook(), 'empty.xlsx');
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(response.body.report.status, 'rejected');
    assert.equal(response.body.deduplicated, false);
    const reportId = response.body.report.reportId as number;
    const errors = await req('GET', `/api/renewal/reports/${reportId}/errors`, { token });
    assert.equal(errors.status, 200);
    const empty = errors.body.errors.find((item: any) => item.error_type === 'empty_workbook');
    assert.ok(empty);
    assert.equal(empty.severity, 'error');
    assert.equal(empty.error_message.includes('学生甲'), false);
    assert.equal(latestReportId(userId), null);
  });

  test('必需表头与局部空关键数据产生阻断问题', async () => {
    const wb = buildValidWorkbook('missing-header');
    wb.getWorksheet('教师统计表(激励)')!.getRow(3).getCell(5).value = null;
    wb.getWorksheet('续生率')!.getRow(1).getCell(8).value = null;
    wb.getWorksheet('续生率')!.getRow(2).getCell(9).value = null;
    wb.getWorksheet('教师统计表(激励)')!.getRow(5).getCell(16).value = {
      formula: '0', result: undefined,
    } as any;
    const { response } = await uploadWorkbook(wb, 'missing-header.xlsx');
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(response.body.report.status, 'rejected');
    const rows = renewalDb.prepare(`
      SELECT error_type, severity, sheet_name, row_number, column_number, error_message
      FROM renewal_import_error WHERE report_id = ?
    `).all(response.body.report.reportId) as any[];
    assert.ok(rows.some((row) => row.error_type === 'missing_header' && row.severity === 'error'));
    assert.ok(rows.some((row) => row.error_type === 'missing_header' && row.sheet_name === '续生率'));
    assert.ok(rows.some((row) => row.error_type === 'empty_key_data' && row.column_number === 9));
    assert.equal((renewalDb.prepare('SELECT COUNT(*) AS count FROM teacher_stats WHERE report_id = ?')
      .get(response.body.report.reportId) as any).count, 0);
    assert.equal(rows.some((row) => row.error_message.includes('网格学生甲')), false);
    const responseErrors = await req('GET', `/api/renewal/reports/${response.body.report.reportId}/errors`, { token });
    assert.equal(responseErrors.status, 200);
    assert.equal(responseErrors.body.errors.length, rows.length);
    assert.deepEqual(responseErrors.body.summary, {
      total: 5,
      errorCount: 3,
      warningCount: 2,
      groups: [
        { severity: 'error', errorType: 'missing_header', count: 2 },
        { severity: 'error', errorType: 'empty_key_data', count: 1 },
        { severity: 'warning', errorType: 'formula_cache_missing', count: 1 },
        { severity: 'warning', errorType: 'summary_detail_mismatch', count: 1 },
      ],
    });
  });

  test('学生网格跨空白状态区块时不漏识别后续学生', async () => {
    const wb = buildValidWorkbook('blank-separated-grid');
    const teacher = wb.getWorksheet('教师统计表(激励)')!;
    teacher.getRow(5).getCell(5).value = 2;
    teacher.getRow(5).getCell(19).value = '空列后学生';
    const { response } = await uploadWorkbook(wb, 'blank-separated-grid.xlsx');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const reportId = response.body.report.reportId as number;
    const grid = renewalDb.prepare(`
      SELECT source_row, student_name, slot_index FROM grid_students
      WHERE report_id = ? ORDER BY source_row, slot_index
    `).all(reportId) as any[];
    assert.deepEqual(grid.map(row => [row.source_row, row.student_name, row.slot_index]), [
      [5, '网格学生甲', 1],
      [5, '空列后学生', 5],
      [6, '网格学生乙', 1],
    ]);
    const issues = renewalDb.prepare(`
      SELECT error_type FROM renewal_import_error WHERE report_id = ?
    `).all(reportId) as any[];
    assert.equal(issues.some(row => row.error_type === 'grid_truncated'), false);
    assert.equal(issues.some(row => row.error_type === 'summary_detail_mismatch'), false);
  });

  test('课时学生基数与课时分段网格口径不同，不产生虚假汇总差异', async () => {
    const wb = buildValidWorkbook('hours-grid-scope');
    const hours = wb.addWorksheet('教师统计表(课时)');
    const headers: Record<number, string> = {
      2: '教师', 3: '工号', 4: '科组', 5: '学生总数', 6: '预存数',
      7: '预存率', 8: '续生数', 9: '续生率', 10: '80%人数差值',
      11: '在读人数0-80', 12: '在读人数80+', 13: '预存人数0-80', 14: '预存人数80+',
    };
    for (const [col, value] of Object.entries(headers)) hours.getRow(3).getCell(Number(col)).value = value;
    hours.getRow(5).getCell(2).value = '课时教师';
    hours.getRow(5).getCell(5).value = 2;
    hours.getRow(5).getCell(6).value = 0;
    hours.getRow(5).getCell(11).value = 1;
    hours.getRow(5).getCell(12).value = 1;
    hours.getRow(5).getCell(23).value = '课时分段学生';
    const { response } = await uploadWorkbook(wb, 'hours-grid-scope.xlsx');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const mismatches = renewalDb.prepare(`
      SELECT COUNT(*) AS count FROM renewal_import_error
      WHERE report_id = ? AND sheet_name = '教师统计表(课时)'
        AND error_type = 'summary_detail_mismatch'
    `).get(response.body.report.reportId) as any;
    assert.equal(mismatches.count, 0);
  });

  test('公式异常、网格截断和汇总差异以警告状态提交', async () => {
    const wb = buildValidWorkbook('warnings');
    const teacher = wb.getWorksheet('教师统计表(激励)')!;
    teacher.getRow(5).getCell(5).value = 2; // 汇总 2，网格只有 1
    teacher.getRow(5).getCell(6).value = { formula: '0+0', result: undefined } as any;
    teacher.getRow(5).getCell(8).value = { formula: '1/0', result: '#DIV/0!' } as any;
    teacher.getRow(6).getCell(5).value = 81;
    for (let col = 16; col < 15 + 81; col++) {
      teacher.getRow(6).getCell(col).value = `截断学生${col}`;
    }
    const { response } = await uploadWorkbook(wb, 'warnings.xlsx');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.report.status, 'committed_with_warnings');
    assert.equal(latestReportId(userId), response.body.report.reportId);

    const rows = renewalDb.prepare(`
      SELECT error_type, severity, column_number, error_message, details_json
      FROM renewal_import_error WHERE report_id = ?
    `).all(response.body.report.reportId) as any[];
    for (const errorType of [
      'formula_cache_missing', 'formula_error', 'grid_truncated', 'summary_detail_mismatch',
    ]) {
      assert.ok(rows.some((row) => row.error_type === errorType && row.severity === 'warning'), errorType);
    }
    assert.ok(rows.some((row) => row.error_type === 'formula_cache_missing' && row.column_number === 6));
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes('重复教师'), false);
    assert.equal(serialized.includes('网格学生甲'), false);
    assert.equal(serialized.includes('截断学生95'), false);
  });

  test('161 条导入警告返回分组汇总且保留定位字段与详情', async () => {
    const wb = buildValidWorkbook('warning-summary');
    const teacher = wb.getWorksheet('教师统计表(激励)')!;
    for (const rowNumber of [5, 6]) {
      teacher.getRow(rowNumber).getCell(5).value = 2;
      for (let columnNumber = 16; columnNumber <= 94; columnNumber++) {
        teacher.getRow(rowNumber).getCell(columnNumber).value = {
          formula: '0', result: undefined,
        } as any;
      }
    }
    teacher.getRow(6).getCell(95).value = '超出网格学生';
    const { response } = await uploadWorkbook(wb, 'warning-summary.xlsx');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.report.status, 'committed_with_warnings');

    const responseErrors = await req('GET', `/api/renewal/reports/${response.body.report.reportId}/errors`, { token });
    assert.equal(responseErrors.status, 200);
    assert.equal(responseErrors.body.errors.length, 161);
    assert.deepEqual(responseErrors.body.summary, {
      total: 161,
      errorCount: 0,
      warningCount: 161,
      groups: [
        { severity: 'warning', errorType: 'formula_cache_missing', count: 158 },
        { severity: 'warning', errorType: 'summary_detail_mismatch', count: 2 },
        { severity: 'warning', errorType: 'grid_truncated', count: 1 },
      ],
    });
    assert.ok(responseErrors.body.errors.every((row: any) =>
      Object.hasOwn(row, 'field_name') && Object.hasOwn(row, 'details_json')));
    const formulaRows = responseErrors.body.errors.filter((row: any) =>
      row.error_type === 'formula_cache_missing');
    assert.equal(formulaRows.length, 158);
    assert.ok(formulaRows.every((row: any) => row.field_name === 'student_grid'));

    const mismatch = responseErrors.body.errors.find((row: any) =>
      row.error_type === 'summary_detail_mismatch' && row.row_number === 5);
    assert.equal(mismatch.sheet_name, '教师统计表(激励)');
    assert.equal(mismatch.column_number, 5);
    assert.equal(mismatch.field_name, 'base_count');
    assert.deepEqual(JSON.parse(mismatch.details_json), { summaryCount: 2, detailCount: 1 });
    const truncated = responseErrors.body.errors.find((row: any) => row.error_type === 'grid_truncated');
    assert.equal(truncated.sheet_name, '教师统计表(激励)');
    assert.equal(truncated.row_number, 6);
    assert.equal(truncated.column_number, 95);
    assert.equal(truncated.field_name, 'student_grid');
    assert.deepEqual(JSON.parse(truncated.details_json), { gridColumnLimit: 80 });
  });

  test('身份字段精确关联且同内容上传返回原批次', async () => {
    const wb = buildValidWorkbook('identity-and-dedup');
    const buffer = await workbookBuffer(wb);
    const first = await uploadBuffer(buffer, 'identity.xlsx');
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.report.status, 'committed');
    assert.equal(first.body.deduplicated, false);
    const reportId = first.body.report.reportId as number;

    const teachers = renewalDb.prepare(`
      SELECT id, source_row, teacher_no FROM teacher_stats WHERE report_id = ? ORDER BY source_row
    `).all(reportId) as any[];
    const grid = renewalDb.prepare(`
      SELECT teacher_stat_id, student_id, source_row FROM grid_students
      WHERE report_id = ? ORDER BY source_row
    `).all(reportId) as any[];
    assert.equal(teachers.length, 2);
    assert.notEqual(teachers[0].id, teachers[1].id);
    assert.deepEqual(teachers.map((row) => row.teacher_no), ['10001', '10002']);
    assert.deepEqual(grid, [
      { teacher_stat_id: teachers[0].id, student_id: 'S-A', source_row: 5 },
      { teacher_stat_id: teachers[1].id, student_id: 'X-B', source_row: 6 },
    ]);
    const numericId = renewalDb.prepare(`
      SELECT student_id FROM student_funnel WHERE report_id = ? AND source_row = 3
    `).get(reportId) as any;
    assert.equal(numericId.student_id, '10003');
    const storedHash = renewalDb.prepare('SELECT file_hash FROM renewal_report WHERE id = ?').get(reportId) as any;
    assert.match(storedHash.file_hash, /^[a-f0-9]{64}$/);

    const second = await uploadBuffer(buffer, 'renamed-but-same.xlsx');
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.deduplicated, true);
    assert.equal(second.body.report.deduplicated, true);
    assert.equal(second.body.report.reportId, reportId);
    assert.equal(second.body.report.fileName, 'identity.xlsx');
    assert.equal((renewalDb.prepare('SELECT COUNT(*) AS count FROM renewal_report WHERE file_hash = ?')
      .get(storedHash.file_hash) as any).count, 1);
  });

  test('同内容并发上传只创建一个批次', async () => {
    const buffer = await workbookBuffer(buildValidWorkbook('concurrent'));
    const [a, b] = await Promise.all([
      uploadBuffer(buffer, 'concurrent-a.xlsx'),
      uploadBuffer(buffer, 'concurrent-b.xlsx'),
    ]);
    assert.deepEqual([a.status, b.status].sort((x, y) => x - y), [200, 201], JSON.stringify([a.body, b.body]));
    assert.equal(a.body.report.reportId, b.body.report.reportId);
    assert.equal([a.body.deduplicated, b.body.deduplicated].filter(Boolean).length, 1);
    const reportId = a.body.report.reportId as number;
    const hash = (renewalDb.prepare('SELECT file_hash FROM renewal_report WHERE id = ?').get(reportId) as any).file_hash;
    assert.equal((renewalDb.prepare('SELECT COUNT(*) AS count FROM renewal_report WHERE file_hash = ?')
      .get(hash) as any).count, 1);
    assert.equal(latestReportId(userId), reportId);
  });
});
