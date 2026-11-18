import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeXukeRates, computeXushengRates, computePreSale, computeIncentive, availableMonths, computeMonthlyReport } from '../bi/metrics.js';
import { reconcilePrepaid } from '../bi/reconciliation.js';
import { biDb } from '../bi/db.js';
import { initBiDb } from '../bi/migrate.js';
import { FILE_TYPES } from '../bi/fileRegistry.js';

let batchIdXuke: number;
let batchIdXusheng: number;
let batchIdVoucher: number;

before(() => {
  initBiDb();
  // 建三个 batch
  batchIdXuke = Number(biDb.prepare(
    "INSERT INTO upload_batch (file_type, file_name, file_size, uploaded_by, status) VALUES (?, 'xuke.xlsx', 1000, 1, 'committed')"
  ).run(FILE_TYPES.XUKE_DETAIL).lastInsertRowid);

  batchIdXusheng = Number(biDb.prepare(
    "INSERT INTO upload_batch (file_type, file_name, file_size, uploaded_by, status) VALUES (?, 'xusheng.xlsx', 1000, 1, 'committed')"
  ).run(FILE_TYPES.XUSHENG_DETAIL).lastInsertRowid);

  batchIdVoucher = Number(biDb.prepare(
    "INSERT INTO upload_batch (file_type, file_name, file_size, uploaded_by, status) VALUES (?, 'voucher.xlsx', 1000, 1, 'committed')"
  ).run(FILE_TYPES.VOUCHER).lastInsertRowid);

  // 填 xuke 明细：T001 老师，4 科次，2 续科
  const stmtXuke = biDb.prepare(`
    INSERT INTO raw_xuke_detail
    (batch_id, stat_month, teacher_no, teacher_name, subject_group, student_id, student_name, mentor_name, renewed_this_month)
    VALUES (?, '2026-11', ?, ?, ?, ?, ?, ?, ?)
  `);
  stmtXuke.run(batchIdXuke, 'T001', '张老师', '数学组', 'STU001', '小明', '李学管', '是');
  stmtXuke.run(batchIdXuke, 'T001', '张老师', '数学组', 'STU001', '小明', '李学管', '是');
  stmtXuke.run(batchIdXuke, 'T001', '张老师', '数学组', 'STU002', '小红', '李学管', '否');
  stmtXuke.run(batchIdXuke, 'T001', '张老师', '语文组', 'STU003', '小刚', '王学管', '否');

  // 填 xusheng 明细：李学管管 2 学生（STU001 续费 + STU002 未续费），王学管管 1 学生（STU003 续费）
  const stmtXusheng = biDb.prepare(`
    INSERT INTO raw_xusheng_detail
    (batch_id, stat_month, mentor_name, student_id, student_name, renewed_this_month)
    VALUES (?, '2026-11', ?, ?, ?, ?)
  `);
  stmtXusheng.run(batchIdXusheng, '李学管', 'STU001', '小明', '是');
  stmtXusheng.run(batchIdXusheng, '李学管', 'STU002', '小红', '否');
  stmtXusheng.run(batchIdXusheng, '王学管', 'STU003', '小刚', '是');

  // 填 voucher + voucher_student_link（STU001 已预存）
  const vid = Number(biDb.prepare(`
    INSERT INTO raw_voucher
    (batch_id, branch_company, campus, builder_name, amount, usage_status, payment_status, customer_phone_masked, voucher_created_at)
    VALUES (?, '小榄', '龙山', '张三', 1000, '已使用', '已支付', '138****', '2026-10-01')
  `).run(batchIdVoucher).lastInsertRowid);
  biDb.prepare(`
    INSERT INTO voucher_student_link (voucher_id, student_id, student_name, link_kind, position)
    VALUES (?, 'STU001', '小明', 'real', 1)
  `).run(vid);
});

// ============ 续科率 ============

test('computeXukeRates: 老师维度（默认）', () => {
  const rows = computeXukeRates({ statMonth: '2026-11', groupBy: 'teacher' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['teacher_no'], 'T001');
  assert.equal(rows[0]['base_count'], 4);
  assert.equal(rows[0]['renewed_count'], 2);
  assert.equal(rows[0]['rate'], 50);
});

test('computeXukeRates: 科组维度', () => {
  const rows = computeXukeRates({ statMonth: '2026-11', groupBy: 'subject_group' });
  assert.equal(rows.length, 2);
  const mathRow = rows.find(r => r.subject_group === '数学组');
  assert.ok(mathRow);
  assert.equal(mathRow.base_count, 3);
  assert.equal(mathRow.renewed_count, 2);
});

test('computeXukeRates: 空数据返回 []', () => {
  const rows = computeXukeRates({ statMonth: '2099-01' });
  assert.deepEqual(rows, []);
});

// ============ 续生率 ============

test('computeXushengRates: mentor 维度 + 去重', () => {
  const rows = computeXushengRates({ statMonth: '2026-11', crossDedup: true });
  assert.equal(rows.length, 2);
  // 李学管: STU001(续) + STU002(未) = 1/2
  const li = rows.find(r => r.mentor_name === '李学管');
  assert.ok(li);
  assert.equal(li.base_count, 2);
  assert.equal(li.renewed_count, 1);
  assert.equal(li.rate, 50);
  // 王学管: STU003(续) = 1/1
  const wang = rows.find(r => r.mentor_name === '王学管');
  assert.ok(wang);
  assert.equal(wang.base_count, 1);
  assert.equal(wang.renewed_count, 1);
});

// ============ 预存 ============

test('computePreSale: voucher_student_link 聚合', () => {
  const rows = computePreSale({});
  // 龙山校区 1 张券 1 学生
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['learning_center'], '龙山');
  assert.equal(rows[0]['presale_student_count'], 1);
  assert.equal(rows[0]['valid_voucher_count'], 1);
});

// ============ 激励 ============

test('computeIncentive: 有目标配置时计算差额', () => {
  // 先插一条 incentive_settings
  biDb.prepare(`
    INSERT INTO incentive_settings (scope, scope_value, target_rate, effective_from)
    VALUES ('mentor', '李学管', 80, '2020-01-01')
  `).run();
  const rows = computeIncentive({ statMonth: '2026-11' });
  const liRow = rows.find(r => r.scope_value === '李学管');
  assert.ok(liRow);
  // ceil(2 × 80/100) = 2, 已完成 1, 差额 1
  assert.equal(liRow.target_count, 2);
  assert.equal(liRow.renewed_count, 1);
  assert.equal(liRow.gap, 1);
});

// ============ availableMonths ============

test('availableMonths: 返回 xuke_detail 的月份', () => {
  const months = availableMonths(FILE_TYPES.XUKE_DETAIL);
  assert.ok(months.includes('2026-11'));
});

// ============ 对账 ============

test('reconcilePrepaid: 定金券 vs 映射表', () => {
  // 建 teacher_student_map: STU001 已标预存
  biDb.prepare(`
    INSERT INTO teacher_student_map (teacher_no, teacher_name, student_id, student_name, is_prepaid)
    VALUES ('T001', '张老师', 'STU001', '小明', 1)
  `).run();
  // STU002 在映射表但没有预存，定金券也没有
  biDb.prepare(`
    INSERT INTO teacher_student_map (teacher_no, teacher_name, student_id, student_name, is_prepaid)
    VALUES ('T001', '张老师', 'STU002', '小红', 0)
  `).run();

  const { rows, summary } = reconcilePrepaid({});
  // STU001: 定金券有 + 映射表有 = MATCH
  const stu001 = rows.find(r => r.student_id === 'STU001');
  assert.ok(stu001);
  assert.equal(stu001.status, 'MATCH');

  // summary.total > 0
  assert.ok(summary.total >= 1);
});

// ============ 月度报表 ============

test('computeMonthlyReport: 聚合概览', () => {
  const report = computeMonthlyReport({ statMonth: '2026-11' });
  assert.ok(report.xuke.total_base >= 4);
  assert.ok(report.xusheng.total_base >= 3);
  assert.ok(report.presale.total_students >= 1);
});
