import ExcelJS from 'exceljs';
import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBiXlsx,
  xukeRowsToBi,
  xushengRowsToBi,
  presaleRowsToBi,
  incentiveRowsToBi,
  monthlyReportToBi,
} from '../utils/biExcel.js';

async function loadFirstSheet(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  return wb.worksheets[0]!;
}

describe('biExcel 导出', () => {
  test('buildBiXlsx：标题 + 表头 + 明细', async () => {
    const buf = await buildBiXlsx({
      title: '测试报表',
      headers: ['名称', '数值'],
      rows: [['A', 1], ['B', 2]],
      colWidths: [20, 10],
      filename: 'test.xlsx',
    });
    assert.ok(buf.length > 0);
    const ws = await loadFirstSheet(buf);
    assert.equal(ws.getCell('A1').value, '测试报表');
    assert.equal(ws.getCell('A2').value, '名称');
    assert.equal(ws.getCell('B2').value, '数值');
    assert.equal(ws.getCell('A3').value, 'A');
    assert.equal(ws.getCell('B3').value, 1);
  });

  test('xukeRowsToBi：老师维度', () => {
    const input = xukeRowsToBi({
      title: 't',
      groupBy: 'teacher',
      rows: [
        { teacher_no: 'T1', teacher_name: '张老师', subject_group: '数学组', base_count: 10, renewed_count: 8, rate: 80 },
      ],
    });
    assert.deepEqual(input.headers, ['老师', '基数', '续科数', '续科率']);
    assert.deepEqual(input.rows[0], ['张老师', 10, 8, '80.0%']);
  });

  test('xukeRowsToBi：科组维度', () => {
    const input = xukeRowsToBi({
      title: 't',
      groupBy: 'subject_group',
      rows: [
        { teacher_no: '', teacher_name: '', subject_group: '数学组', base_count: 20, renewed_count: 15, rate: 75 },
      ],
    });
    assert.deepEqual(input.headers, ['科组', '基数', '续科数', '续科率']);
    assert.equal(input.rows[0][0], '数学组');
  });

  test('xushengRowsToBi', () => {
    const input = xushengRowsToBi({
      title: 't',
      rows: [{ mentor_name: '李学管', base_count: 20, renewed_count: 16, rate: 80 }],
    });
    assert.deepEqual(input.headers, ['学管师', '基数', '续生数', '续生率']);
    assert.deepEqual(input.rows[0], ['李学管', 20, 16, '80.0%']);
  });

  test('presaleRowsToBi', () => {
    const input = presaleRowsToBi({
      title: 't',
      rows: [{ branch_company: '小榄分公司', learning_center: '龙山校区', valid_voucher_count: 20, presale_student_count: 25, total_amount: 50000 }],
    });
    assert.deepEqual(input.headers, ['分公司', '校区', '有效券数', '预存学生数', '总金额（元）']);
    assert.equal(input.rows[0][4], 50000);
  });

  test('incentiveRowsToBi', () => {
    const input = incentiveRowsToBi({
      title: 't',
      rows: [{ scope: 'mentor', scope_value: '李学管', target_rate: 80, base_count: 20, target_count: 16, renewed_count: 13, gap: 3 }],
    });
    assert.equal(input.rows[0][0], '学管师');
    assert.equal(input.rows[0][2], '80%');
    assert.equal(input.rows[0][6], 3);
  });

  test('monthlyReportToBi', () => {
    const input = monthlyReportToBi({
      month: '2026-11',
      xuke: { total_base: 100, total_renewed: 80, overall_rate: 80, teacher_count: 12 },
      xusheng: { total_base: 50, total_renewed: 40, overall_rate: 80, mentor_count: 6 },
      presale: { total_vouchers: 20, total_students: 25, total_amount: 50000, learning_center_count: 2 },
      incentive: { entries: 4, total_gap: 3 },
    });
    assert.match(input.title, /2026-11/);
    assert.equal(input.rows.length, 4);
    assert.equal(input.rows[0][3], '80.0%');
  });
});
