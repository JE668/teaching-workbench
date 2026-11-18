import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req } from './helpers.js';

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

test('安全响应头：不暴露 Express，禁止嗅探与嵌入，且不下发 HSTS（明文）', async () => {
  const res = await req('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(String(res.headers.get('permissions-policy')), /camera=\(\)/);
  assert.equal(res.headers.get('strict-transport-security'), null);
});

test('安全响应头：接口响应禁止缓存并下发严格 CSP（401 分支同样带上）', async () => {
  const res = await req('GET', '/api/students');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const csp = String(res.headers.get('content-security-policy'));
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('W13 前端离线检测：/api/health 不挂鉴权，未登录也返回 200 空体', async () => {
  const res = await req('GET', '/api/health');
  assert.equal(res.status, 200);
  // 空体：前端只判断 res.ok，不解析 JSON
  assert.equal(res.body ?? '', '');
});

test('安全响应头：仅当反代声明 https 时下发 HSTS', async () => {
  const res = await req('GET', '/health', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(
    res.headers.get('strict-transport-security'),
    'max-age=31536000; includeSubDomains'
  );
});
