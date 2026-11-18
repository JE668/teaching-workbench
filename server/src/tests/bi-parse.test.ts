import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ExcelJS from 'exceljs';
import { mapRows, toInt, toFloat, toStr, toYesNo } from '../bi/mappers.js';
import { parseXlsx } from '../bi/parserBase.js';
import { PARSERS } from '../bi/parsers.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-parse-'));
const filePaths: string[] = [];

async function writeXlsx(name: string, headers: string[], rows: unknown[][], sheetName?: string): Promise<string> {
  const p = path.join(tmpDir, name);
  const wb = new ExcelJS.Workbook();
  const ws = sheetName ? wb.addWorksheet(sheetName) : wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  rows.forEach(r => ws.addRow(r));
  await wb.xlsx.writeFile(p);
  filePaths.push(p);
  return p;
}

after(async () => {
  for (const p of filePaths) {
    fs.promises.unlink(p).catch(() => {});
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============ parserBase ============

test('parseXlsx: 解析表头 + 数据行 + __row_number', async () => {
  const p = await writeXlsx('simple.xlsx', ['A', 'B', 'C'], [[1, 'x', null], [2, 'y', 'z']]);
  const result = await parseXlsx(p);
  assert.equal(result.headers.join(','), 'A,B,C');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]['A'], 1);
  assert.equal(result.rows[0]['B'], 'x');
  assert.equal(result.rows[0]['C'], null);
  assert.equal(result.rows[0]['__row_number'], 2);
});

test('parseXlsx: 指定 sheetName 找不到时抛错', async () => {
  const p = await writeXlsx('named.xlsx', ['A'], [['v']]);
  await assert.rejects(() => parseXlsx(p, { sheetName: '不存在的sheet' }), /Sheet/);
});

test('parseXlsx: 空 sheet 抛错', async () => {
  const wb = new ExcelJS.Workbook();
  // 空工作簿，无 sheet
  const p = path.join(tmpDir, 'empty.xlsx');
  await wb.xlsx.writeFile(p);
  filePaths.push(p);
  await assert.rejects(() => parseXlsx(p), /没有任何 sheet/);
});

// ============ mappers: 转换器 ============

test('toInt: null/空/非数字 返回 null；数字保留', () => {
  assert.equal(toInt(null), null);
  assert.equal(toInt(''), null);
  assert.equal(toInt('abc'), null);
  assert.equal(toInt(5), 5);
  assert.equal(toInt('42'), 42);
  assert.equal(toInt(3.7), 3);
});

test('toFloat: 数字转换', () => {
  assert.equal(toFloat(null), null);
  assert.equal(toFloat('3.14'), 3.14);
  assert.equal(toFloat(2), 2);
});

test('toStr: trim + 空字符串转 null', () => {
  assert.equal(toStr(null), null);
  assert.equal(toStr('  hello  '), 'hello');
  assert.equal(toStr('   '), null);
});

test('toYesNo: 是/否/1/0/yes/no 映射', () => {
  assert.equal(toYesNo('是'), 1);
  assert.equal(toYesNo('yes'), 1);
  assert.equal(toYesNo('1'), 1);
  assert.equal(toYesNo('否'), 0);
  assert.equal(toYesNo('no'), 0);
  assert.equal(toYesNo('0'), 0);
  assert.equal(toYesNo('其他'), '其他');
});

// ============ mappers: mapRows 主流程 ============

test('mapRows: 字段映射 + 转换器 + 必填校验', async () => {
  const p = await writeXlsx('mapped.xlsx',
    ['姓名', '年龄', '余额'],
    [['Alice', 30, 100.5], ['Bob', null, null]]
  );
  const result = await mapRows(p, {
    mapping: { '姓名': 'name', '年龄': 'age', '余额': 'balance' },
    converters: { age: toInt, balance: toFloat },
    requiredFields: ['name'],
    collectExtra: false,
  });
  assert.equal(result.records.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0]['name'], 'Alice');
  assert.equal(result.records[0]['age'], 30);
  assert.equal(result.records[0]['balance'], 100.5);
  assert.equal(result.records[1]['age'], null);
  assert.equal(result.records[1]['balance'], null);
});

test('mapRows: 缺必填字段行进 errors', async () => {
  const p = await writeXlsx('required.xlsx', ['A', 'B'], [['x', 'y'], ['', 'z']]);
  const result = await mapRows(p, {
    mapping: { 'A': 'a', 'B': 'b' },
    requiredFields: ['a'],
    collectExtra: false,
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].errorCode, 'MISSING_FIELD');
  assert.ok(result.errors[0].errorMessage.includes('必填'));
});

test('mapRows: collectExtra=true 收集未映射字段', async () => {
  const p = await writeXlsx('extra.xlsx', ['A', 'B', 'C'], [['x', 'y', 'z']]);
  const result = await mapRows(p, {
    mapping: { 'A': 'a' },
    collectExtra: true,
  });
  assert.equal(result.records.length, 1);
  assert.ok(result.records[0]['extra']);
  const extra = JSON.parse(result.records[0]['extra'] as string);
  assert.equal(extra['B'], 'y');
  assert.equal(extra['C'], 'z');
});

// ============ parsers ============

test('PARSERS.xuke_detail: 解析续科率明细', async () => {
  const p = await writeXlsx('xuke.xlsx',
    ['统计月份', '老师', '老师工号', '学生', '学生ID', '年级', '学管师', '学管师工号',
     '大科组', '科组', '科目', '月初科目剩余小时', '剩余小时分段', '上月末科目状态',
     '课消产品类别', '前1个月是否上课', '前2个月是否上课', '本月是否续科',
     '续费产品类别', '续费小时', '前2个月上课学习中心', '前6个月上课学习中心'],
    [['2026-11', '张老师', 'T001', '小明', 'STU001', '高一', '李学管', 'M001',
      '理科', '数学组', '数学', 10, '5-10h', '在读',
      '1对1', '是', '是', '是',
      '1对1', 20, '龙山中心', '龙山中心']]
  );
  const parser = PARSERS['xuke_detail'];
  assert.ok(parser, 'PARSERS 里应有 xuke_detail');
  const result = await parser(p);
  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]['teacher_no'], 'T001');
  assert.equal(result.records[0]['stat_month'], '2026-11');
  assert.equal(result.records[0]['renewed_this_month'], '是');
});

test('PARSERS.voucher: 解析定金券 + 拆 student_links', async () => {
  const p = await writeXlsx('voucher.xlsx',
    ['分公司', '校区', '建券员工', '金额', '客户手机号', '建券时间', '使用状态',
     '使用/退费时间', '关联合同编号', '支付状态', '关联学生ID', '关联学生',
     '学生年级', '意向使用年级', '备注'],
    [['小榄分公司', '龙山校区', '张三', 1000, '138****0000', '2026-11-01',
      '已使用', '2026-11-05', 'CON001', '已支付', 'STU001,STU002',
      '小明,小红', '高一,高二', '高一', '']],
    '0'
  );
  const parser = PARSERS['voucher'];
  assert.ok(parser, 'PARSERS 里应有 voucher');
  const result = await parser(p);
  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 1);
  const rec = result.records[0];
  assert.equal(rec['branch_company'], '小榄分公司');
  assert.equal(rec['amount'], 1000);
  assert.ok(Array.isArray(rec['student_links']));
  const links = rec['student_links'] as Array<{ student_id: string; link_kind: string; position: number }>;
  assert.equal(links.length, 2);
  assert.equal(links[0]['student_id'], 'STU001');
  assert.equal(links[0]['position'], 1);
  assert.equal(links[1]['position'], 2);
});

test('PARSERS.xusheng_detail: 解析续生率明细', async () => {
  const p = await writeXlsx('xusheng.xlsx',
    ['月份', '学管师', '学生', '学生ID', '年级', '首次报读个性化日期', '报读时长',
     '类型', '课消产品', '上1个月是否有课消', '上2个月是否有课消', '本月是否续费',
     '续费时间', '续费产品', '续个性化金额', '续1对1金额', '续1对多金额', '续班课金额', '续费小时(正价)'],
    [['2026-11', '李学管', '小明', 'STU001', '高一', '2025-06-01', 300,
      '连续在读', '1对1', '有', '有', '是',
      '2026-11-15', '1对1', 5000, 3000, 2000, 0, 30]],
    '续生率-学生明细(实时)'
  );
  const parser = PARSERS['xusheng_detail'];
  assert.ok(parser, 'PARSERS 里应有 xusheng_detail');
  const result = await parser(p);
  assert.equal(result.errors.length, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]['student_id'], 'STU001');
  assert.equal(result.records[0]['renewed_this_month'], '是');
});
