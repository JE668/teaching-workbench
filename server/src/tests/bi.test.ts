import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUserSession } from './helpers.js';
import { randomUUID } from 'node:crypto';

function uniqueName() { return 'bi-' + randomUUID().slice(0, 8); }

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

// ============ file-types ============

test('BI /api/bi/file-types：登录用户可获取文件类型注册表', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('GET', '/api/bi/file-types', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.fileTypes));
  assert.equal(res.body.fileTypes.length, 8);
  for (const ft of res.body.fileTypes) {
    assert.ok(ft.file_type);
    assert.ok(ft.display_name);
    assert.equal(typeof ft.enabled, 'number');
  }
  const voucher = res.body.fileTypes.find((f: { file_type: string }) => f.file_type === 'voucher');
  assert.ok(voucher);
  assert.equal(voucher.enabled, 1);
});

test('BI /api/bi/file-types：未登录返回 401', async () => {
  const res = await req('GET', '/api/bi/file-types');
  assert.equal(res.status, 401);
});

// ============ batches ============

test('BI /api/bi/batches：登录用户可查看批次列表', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('GET', '/api/bi/batches', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.batches));
});

// ============ indicator_overrides ============

test('BI /api/bi/indicator-overrides：CRUD 完整流程', async () => {
  const { token } = await createUserSession(uniqueName());

  // 1. 创建
  const createRes = await req('POST', '/api/bi/indicator-overrides', {
    token,
    body: {
      scope: 'teacher',
      key_type: 'teacher_no',
      key_value: 'T0001',
      indicator: 'xusheng',
      override_value: 'no',
      reason: '测试覆盖规则',
    },
  });
  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.override.id);
  assert.equal(createRes.body.override.scope, 'teacher');
  assert.equal(createRes.body.override.override_value, 'no');
  const overrideId = createRes.body.override.id;

  // 2. 列表
  const listRes = await req('GET', '/api/bi/indicator-overrides', { token });
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listRes.body.overrides));
  assert.ok(listRes.body.overrides.some((r: { id: number }) => r.id === overrideId));

  // 3. 更新
  const updateRes = await req('PATCH', `/api/bi/indicator-overrides/${overrideId}`, {
    token,
    body: { override_value: 'yes', reason: '改为按是处理' },
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.override.override_value, 'yes');

  // 4. 删除
  const deleteRes = await req('DELETE', `/api/bi/indicator-overrides/${overrideId}`, { token });
  assert.equal(deleteRes.status, 200);

  // 5. 确认删除成功
  const listAfter = await req('GET', '/api/bi/indicator-overrides', { token });
  assert.ok(!listAfter.body.overrides.some((r: { id: number }) => r.id === overrideId));
});

test('BI /api/bi/indicator-overrides：创建缺少必填字段返回 400', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('POST', '/api/bi/indicator-overrides', {
    token,
    body: { scope: 'teacher' }, // 缺 key_type 等
  });
  assert.equal(res.status, 400);
});

// ============ incentive_settings ============

test('BI /api/bi/incentive-settings：CRUD 完整流程', async () => {
  const { token } = await createUserSession(uniqueName());

  // 1. 创建
  const createRes = await req('POST', '/api/bi/incentive-settings', {
    token,
    body: {
      scope: 'branch_company',
      scope_value: '中山分公司',
      target_rate: 85,
      effective_from: '2026-12-01',
    },
  });
  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.setting.id);
  assert.equal(createRes.body.setting.target_rate, 85);
  const settingId = createRes.body.setting.id;

  // 2. 列表
  const listRes = await req('GET', '/api/bi/incentive-settings', { token });
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listRes.body.settings));

  // 3. 更新
  const updateRes = await req('PATCH', `/api/bi/incentive-settings/${settingId}`, {
    token,
    body: { target_rate: 90 },
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.setting.target_rate, 90);

  // 4. 删除
  const deleteRes = await req('DELETE', `/api/bi/incentive-settings/${settingId}`, { token });
  assert.equal(deleteRes.status, 200);
});

// ============ metrics API ============

test('BI /api/bi/metrics/xuke-rates：返回空数组（无数据时）', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('GET', '/api/bi/metrics/xuke-rates', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.rows));
});

test('BI /api/bi/metrics/xusheng-rates：返回空数组（无数据时）', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('GET', '/api/bi/metrics/xusheng-rates', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.rows));
});

test('BI /api/bi/metrics/presale：返回空数组（无数据时）', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('GET', '/api/bi/metrics/presale', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.rows));
});

test('BI /api/bi/metrics/months/xuke_detail：返回数组', async () => {
  const { token } = await createUserSession(uniqueName());
  const res = await req('GET', '/api/bi/metrics/months/xuke_detail', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.months));
});

test('BI /api/bi/metrics：未登录返回 401', async () => {
  const res = await req('GET', '/api/bi/metrics/xuke-rates');
  assert.equal(res.status, 401);
});
