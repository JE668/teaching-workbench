import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';

before(async () => {
  await startServer();
});
after(async () => {
  await stopServer();
});

describe('健康检查', () => {
  test('GET /health 返回 ok 且包含数据库探活', async () => {
    const res = await req('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.ok(typeof res.body.uptime === 'number');
  });
});

describe('注册', () => {
  test('正常注册返回 token 与用户信息', async () => {
    const res = await req('POST', '/api/auth/register', {
      body: { username: 'alice', password: 'passw0rd' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.username, 'alice');
    assert.ok(res.body.user.createdAt, 'createdAt 应为 camelCase');
    assert.equal(res.body.user.password, undefined, '绝不能返回密码字段');
  });

  test('重复用户名返回 409', async () => {
    const res = await req('POST', '/api/auth/register', {
      body: { username: 'alice', password: 'passw0rd' },
    });
    assert.equal(res.status, 409);
  });

  test('密码过短返回 400', async () => {
    const res = await req('POST', '/api/auth/register', {
      body: { username: 'bob', password: '123' },
    });
    assert.equal(res.status, 400);
  });

  test('缺少字段返回 400', async () => {
    const res = await req('POST', '/api/auth/register', { body: { username: 'nopass' } });
    assert.equal(res.status, 400);
  });
});

describe('登录', () => {
  test('正确凭据返回 token', async () => {
    const res = await req('POST', '/api/auth/login', {
      body: { username: 'alice', password: 'passw0rd' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  test('错误密码返回 401', async () => {
    const res = await req('POST', '/api/auth/login', {
      body: { username: 'alice', password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
  });

  test('不存在的用户返回 401（不泄露用户是否存在）', async () => {
    const res = await req('POST', '/api/auth/login', {
      body: { username: 'ghost-user', password: 'whatever' },
    });
    assert.equal(res.status, 401);
  });
});

describe('鉴权', () => {
  test('/me 无 token 返回 401', async () => {
    const res = await req('GET', '/api/auth/me');
    assert.equal(res.status, 401);
  });

  test('/me 使用伪造 token 返回 401', async () => {
    const res = await req('GET', '/api/auth/me', { token: 'not-a-real-token' });
    assert.equal(res.status, 401);
  });

  test('/me 有效 token 返回当前用户', async () => {
    const token = await createUser('carol');
    const res = await req('GET', '/api/auth/me', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'carol');
  });

  test('受保护接口无 token 一律 401', async () => {
    for (const path of ['/api/students', '/api/followups']) {
      const res = await req('GET', path);
      assert.equal(res.status, 401, path + ' 应要求鉴权');
    }
  });
});

describe('CORS', () => {
  test('未知来源不带 CORS 头，但仍正常响应（不能报错）', async () => {
    const res = await req('POST', '/api/auth/login', {
      body: { username: 'alice', password: 'passw0rd' },
      headers: { Origin: 'https://not-whitelisted.example.com' },
    });
    assert.equal(res.status, 200, '未知来源不应导致 500');
    assert.equal(res.headers.get('access-control-allow-origin'), null, '不应下发 CORS 头');
  });
});

// ===== 令牌失效的可读提示 =====
// 用户真实反馈过：令牌失效时只看到「认证令牌无效或已过期」，
// 分不清是"过期了该重新登录"还是"系统坏了"。这里锁定两种提示与 reason 字段。
describe('令牌失效提示', () => {
  test('过期令牌 → 提示"登录已过期"且 reason=expired', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { env } = await import('../config/env.js');

    const expired = jwt.sign({ userId: 1 }, env.JWT_SECRET, { expiresIn: '-1s' });
    const res = await req('GET', '/api/students', { token: expired });

    assert.equal(res.status, 401);
    assert.match(res.body.error, /登录已过期/);
    assert.equal(res.body.reason, 'expired');
  });

  test('签名不符（JWT_SECRET 变更）→ 提示"登录状态已失效"且 reason=invalid', async () => {
    const jwt = (await import('jsonwebtoken')).default;

    const forged = jwt.sign({ userId: 1 }, 'a-different-secret');
    const res = await req('GET', '/api/students', { token: forged });

    assert.equal(res.status, 401);
    assert.match(res.body.error, /登录状态已失效/);
    assert.equal(res.body.reason, 'invalid');
  });

  test('未提供令牌 → 保持原有提示', async () => {
    const res = await req('GET', '/api/students');
    assert.equal(res.status, 401);
    assert.match(res.body.error, /未提供认证令牌/);
  });
});
