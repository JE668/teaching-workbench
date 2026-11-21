import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import { TemplateEngine, type ExcelTemplate, type ReportData } from '../services/excel/templateEngine.js';

function reportData(overrides: Partial<ReportData['report']> = {}): ReportData {
  return {
    report: {
      id: 1, student_id: 2, student_name: '张 <&>', year_month: '2026-11', term: '秋季',
      grade: '初二', subject: '数学', summary_enabled: 1, plan_enabled: 0,
      summary_intro: '总结内容', plan_intro: '规划内容', farewell: '无规划时显示',
      created_at: '2026-11-01', updated_at: '2026-11-20', ...overrides,
    },
    student: { id: 2, name: '张 <&>', grade: '初二', subject: '数学', phone: null, notes: null },
    items: [
      { id: 1, report_id: 1, kind: 'summary', seq: 1, content: '函数基础', type: '', score: '', difficulty: '', scheduled_at: '', attendance: '', notes_done: '', mistakes_done: '', homework_done: '', exam: '', sort: 1, course_id: null },
      { id: 2, report_id: 1, kind: 'summary', seq: 2, content: '方程提高', type: '', score: '', difficulty: '', scheduled_at: '', attendance: '', notes_done: '', mistakes_done: '', homework_done: '', exam: '', sort: 2, course_id: null },
      { id: 3, report_id: 1, kind: 'plan', seq: 3, content: '不应出现', type: '', score: '', difficulty: '', scheduled_at: '', attendance: '', notes_done: '', mistakes_done: '', homework_done: '', exam: '', sort: 3, course_id: null },
    ],
  };
}

async function makeTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.getCell('A1').value = '旧姓名';
  sheet.getCell('C1').value = { formula: '1+1', result: 2 };
  sheet.getCell('A2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"甲,乙"'] };
  sheet.addConditionalFormatting({ ref: 'A1:A5', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [0], priority: 1 }] });
  sheet.getCell('A3').value = '循环模板';
  sheet.getCell('A3').font = { bold: true, color: { argb: 'FFFF0000' } };
  sheet.getCell('B3').font = { italic: true };
  const data = workbook.addWorksheet('PivotData');
  data.getCell('A1').value = '透视源数据';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function engine(fileBlob: Buffer): TemplateEngine {
  const template: ExcelTemplate = {
    id: 1, userId: 1, name: '保真模板', fileBlob, sheetName: 'Report',
    fieldMappings: {
      A1: 'student.name',
      B1: 'if:report.summary_enabled=1->report.summary_intro',
      B2: 'if:report.plan_enabled=1->report.plan_intro:report.farewell',
      A3: 'loop:report_items[kind=summary]->content',
    },
    createdAt: '', updatedAt: '',
  };
  return new TemplateEngine(template);
}

test('模板导出支持静态/循环/条件映射并保留公式、样式和其他工作表', async () => {
  const output = await engine(await makeTemplate()).generate(reportData());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output as unknown as ArrayBuffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Report', 'PivotData']);
  const sheet = workbook.getWorksheet('Report')!;
  assert.equal(sheet.getCell('A1').text, '张 <&>');
  assert.equal(sheet.getCell('B1').text, '总结内容');
  assert.equal(sheet.getCell('B2').text, '无规划时显示');
  assert.equal(sheet.getCell('A3').text, '函数基础');
  assert.equal(sheet.getCell('A4').text, '方程提高');
  assert.equal(sheet.getCell('A4').font.bold, true);
  assert.equal(sheet.getCell('A4').font.color?.argb, 'FFFF0000');
  assert.equal(sheet.getCell('B4').font.italic, true);
  assert.equal(sheet.getCell('C1').text, '2');
  assert.equal((sheet.getCell('C1').value as ExcelJS.CellFormulaValue).formula, '1+1');
  assert.equal(workbook.getWorksheet('PivotData')!.getCell('A1').text, '透视源数据');
});

test('模板导出原样保留透视表、缓存、媒体和自定义扩展部件', async () => {
  const source = await makeTemplate();
  const inputZip = await new PizZip().load(source);
  inputZip.file('xl/pivotTables/pivotTable1.xml', '<pivotTableDefinition name="Pivot1"/>');
  inputZip.file('xl/pivotCache/pivotCacheDefinition1.xml', '<pivotCacheDefinition cacheSource="worksheetSource"/>');
  inputZip.file('xl/custom/unknown-feature.xml', '<feature future="keep"><payload/></feature>');
  inputZip.file('xl/media/raw.bin', new Uint8Array([0, 1, 2, 255, 128]));
  const originalSheet2 = inputZip.file('xl/worksheets/sheet2.xml').asText();
  const originalSheet1 = inputZip.file('xl/worksheets/sheet1.xml').asText();
  assert.match(originalSheet1, /conditionalFormatting/);
  assert.match(originalSheet1, /dataValidations/);
  const templateBuffer = await inputZip.generate({ type: 'nodebuffer' });

  const output = await engine(templateBuffer).generate(reportData());
  const outputZip = await new PizZip().load(output);
  assert.equal(outputZip.file('xl/pivotTables/pivotTable1.xml').asText(), '<pivotTableDefinition name="Pivot1"/>');
  assert.equal(outputZip.file('xl/pivotCache/pivotCacheDefinition1.xml').asText(), '<pivotCacheDefinition cacheSource="worksheetSource"/>');
  assert.equal(outputZip.file('xl/custom/unknown-feature.xml').asText(), '<feature future="keep"><payload/></feature>');
  assert.deepEqual([...outputZip.file('xl/media/raw.bin').asUint8Array()], [0, 1, 2, 255, 128]);
  assert.equal(outputZip.file('xl/worksheets/sheet2.xml').asText(), originalSheet2);
  const outputSheet1 = outputZip.file('xl/worksheets/sheet1.xml').asText();
  assert.match(outputSheet1, /conditionalFormatting/);
  assert.match(outputSheet1, /dataValidations/);
  assert.match(outputSheet1, /<f>1\+1<\/f>/);
  assert.ok(outputSheet1.includes('张 &lt;&amp;&gt;'));
});

test('映射到已有公式单元格时保留公式并更新缓存值', async () => {
  const source = await makeTemplate();
  const template = new TemplateEngine({
    id: 1, userId: 1, name: '公式映射', fileBlob: source, sheetName: 'Report',
    fieldMappings: { C1: 'student.name' }, createdAt: '', updatedAt: '',
  });
  const output = await template.generate(reportData());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output as unknown as ArrayBuffer);
  const value = workbook.getWorksheet('Report')!.getCell('C1').value as ExcelJS.CellFormulaValue;
  assert.equal(value.formula, '1+1');
  assert.equal(value.result, '张 <&>');
  const outputZip = await new PizZip().load(output);
  const sheetXml = outputZip.file('xl/worksheets/sheet1.xml').asText();
  assert.match(sheetXml, /<c r="C1"[^>]*t="str"[^>]*><f>1\+1<\/f><v>张 &lt;&amp;&gt;<\/v><\/c>/);
});

test('循环扩展同步更新公式、合并、条件格式、数据验证和透视源范围', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await makeTemplate() as unknown as ArrayBuffer);
  const report = workbook.getWorksheet('Report')!;
  report.getCell('D1').value = { formula: 'SUM(A3:A3)', result: 0 };
  report.getCell('F1').value = { formula: 'IF(A3="A3:A3",SUM($A$3:$A$3),SUM(PivotData!A3:A3))', result: 0 };
  report.mergeCells('D3:E3');
  report.getCell('B3').dataValidation = { type: 'list', allowBlank: true, formulae: ['"甲,乙"'] };
  report.addConditionalFormatting({ ref: 'B3', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [0], priority: 2 }] });
  workbook.getWorksheet('PivotData')!.getCell('B1').value = { formula: 'SUM(Report!A3:A3)', result: 0 };
  const inputZip = await new PizZip().load(Buffer.from(await workbook.xlsx.writeBuffer()));
  inputZip.file('xl/pivotCache/pivotCacheDefinition1.xml', '<pivotCacheDefinition><cacheSource><worksheetSource ref="A3:A3" sheet="Report"/></cacheSource></pivotCacheDefinition>');
  inputZip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdPivot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>');
  inputZip.file('xl/pivotTables/pivotTable1.xml', '<pivotTableDefinition><location ref="A3:A3"/></pivotTableDefinition>');
  const workbookXml = inputZip.file('xl/workbook.xml').asText();
  inputZip.file('xl/workbook.xml', workbookXml.replace('</workbook>', '<definedNames><definedName name="LoopRange">Report!$A$3:$A$3</definedName></definedNames></workbook>'));
  const source = await inputZip.generate({ type: 'nodebuffer' });

  const output = await engine(source).generate(reportData());
  const outputZip = await new PizZip().load(output);
  const reportXml = outputZip.file('xl/worksheets/sheet1.xml').asText();
  const otherSheetXml = outputZip.file('xl/worksheets/sheet2.xml').asText();
  assert.match(reportXml, /<f>SUM\(A3:A4\)<\/f>/);
  assert.match(reportXml, /<f>IF\(A3=&quot;A3:A3&quot;,SUM\(\$A\$3:\$A\$4\),SUM\(PivotData!A3:A3\)\)<\/f>/);
  assert.match(reportXml, /<mergeCell ref="D3:E4"\/>/);
  assert.match(reportXml, /<conditionalFormatting sqref="B3:B4"/);
  assert.match(reportXml, /<dataValidation[^>]*sqref="B3:B4"/);
  assert.match(otherSheetXml, /<f>SUM\(Report!A3:A4\)<\/f>/);
  const pivotCacheXml = outputZip.file('xl/pivotCache/pivotCacheDefinition1.xml').asText();
  assert.match(pivotCacheXml, /<worksheetSource\b[^>]*\bref="A3:A4"/);
  assert.match(pivotCacheXml, /<worksheetSource\b[^>]*\bsheet="Report"/);
  assert.match(outputZip.file('xl/pivotTables/pivotTable1.xml').asText(), /<location ref="A3:A3"\/>/, '透视表输出位置不是数据源范围，必须保持不变');
  assert.match(outputZip.file('xl/workbook.xml').asText(), /<definedName name="LoopRange">Report!\$A\$3:\$A\$4<\/definedName>/);
});

test('目标工作表不存在时明确报错', async () => {
  const source = await makeTemplate();
  const missing = new TemplateEngine({
    id: 1, userId: 1, name: '错误工作表', fileBlob: source, sheetName: 'Missing',
    fieldMappings: { A1: 'student.name' }, createdAt: '', updatedAt: '',
  });
  await assert.rejects(() => missing.generate(reportData()), /模板中未找到工作表: Missing/);
});
