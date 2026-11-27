import './setup.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import express from 'express';
import { initRenewalDb, renewalDb } from '../renewal/db.js';
import renewalRoutes from '../renewal/renewalRoutes.js';
import { saveManagerTargets } from '../renewal/managerTargetService.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { log } from '../utils/logger.js';

const USER_A = 42;
const USER_B = 43;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as AuthenticatedRequest).userId = Number(req.header('x-test-user-id') ?? USER_A);
  next();
});
app.use('/api/renewal', renewalRoutes);

let server: Server;
let baseUrl: string;
initRenewalDb();
initRenewalDb(); // 新表及索引必须可重复初始化。

before(async () => {
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

beforeEach(() => {
  renewalDb.exec(`
    DELETE FROM renewal_manager_target;
    DELETE FROM manager_perf;
    DELETE FROM renewal_report;
  `);
});

function insertReport(uploadedBy = USER_A): number {
  const result = renewalDb.prepare(`
    INSERT INTO renewal_report
      (file_name, file_size, stat_month, center_name, row_count, error_count, status, uploaded_by)
    VALUES ('manager-targets.xlsx', 100, '2026-11', '中心A', 1, 0, 'committed', ?)
  `).run(uploadedBy);
  return Number(result.lastInsertRowid);
}

function insertManager(reportId: number, options: {
  managerName?: string;
  taskAmount?: number | null;
  cashflowTotal?: number | null;
  completionRate?: number | null;
  products?: boolean;
} = {}): void {
  const products = options.products !== false;
  renewalDb.prepare(`
    INSERT INTO manager_perf (
      report_id, manager_name,
      renew_1v1, renew_1vN, renew_small, renew_other, renew_total,
      newsign_1v1, newsign_1vN, newsign_small, newsign_other, newsign_total,
      task_amount, cashflow_total, completion_rate, actual_students
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10)
  `).run(
    reportId,
    options.managerName ?? '王芳',
    products ? 100 : null,
    products ? 20 : null,
    products ? 10 : null,
    null,
    products ? 130 : null,
    products ? 50 : null,
    null,
    products ? 5 : null,
    products ? 7 : null,
    products ? 62 : null,
    options.taskAmount === undefined ? 1000 : options.taskAmount,
    options.cashflowTotal === undefined ? 777 : options.cashflowTotal,
    options.completionRate === undefined ? 12.34 : options.completionRate,
  );
}

async function request(method: string, path: string, body?: unknown, userId = USER_A): Promise<{
  status: number;
  body: any;
}> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user-id': String(userId),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function rowOf(body: any, managerName = '王芳'): any {
  const row = body.rows.find((item: any) => item.managerName === managerName);
  assert(row, `missing manager ${managerName}: ${JSON.stringify(body)}`);
  return row;
}

test('manager-perf 返回四产品续费+新签、真实总额及基于有效任务的完成率', async () => {
  const reportId = insertReport();
  insertManager(reportId);
  insertManager(reportId, { managerName: '无分项', taskAmount: null, cashflowTotal: 100, products: false });

  const response = await request('GET', `/api/renewal/analytics/manager-perf?reportId=${reportId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.reportId, reportId);
  const row = rowOf(response.body);
  assert.deepEqual(row.productCashflow, {
    one2one: 150,
    one2many: 20,
    small: 15,
    other: 7,
    total: 777,
  });
  assert.notEqual(row.productCashflow.total, 192); // 不用分项之和覆盖真实 cashflow_total。
  assert.equal(row.taskAmount, 1000);
  assert.equal(row.importedTaskAmount, 1000);
  assert.equal(row.importedTargetAmount, 1000);
  assert.equal(row.completionRate, 77.7);
  assert.equal(row.gap80, 23); // 有效任务 × 80% - 真实现金流。
  assert.deepEqual(row.productTargets, { one2one: null, one2many: null, small: null, other: null });

  const empty = rowOf(response.body, '无分项');
  assert.deepEqual(empty.productCashflow, {
    one2one: null,
    one2many: null,
    small: null,
    other: null,
    total: 100,
  });
  assert.equal(empty.completionRate, 12.34); // 无任务额时兼容 Excel 直接导入的完成率。
  assert.equal(empty.gap80, null);
});

test('PUT 批量持久化覆盖、返回合并行，并支持逐字段与全部重置', async () => {
  const reportId = insertReport();
  insertManager(reportId);
  insertManager(reportId, { managerName: '李雷', taskAmount: 500, cashflowTotal: 250 });

  const saved = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [
      {
        managerName: '王芳',
        targetAmount: 2000,
        productTargets: { one2one: 300, one2many: 0, small: 400, other: null },
      },
      { managerName: '李雷', targetAmount: 0 },
    ],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const savedRow = rowOf(saved.body);
  assert.equal(savedRow.taskAmount, 2000);
  assert.equal(savedRow.importedTaskAmount, 1000);
  assert.equal(savedRow.completionRate, 38.85);
  assert.equal(savedRow.gap80, 823);
  assert.deepEqual(savedRow.productTargets, { one2one: 300, one2many: 0, small: 400, other: null });
  assert.equal(savedRow.productCashflow.total, 777);
  assert.equal(rowOf(saved.body, '李雷').taskAmount, 0);
  assert.equal(rowOf(saved.body, '李雷').completionRate, null);

  const read = await request('GET', `/api/renewal/analytics/manager-targets?reportId=${reportId}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, saved.body);

  const partial = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [{ managerName: '王芳', productTargets: { one2one: 500 } }],
  });
  assert.equal(partial.status, 200);
  assert.equal(rowOf(partial.body).taskAmount, 2000); // 未传字段保留。
  assert.deepEqual(rowOf(partial.body).productTargets, {
    one2one: 500, one2many: 0, small: 400, other: null,
  });

  const resetTotal = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [{ managerName: '王芳', targetAmount: null }],
  });
  assert.equal(rowOf(resetTotal.body).taskAmount, 1000);
  assert.equal(rowOf(resetTotal.body).productTargets.one2one, 500);

  const resetAll = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [
      { managerName: '王芳', targetAmount: null, productTargets: null },
      { managerName: '李雷', targetAmount: null, productTargets: null },
    ],
  });
  assert.equal(resetAll.status, 200);
  assert.equal(rowOf(resetAll.body).taskAmount, 1000);
  assert.deepEqual(rowOf(resetAll.body).productTargets, {
    one2one: null, one2many: null, small: null, other: null,
  });
  assert.equal(rowOf(resetAll.body, '李雷').taskAmount, 500);
  const remaining = renewalDb.prepare(
    'SELECT COUNT(*) AS count FROM renewal_manager_target WHERE report_id = ?',
  ).get(reportId) as { count: number };
  assert.equal(remaining.count, 0);
});

test('目标任务按 report+user+manager 隔离，非本人和不存在报表统一 404', async () => {
  const reportA = insertReport(USER_A);
  const reportB = insertReport(USER_B);
  insertManager(reportA);
  insertManager(reportB, { taskAmount: 800, cashflowTotal: 400 });

  const saved = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId: reportA,
    targets: [{ managerName: '王芳', targetAmount: 2000, productTargets: { small: 300 } }],
  });
  assert.equal(saved.status, 200);
  // 即使库中被写入同报表另一用户的设置，当前用户也只读自己的覆盖。
  renewalDb.prepare(`
    INSERT INTO renewal_manager_target (report_id, user_id, manager_name, target_amount)
    VALUES (?, ?, '王芳', 9999)
  `).run(reportA, USER_B);

  const own = await request('GET', `/api/renewal/analytics/manager-perf?reportId=${reportA}`);
  assert.equal(rowOf(own.body).taskAmount, 2000);
  const otherOwn = await request(
    'GET', `/api/renewal/analytics/manager-perf?reportId=${reportB}`, undefined, USER_B,
  );
  assert.equal(rowOf(otherOwn.body).taskAmount, 800);
  assert.equal(rowOf(otherOwn.body).productTargets.small, null);

  for (const path of [
    `/api/renewal/analytics/manager-perf?reportId=${reportA}`,
    `/api/renewal/analytics/manager-targets?reportId=${reportA}`,
    `/api/renewal/analytics/manager-targets?reportId=999999`,
  ]) {
    const denied = await request('GET', path, undefined, USER_B);
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: '还没有上传任何续费统计表' });
  }
  for (const reportId of [reportA, 999999]) {
    const denied = await request('PUT', '/api/renewal/analytics/manager-targets', {
      reportId,
      targets: [{ managerName: '王芳', targetAmount: 1 }],
    }, USER_B);
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: '报表批次不存在' });
  }
});

test('未知学管使整批回滚，坏 reportId、数值、产品键和重复学管均为 400', async () => {
  const reportId = insertReport();
  insertManager(reportId);
  insertManager(reportId, { managerName: '李雷', taskAmount: 500 });
  const initial = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [{ managerName: '王芳', targetAmount: 1500 }],
  });
  assert.equal(initial.status, 200);

  const unknown = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [
      { managerName: '李雷', targetAmount: 900 },
      { managerName: '不存在的人', targetAmount: 100 },
    ],
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /不属于该报表/);
  const afterUnknown = await request('GET', `/api/renewal/analytics/manager-perf?reportId=${reportId}`);
  assert.equal(rowOf(afterUnknown.body).taskAmount, 1500);
  assert.equal(rowOf(afterUnknown.body, '李雷').taskAmount, 500);

  assert.throws(() => saveManagerTargets(null, USER_A), /请求体/);

  const invalidBodies: unknown[] = [
    {},
    { reportId: 0, targets: [{ managerName: '王芳', targetAmount: 1 }] },
    { reportId: -1, targets: [{ managerName: '王芳', targetAmount: 1 }] },
    { reportId: 1.5, targets: [{ managerName: '王芳', targetAmount: 1 }] },
    { reportId: String(reportId), targets: [{ managerName: '王芳', targetAmount: 1 }] },
    { reportId, targets: [] },
    { reportId, targets: {} },
    { reportId, targets: [null] },
    { reportId, targets: [{ managerName: '', targetAmount: 1 }] },
    { reportId, targets: [{ managerName: '王芳' }] },
    { reportId, targets: [{ managerName: '王芳', targetAmount: -1 }] },
    { reportId, targets: [{ managerName: '王芳', targetAmount: '1' }] },
    { reportId, targets: [{ managerName: '王芳', productTargets: [] }] },
    { reportId, targets: [{ managerName: '王芳', productTargets: { unknown: 1 } }] },
    { reportId, targets: [{ managerName: '王芳', productTargets: { one2one: -1 } }] },
    { reportId, targets: [{ managerName: '王芳', productTargets: { small: '0' } }] },
    { reportId, targets: [
      { managerName: '王芳', targetAmount: 1 },
      { managerName: '王芳', targetAmount: 2 },
    ] },
    { reportId, targets: [{ managerName: '王芳', targetAmount: 1 }], extra: true },
  ];
  for (const body of invalidBodies) {
    const response = await request('PUT', '/api/renewal/analytics/manager-targets', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.body.error, 'string');
  }

  const overflow = await fetch(baseUrl + '/api/renewal/analytics/manager-targets', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-user-id': String(USER_A) },
    body: `{"reportId":${reportId},"targets":[{"managerName":"王芳","targetAmount":1e400}]}`,
  });
  assert.equal(overflow.status, 400); // JSON 可解析出 Infinity，仍必须按非有限数拒绝。

  const unchanged = await request('GET', `/api/renewal/analytics/manager-perf?reportId=${reportId}`);
  assert.equal(rowOf(unchanged.body).taskAmount, 1500);
});

test('无效用户身份返回 401，未知数据库异常返回固定 500 且不泄露细节', async t => {
  const reportId = insertReport();
  insertManager(reportId);
  const unauthenticated = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [{ managerName: '王芳', targetAmount: 1 }],
  }, 0);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(unauthenticated.body, { error: '用户身份无效' });

  t.mock.method(log, 'error', () => {});
  t.mock.method(renewalDb, 'prepare', () => {
    throw new Error('sensitive manager target database detail');
  });
  const failed = await request('PUT', '/api/renewal/analytics/manager-targets', {
    reportId,
    targets: [{ managerName: '王芳', targetAmount: 1 }],
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: '保存学管任务失败' });
  assert(!JSON.stringify(failed.body).includes('sensitive manager target database detail'));
});
