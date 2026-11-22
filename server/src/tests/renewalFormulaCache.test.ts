import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseManagerPerf } from '../renewal/parser.js';

test('续费解析保留公式缓存数值 0，并区分无缓存与非零结果', async () => {
  const source = new ExcelJS.Workbook();
  const worksheet = source.addWorksheet('学管业绩统计表');
  worksheet.getCell('A5').value = '学管甲';
  worksheet.getCell('B5').value = { formula: '1-1', result: 1 };
  // ExcelJS 4.4.0 的 FormulaValue setter/getter 会丢弃 0；直接设置底层模型，
  // 模拟 Excel 文件中真实存在的 <f>1-1</f><v>0</v> 缓存。
  worksheet.getCell('B5').model.result = 0;
  worksheet.getCell('C5').value = { formula: '1+1', result: 2 };
  worksheet.getCell('D5').value = { formula: '1+2' };
  worksheet.getCell('A11').value = '合计';

  const buffer = await source.xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const zeroCell = workbook.getWorksheet('学管业绩统计表')!.getCell('B5');
  assert.equal(zeroCell.model.result, 0, '夹具必须包含真实的 0 缓存');
  assert.equal(
    Object.prototype.hasOwnProperty.call(zeroCell.value, 'result'),
    false,
    '夹具必须复现 ExcelJS getter 丢失 0 的行为',
  );

  const rows = parseManagerPerf(workbook);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.renew.one2one, 0, '数值 0 是有效统计值，不是空值');
  assert.equal(rows[0]!.renew.one2many, 2, '非零公式缓存保持不变');
  assert.equal(rows[0]!.renew.small, null, '没有公式缓存时仍返回 null');
});
