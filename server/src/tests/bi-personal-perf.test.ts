/**
 * 个人业绩统计 parser 的事实校验。
 *
 * 源文件（个人业绩统计.xlsx）是三层合并表头：
 *   - 第 1 行：标题 "个人业绩统计"
 *   - 第 3 行：个人业绩 / 直播合作业绩 / 总业绩（组标题）
 *   - 第 4 行：A-K 基础字段（集团/分公司/.../产品类型）
 *   - 第 5 行：L-X 业绩字段（新签合同业绩 / ...）
 *   - 第 6 行：空
 *   - 第 7-26 行：数据（每行 = 合同 × 产品类型）
 *   - 第 27 行：小计（必须跳过）
 *   - 第 28 行：分页信息（必须跳过）
 *
 * 入库时拍平为独立列，业绩人员括号里的工号拆出来便于关联。
 */
import './setup.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-personal-perf-'));

async function writeXlsx(name: string, rows: (string | number | null)[][]): Promise<string> {
  const p = path.join(tmpDir, name);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(p);
  return p;
}

const SAMPLE_ROWS: (string | number | null)[][] = [
  ['个人业绩统计', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, '个人业绩', null, null, null, null, '直播合作业绩', null, null, null, null, '总业绩', null, null],
  ['集团', '分公司', '学习中心', '业绩人员', '归属部门', '业绩来源', '签单人/操作人', '合同年级', '学生', '合同类型', '产品类型', null, null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, '新签合同业绩', '续费合同业绩', '收款业绩', '退费责任业绩', '总业绩', '新签业绩', '续费业绩', '新签退费责任业绩', '续费退费责任业绩', '合作总业绩', '总收款业绩', '总退费责任', '总业绩'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ['星火集团', '中山分公司', '小榄龙山学习中心', '郑淼林(X49763)', '小榄龙山学习中心', '小榄龙山学习中心', '郑淼林', '高二', '闫鎏燚', '续费合同', '一对一', 0, 500, 500, 0, 500, 0, 0, 0, 0, 0, 500, 0, 500],
  ['星火集团', '中山分公司', '小榄龙山学习中心', '郑淼林(X49763)', '小榄龙山学习中心', '小榄龙山学习中心', '郑淼林', '初二', '黄妍夕', '续费合同', '一对一', 0, 500, 500, 0, 500, 0, 0, 0, 0, 0, 500, 0, 500],
  ['星火集团', '中山分公司', '小榄龙山学习中心', '王绮雯(X139882)', '小榄龙山学习中心', '小榄龙山学习中心', '王绮雯', '初一', '周梓轩', '续费合同', '小班', 0, 5800, 5800, 0, 5800, 0, 0, 0, 0, 0, 5800, 0, 5800],
  // 小计行（必须跳过）
  [null, null, null, null, null, null, null, null, null, null, '小计(元)：', 0, 6800, 6800, 0, 6800, 0, 0, 0, 0, 0, 6800, 0, 6800],
  // 分页行（必须跳过）
  [null, null, null, null, '共 1 页', null, null, null, null, '1 - 20　共 20 条', null, null, null, null, null, null, null, null, null, null, null, null, null, null],
];

let filePath: string;

before(async () => {
  filePath = await writeXlsx('perf.xlsx', SAMPLE_ROWS);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parsePersonalPerf', () => {
  test('解析表头下数据行 + 跳过小计/分页', async () => {
    const { parsePersonalPerfDirect } = await import('../bi/parsers.js');
    const result = await parsePersonalPerfDirect(filePath);
    assert.equal(result.records.length, 3, '应有 3 条业务行（跳过小计 + 分页）');
    assert.equal(result.errors.length, 0);
    assert.ok(result.totalSourceRows >= 3);

    const first = result.records[0] as Record<string, unknown>;
    assert.equal(first['group_name'], '星火集团');
    assert.equal(first['branch_company'], '中山分公司');
    assert.equal(first['learning_center'], '小榄龙山学习中心');
    assert.equal(first['performer'], '郑淼林');
    assert.equal(first['performer_no'], 'X49763');
    assert.equal(first['contract_grade'], '高二');
    assert.equal(first['student_name'], '闫鎏燚');
    assert.equal(first['contract_type'], '续费合同');
    assert.equal(first['product_type'], '一对一');
    assert.equal(first['perf_renew'], 500);
    assert.equal(first['grand_total'], 500);
    assert.equal(first['source_row'], 7);
  });

  test('工号拆分：括号内工号单独存列', async () => {
    const { parsePersonalPerfDirect } = await import('../bi/parsers.js');
    const result = await parsePersonalPerfDirect(filePath);
    const third = result.records[2] as Record<string, unknown>;
    assert.equal(third['performer'], '王绮雯');
    assert.equal(third['performer_no'], 'X139882');
    assert.equal(third['perf_renew'], 5800);
    assert.equal(third['grand_total'], 5800);
  });

  test('computePersonalPerfStats 按业绩人员聚合', async () => {
    const { initBiDb } = await import('../bi/migrate.js');
    const { biDb } = await import('../bi/db.js');
    const { computePersonalPerfStats } = await import('../bi/metrics.js');

    initBiDb();
    // 先清空再插，保证幂等
    biDb.prepare('DELETE FROM raw_personal_perf').run();
    biDb.prepare('DELETE FROM upload_batch').run();

    const batchResult = biDb.prepare(
      "INSERT INTO upload_batch (file_type, file_name, uploaded_by, status) VALUES ('personal_perf', 'perf.xlsx', 1, 'committed')"
    ).run();
    const batchId = Number(batchResult.lastInsertRowid);

    // 插 3 条：郑淼林 2 条 + 王绮雯 1 条
    const insert = biDb.prepare(`
      INSERT INTO raw_personal_perf
        (batch_id, group_name, branch_company, learning_center, performer, performer_no,
         department, perf_source, operator, contract_grade, student_name, contract_type, product_type,
         perf_new_sign, perf_renew, perf_received, perf_refund, perf_total,
         live_new_sign, live_renew, live_new_refund, live_renew_refund, live_total,
         grand_received, grand_refund, grand_total, source_row)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const base = {
      group: '星火集团', branch: '中山分公司', center: '小榄龙山学习中心',
      dept: '小榄龙山学习中心', source: '小榄龙山学习中心',
    };
    insert.run(batchId, base.group, base.branch, base.center, '郑淼林', 'X49763',
      base.dept, base.source, '郑淼林', '高二', '闫鎏燚', '续费合同', '一对一',
      0, 500, 500, 0, 500, 0, 0, 0, 0, 0, 500, 0, 500, 7);
    insert.run(batchId, base.group, base.branch, base.center, '郑淼林', 'X49763',
      base.dept, base.source, '郑淼林', '初二', '黄妍夕', '续费合同', '一对一',
      0, 500, 500, 0, 500, 0, 0, 0, 0, 0, 500, 0, 500, 8);
    insert.run(batchId, base.group, base.branch, base.center, '王绮雯', 'X139882',
      base.dept, base.source, '王绮雯', '初一', '周梓轩', '续费合同', '小班',
      0, 5800, 5800, 0, 5800, 0, 0, 0, 0, 0, 5800, 0, 5800, 9);

    const rows = computePersonalPerfStats();
    assert.equal(rows.length, 2, '两个业绩人员');
    // 按总业绩降序：王绮雯 5800 在前
    assert.equal(rows[0]['performer'], '王绮雯');
    assert.equal(rows[0]['grand_total'], 5800);
    assert.equal(rows[0]['contract_count'], 1);
    assert.equal(rows[1]['performer'], '郑淼林');
    assert.equal(rows[1]['grand_total'], 1000);
    assert.equal(rows[1]['contract_count'], 2);
  });

  test('computePersonalPerfStats 无数据时返回空数组', async () => {
    const { biDb } = await import('../bi/db.js');
    const { computePersonalPerfStats } = await import('../bi/metrics.js');
    biDb.prepare('DELETE FROM raw_personal_perf').run();
    biDb.prepare('DELETE FROM upload_batch WHERE file_type = ?').run('personal_perf');
    const rows = computePersonalPerfStats();
    assert.equal(rows.length, 0);
  });
});
