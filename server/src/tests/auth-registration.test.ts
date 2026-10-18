import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, url, createUser } from './helpers.js';
import { env } from '../config/env.js';
import { registrationInfo } from '../routes/auth.js';

/**
 * 注册名额：默认 MAX_USERS=2，名额用完后注册自动关闭。
 *
 * 注意：管理员账号由建库时自动创建，已经占掉一个名额。
 */

let savedMax: number;

before(async () => {
  await startServer();
  savedMax = env.MAX_USERS;
});

after(async () => {
  env.MAX_USERS = savedMax;
  await stopServer();
});

beforeEach(() => {
  // 每个用例只改 MAX_USERS，用完恢复，避免串味
  env.MAX_USERS = savedMax;
});

test('GET /auth/status 公开返回名额信息（无需登录）', async () => {
  env.MAX_USERS = 2;

  const res = await fetch(url('/api/auth/status'));
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.maxUsers, 2);
  assert.equal(typeof body.registerEnabled, 'boolean');
  assert.ok(body.userCount >= 1, '管理员账号已占一个名额');
});

test('名额用完后注册返回 403，并给出可读原因', async () => {
  env.MAX_USERS = 1; // admin 已占 1 个，名额用完

  const status = await (await fetch(url('/api/auth/status'))).json();
  assert.equal(status.registerEnabled, false);

  const res = await fetch(url('/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'second-teacher', password: 'passw0rd' }),
  });
  assert.equal(res.status, 403);

  const body = await res.json();
  assert.match(body.error, /注册已关闭/);
});

test('名额用完后登录不受影响', async () => {
  env.MAX_USERS = 1; // 注册已关闭

  const res = await fetch(url('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-pass-123456' }),
  });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
});

test('名额未满时可以正常注册', async () => {
  env.MAX_USERS = 10;

  const token = await createUser('third-teacher');
  assert.ok(token);

  const status = await (await fetch(url('/api/auth/status'))).json();
  assert.equal(status.registerEnabled, true);
});

test('MAX_USERS=0 表示完全关闭注册', () => {
  env.MAX_USERS = 0;
  assert.equal(registrationInfo().registerEnabled, false);
});

test('MAX_USERS 为负数表示不限（仅测试环境使用）', () => {
  env.MAX_USERS = -1;
  assert.equal(registrationInfo().registerEnabled, true);
});

test('名额恰好等于人数时关闭（不允许恰好等于时再进）', async () => {
  // 以当前实际人数动态设名额，不依赖前面用例的执行顺序
  env.MAX_USERS = registrationInfo().userCount + 1;

  await createUser('edge-teacher');

  const status = await (await fetch(url('/api/auth/status'))).json();
  assert.equal(status.userCount, env.MAX_USERS);
  assert.equal(status.registerEnabled, false);
});
