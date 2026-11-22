import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseManagerPerf } from '../renewal/parser.js';

const fixturePath = fileURLToPath(new URL('./fixtures/renewal-template.xlsx', import.meta.url));

test('学管业绩只解析真实模板主表，在主表合计处停止', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fixturePath);

  const rows = parseManagerPerf(workbook);
  const worksheet = workbook.getWorksheet('学管业绩统计表');
  assert.ok(worksheet);
  const expectedManagerNames = Array.from({ length: 6 }, (_, index) =>
    String(worksheet.getRow(index + 5).getCell(1).value),
  );

  assert.deepEqual(rows.map((row) => row.sourceRow), [5, 6, 7, 8, 9, 10]);
  assert.deepEqual(rows.map((row) => row.managerName), expectedManagerNames);
  assert.equal(new Set(rows.map((row) => row.managerName)).size, 6);
  assert.ok(rows.every((row) => !['年级-续生率统计', '学管均单统计', '学管', '按系统数据'].includes(row.managerName)));
});

test('学管业绩在学习中心汇总行停止，并跳过主表内空行', () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('学管业绩统计表');
  worksheet.getCell('A5').value = '学管甲';
  worksheet.getCell('A7').value = '学管乙';
  worksheet.getCell('A8').value = '学习中心';
  worksheet.getCell('A9').value = '年级-续生率统计';

  const rows = parseManagerPerf(workbook);

  assert.deepEqual(rows.map((row) => row.managerName), ['学管甲', '学管乙']);
  assert.deepEqual(rows.map((row) => row.sourceRow), [5, 7]);
});
