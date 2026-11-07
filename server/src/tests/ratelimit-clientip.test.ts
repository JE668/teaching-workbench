import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { rateLimit } from '../middleware/rateLimit.js';

/**
 * 限流器的客户端 IP 取段逻辑。
 *
 * 历史事故：曾取 X-Forwarded-For 的【第一段】——那是客户端自己填的、
 * 完全不可信的字段。攻击者每个请求带一个随机 XFF 即可伪造无限个限流桶，
 * 让登录爆破限制形同虚设。部署链是 浏览器 → Lucky → nginx($proxy_add_x_forwarded_for)
 * → 本服务，nginx 是【追加】，真实 IP 在链的最后一段。
 */

/** 起一个只挂限流中间件的服务，返回 baseUrl（用完需 stop） */
async function startLimiterApp(options: Parameters<typeof rateLimit>[0]) {
  const app = express();
  app.get('/probe', rateLimit(options), (req, res) => {
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: 'http://127.0.0.1:' + port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function get(baseUrl: string, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('限流器 · 客户端 IP 取段（防伪造 XFF 绕过）', () => {
  test('XFF 取最后一段而非第一段（nginx 追加语义下最后一段才是真实客户端）', async () => {
    const { baseUrl, close } = await startLimiterApp({ windowMs: 60_000, max: 2 });
    try {
      // 三个不同【第一段】的请求，真实客户端（最后一段）相同 → 必须同一条桶
      const r1 = await get(baseUrl, '/probe', { 'X-Forwarded-For': '1.1.1.1, 10.0.0.9' });
      const r2 = await get(baseUrl, '/probe', { 'X-Forwarded-For': '2.2.2.2, 10.0.0.9' });
      const r3 = await get(baseUrl, '/probe', { 'X-Forwarded-For': '3.3.3.3, 10.0.0.9' });

      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal(r3.status, 429, '伪造不同 XFF 第一段不应获得新额度（同一真实客户端）');
    } finally {
      await close();
    }
  });

  test('优先取 X-Real-IP（nginx 显式设置，单一值无伪造面）', async () => {
    const { baseUrl, close } = await startLimiterApp({ windowMs: 60_000, max: 1 });
    try {
      const r1 = await get(baseUrl, '/probe', {
        'X-Real-IP': '203.0.113.7',
        'X-Forwarded-For': '9.9.9.9, 203.0.113.7',
      });
      const r2 = await get(baseUrl, '/probe', {
        'X-Real-IP': '203.0.113.7',
        'X-Forwarded-For': '8.8.8.8, 203.0.113.7',
      });
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 429, '同一 X-Real-IP 应命中同一条桶（即使 XFF 各段都在变）');
    } finally {
      await close();
    }
  });

  test('X-Real-IP 与 XFF 最后一段不同时，各算各的桶', async () => {
    const { baseUrl, close } = await startLimiterApp({ windowMs: 60_000, max: 1 });
    try {
      const r1 = await get(baseUrl, '/probe', { 'X-Real-IP': '203.0.113.7', 'X-Forwarded-For': '1.1.1.1, 10.0.0.1' });
      const r2 = await get(baseUrl, '/probe', { 'X-Real-IP': '203.0.113.8', 'X-Forwarded-For': '2.2.2.2, 10.0.0.1' });
      // 不同 X-Real-IP → 不同桶，第二个不该被第一个锁住
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
    } finally {
      await close();
    }
  });

  test('无任何代理头时退回 req.ip（所有直连请求同一条桶）', async () => {
    const { baseUrl, close } = await startLimiterApp({ windowMs: 60_000, max: 1 });
    try {
      const r1 = await get(baseUrl, '/probe');
      const r2 = await get(baseUrl, '/probe');
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 429, '同一直连来源（无代理头）应共用一条桶');
    } finally {
      await close();
    }
  });
});
