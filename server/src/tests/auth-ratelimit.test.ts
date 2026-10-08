import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req } from './helpers.js';

// 单独一个文件：限流器是进程内的，避免影响其它用例的登录预算
before(async () => {
  await startServer();
});
after(async () => {
  await stopServer();
});

describe('登录限流', () => {
  test('超过阈值后返回 429 且带 Retry-After', async () => {
    let got429 = false;
    let lastRes: any = null;

    for (let i = 0; i < 25; i++) {
      const res = await req('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'wrong-password' },
      });
      lastRes = res;
      if (res.status === 429) {
        got429 = true;
        break;
      }
      assert.equal(res.status, 401, '阈值内应为 401');
    }

    assert.ok(got429, '连续失败登录应触发 429');
    assert.ok(lastRes.headers.get('retry-after'), '应返回 Retry-After 头');
    assert.ok(lastRes.body.retryAfter > 0);
  });

  test('锁定后即使密码正确也不放行（额度只按失败计，但已达上限）', async () => {
    const res = await req('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'test-pass-123456' },
    });
    assert.equal(res.status, 429);
  });
});
