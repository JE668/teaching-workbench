import './setup.js';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { db } from '../config/database.js';
import {
  EXCEL_TEMPLATE_MAX_FILE_BYTES,
  ExcelTemplateInspectError,
  inspectTemplate,
} from '../services/excel/inspectTemplate.js';
import { createStudent, createUser, req, startServer, stopServer, url } from './helpers.js';

async function workbookBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const report = workbook.addWorksheet('Report');
  report.getCell('A1').value = '学生姓名';
  report.getCell('B2').value = 0;
  report.getCell('C3').value = false;
  report.getCell('D4').value = { formula: '1+1', result: 2 };
  report.getCell('A35').value = '超出预览行';
  report.getCell('N1').value = '超出预览列';
  const data = workbook.addWorksheet('数据');
  data.getCell('B2').value = '第二张表';
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

function assertChineseError(error: unknown, message: RegExp, statusCode = 400) {
  assert.ok(error instanceof ExcelTemplateInspectError);
  assert.match(error.message, message);
  assert.equal(error.statusCode, statusCode);
}

describe('Excel 模板 inspect helper', () => {
  test('返回工作表、原始尺寸和预览范围内的非空单元格', async () => {
    const result = await inspectTemplate(await workbookBase64());
    assert.deepEqual(result.sheetNames, ['Report', '数据']);
    assert.equal(result.sheetName, 'Report');
    assert.equal(result.rowCount, 35);
    assert.equal(result.columnCount, 14);
    assert.equal(result.maxRows, 30);
    assert.equal(result.maxColumns, 12);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.cells, [
      { address: 'A1', text: '学生姓名' },
      { address: 'B2', text: '0' },
      { address: 'C3', text: 'false' },
      { address: 'D4', text: '2' },
    ]);
  });

  test('可选择工作表，未截断的小表保留 0 和空单元格语义', async () => {
    const result = await inspectTemplate(await workbookBase64(), '数据');
    assert.equal(result.sheetName, '数据');
    assert.equal(result.rowCount, 2);
    assert.equal(result.columnCount, 2);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.cells, [{ address: 'B2', text: '第二张表' }]);
  });

  test('拒绝非法 base64、非 xlsx 和不存在的工作表', async () => {
    await assert.rejects(() => inspectTemplate('not base64!'), (error) => {
      assertChineseError(error, /base64 格式不正确/);
      return true;
    });
    await assert.rejects(() => inspectTemplate(Buffer.from('plain text').toString('base64')), (error) => {
      assertChineseError(error, /有效的 xlsx/);
      return true;
    });
    await assert.rejects(async () => inspectTemplate(await workbookBase64(), '不存在'), (error) => {
      assertChineseError(error, /未找到工作表：不存在/);
      return true;
    });
  });

  test('文件超过 10MB 时返回 413，且不会尝试解码整个文件', async () => {
    const oversized = 'A'.repeat(Math.ceil((EXCEL_TEMPLATE_MAX_FILE_BYTES + 1) / 3) * 4);
    await assert.rejects(() => inspectTemplate(oversized), (error) => {
      assertChineseError(error, /不能超过 10MB/, 413);
      return true;
    });
  });
});

describe('Excel 模板 inspect HTTP', () => {
  let token = '';

  before(async () => {
    await startServer();
    token = await createUser('excel-template-inspector');
  });
  after(async () => {
    await stopServer();
  });

  test('inspect 不被 :id 捕获，已有模板可用 fileBase64 编辑保存', async () => {
    const fileBase64 = await workbookBase64();
    const inspected = await req('POST', '/api/reports/excel-templates/inspect', {
      token,
      body: { fileBase64, sheetName: '数据' },
    });
    assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
    assert.equal(inspected.body.sheetName, '数据');
    assert.deepEqual(inspected.body.cells, [{ address: 'B2', text: '第二张表' }]);

    const missing = await req('POST', '/api/reports/excel-templates/inspect', {
      token,
      body: { fileBase64, sheetName: '不存在' },
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, '未找到工作表：不存在');

    const created = await req('POST', '/api/reports/excel-templates', {
      token,
      body: { name: '月报', fileBase64, fieldMappings: { B2: 'student.name' }, sheetName: '数据' },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.template.id as number;

    const detail = await req('GET', `/api/reports/excel-templates/${id}`, { token });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.template.fileBase64, fileBase64);
    assert.equal(detail.body.template.fileBlob, undefined);

    const updated = await req('PUT', `/api/reports/excel-templates/${id}`, {
      token,
      body: {
        name: '月报',
        fileBase64: detail.body.template.fileBase64,
        fieldMappings: { B2: 'report.student_name' },
        sheetName: '数据',
      },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.deepEqual(updated.body.template.fieldMappings, { B2: 'report.student_name' });

    const list = await req('GET', '/api/reports/excel-templates', { token });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.templates.length, 1);
  });

  test('模板导出使用真实学生联系方式，并拒绝未知静态与循环字段', async () => {
    const student = await createStudent(token, {
      name: '可视化学生',
      phone: '13800138000',
      notes: '需要加强错题复盘',
    });
    const reportResponse = await req('POST', '/api/reports', {
      token,
      body: { studentId: student.id, yearMonth: '2026-11', term: '秋季' },
    });
    assert.equal(reportResponse.status, 200, JSON.stringify(reportResponse.body));
    const reportId = reportResponse.body.report.id as number;
    const fileBase64 = await workbookBase64();

    const created = await req('POST', '/api/reports/excel-templates', {
      token,
      body: {
        name: '学生信息模板',
        fileBase64,
        sheetName: 'Report',
        fieldMappings: {
          A1: 'student.phone',
          B2: 'student.notes',
          D4: 'report.student_name',
        },
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const templateId = created.body.template.id as number;
    const generated = await fetch(url(`/api/reports/${reportId}/excel-templates/${templateId}/generate`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(generated.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await generated.arrayBuffer()) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Report')!;
    assert.equal(sheet.getCell('A1').text, '13800138000');
    assert.equal(sheet.getCell('B2').text, '需要加强错题复盘');
    assert.equal(sheet.getCell('D4').text, '可视化学生');

    const unknown = await req('POST', '/api/reports/excel-templates', {
      token,
      body: {
        name: '未知字段模板',
        fileBase64,
        sheetName: 'Report',
        fieldMappings: { A1: 'student.not_a_field' },
      },
    });
    assert.equal(unknown.status, 400, JSON.stringify(unknown.body));
    assert.match(unknown.body.error, /A1.*未知字段/);

    const invalidCell = await req('POST', '/api/reports/excel-templates', {
      token,
      body: { name: '非法单元格', fileBase64, sheetName: 'Report', fieldMappings: { XFE1: 'student.name' } },
    });
    assert.equal(invalidCell.status, 400);
    assert.match(invalidCell.body.error, /XFE1/);

    const invalidWorkbook = await req('POST', '/api/reports/excel-templates', {
      token,
      body: {
        name: '坏工作簿',
        fileBase64: Buffer.from('not a workbook').toString('base64'),
        sheetName: 'Report',
        fieldMappings: { A1: 'student.name' },
      },
    });
    assert.equal(invalidWorkbook.status, 400);
    assert.match(invalidWorkbook.body.error, /有效的 xlsx/);

    // 模拟校验前移之前已经存在的历史脏数据，导出仍必须兜底拒绝。
    db.prepare('UPDATE excel_templates SET field_mappings = ? WHERE id = ? AND user_id = (SELECT id FROM users WHERE username = ?)')
      .run(JSON.stringify({ A1: 'student.not_a_field' }), templateId, 'excel-template-inspector');
    const rejected = await req('POST', `/api/reports/${reportId}/excel-templates/${templateId}/generate`, { token });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /A1.*未知字段.*student\.not_a_field/);

    const badLoop = await req('PUT', `/api/reports/excel-templates/${templateId}`, {
      token,
      body: {
        name: '未知字段模板',
        fileBase64,
        sheetName: 'Report',
        fieldMappings: { A1: 'loop:report_items->not_a_field' },
      },
    });
    assert.equal(badLoop.status, 400, JSON.stringify(badLoop.body));
    assert.match(badLoop.body.error, /A1.*未知字段/);

    db.prepare('UPDATE excel_templates SET field_mappings = ? WHERE id = ?')
      .run(JSON.stringify({ A1: 'loop:report_items->not_a_field' }), templateId);
    const rejectedLoop = await req('POST', `/api/reports/${reportId}/excel-templates/${templateId}/generate`, { token });
    assert.equal(rejectedLoop.status, 400);
    assert.match(rejectedLoop.body.error, /A1.*未知字段.*loop:report_items/);
  });
});
