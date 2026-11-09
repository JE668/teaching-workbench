import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.js';
import { req, createUser } from './helpers.js';
import { db } from '../config/database.js';
import { cleanupAiMetrics, recordAiMetrics } from '../services/aiMetrics.js';

// AI 指标保留策略：
// - ai_metrics 只写不删会无限增长，拖慢 /metrics 抓取与磁盘
// - cleanupAiMetrics 只删超保留期的行，保留期内的行原封不动
// - created_at 有单列索引（/metrics 24h 聚合与按时间删除都靠它）

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

function countAll(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM ai_metrics').get() as { n: number }).n;
}

test('cleanupAiMetrics 删除超保留期的旧行，保留期内的新行不动', () => {
  db.prepare('DELETE FROM ai_metrics').run();
  const insert = db.prepare(
    `INSERT INTO ai_metrics (user_id, provider, model, endpoint, total_tokens, latency_ms, status, created_at)
     VALUES (1, 'p', 'm', 'e', 10, 50, 'success', datetime('now', '+8 hours', ?))`
  );
  // 三条：100 天前（超 90 天保留期）、40 天前、2 小时前（都在保留期内）
  insert.run('-100 days');
  insert.run('-40 days');
  insert.run('-2 hours');
  assert.equal(countAll(), 3);

  const removed = cleanupAiMetrics(90);
  assert.equal(removed, 1, '应只删掉 100 天前那一条');
  assert.equal(countAll(), 2, '保留期内两条应还在');
});

test('cleanupAiMetrics 有最小保留期下限，防止误配成 0 导致全删', () => {
  db.prepare('DELETE FROM ai_metrics').run();
  const insert = db.prepare(
    `INSERT INTO ai_metrics (user_id, provider, model, endpoint, total_tokens, latency_ms, status, created_at)
     VALUES (1, 'p', 'm', 'e', 10, 50, 'success', datetime('now', '+8 hours', '-1 day'))`
  );
  insert.run(); // 1 天前
  // 传 0 或负数应被钳到最小 7 天，1 天前的行仍在保留期内，不该被删
  const removed = cleanupAiMetrics(0);
  assert.equal(removed, 0, '误配 0 天不应删除 1 天前的数据');
  assert.equal(countAll(), 1);
});

test('created_at 有单列索引，/metrics 的 24h 聚合不走全表扫描', () => {
  const idx = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ai_metrics'`
  ).all() as Array<{ name: string }>;
  const names = idx.map((r) => r.name);
  assert.ok(names.includes('idx_ai_metrics_created_at'), '应存在 created_at 单列索引');

  // /metrics 用的 24h 聚合查询计划应是 SEARCH（走索引）而非 SCAN（全表）
  const plan = db.prepare(
    `EXPLAIN QUERY PLAN
     SELECT endpoint, provider, model, status, COUNT(*) AS n
     FROM ai_metrics
     WHERE created_at > datetime('now', '+8 hours', '-24 hours')
     GROUP BY endpoint, provider, model, status`
  ).all() as Array<{ detail: string }>;
  const detail = plan.map((r) => r.detail).join(' | ');
  assert.match(detail, /SEARCH ai_metrics/, `24h 聚合应走索引，实际计划: ${detail}`);
  assert.doesNotMatch(detail, /SCAN ai_metrics(?! USING)/, `不应全表扫描，实际计划: ${detail}`);
});

test('recordAiMetrics 仍可正常写入（保留策略不破坏写入路径）', async () => {
  db.prepare('DELETE FROM ai_metrics').run();
  await recordAiMetrics({
    userId: 1,
    provider: 'p',
    model: 'm',
    endpoint: 'e',
    totalTokens: 42,
    latencyMs: 100,
    status: 'success',
  });
  const row = db.prepare('SELECT total_tokens, provider FROM ai_metrics LIMIT 1').get() as { total_tokens: number; provider: string };
  assert.equal(row.total_tokens, 42);
  assert.equal(row.provider, 'p');
});

test('指定用户清理时只删除该用户的过期指标', () => {
  const insertUser = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  const userA = Number(insertUser.run('cleanup-scope-a', 'x').lastInsertRowid);
  const userB = Number(insertUser.run('cleanup-scope-b', 'x').lastInsertRowid);
  const insertMetric = db.prepare(
    `INSERT INTO ai_metrics (user_id, provider, model, endpoint, total_tokens, latency_ms, status, created_at)
     VALUES (?, 'p', 'm', 'e', 1, 1, 'success', datetime('now', '+8 hours', ?))`
  );
  insertMetric.run(userA, '-100 days');
  insertMetric.run(userA, '-1 day');
  insertMetric.run(userB, '-100 days');

  assert.equal(cleanupAiMetrics(90, userA), 1, '只应删除用户 A 的过期行');
  const remaining = db
    .prepare('SELECT user_id FROM ai_metrics WHERE user_id IN (?, ?) ORDER BY user_id')
    .all(userA, userB) as Array<{ user_id: number }>;
  assert.deepEqual(remaining.map((r) => r.user_id), [userA, userB]);

  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userA, userB);
});

test('AI 指标看板接口在无效数字参数下回退而不是 500', async () => {
  db.prepare('DELETE FROM ai_metrics').run();
  const token = await createUser('ai-metrics-dashboard');

  for (const path of [
    '/api/ai-metrics/summary?days=abc',
    '/api/ai-metrics/timeseries?days=abc',
    '/api/ai-metrics/errors?days=abc&limit=abc',
    '/api/ai-metrics/errors?days=30&limit=1.5',
  ]) {
    const res = await req('GET', path, { token });
    assert.equal(res.status, 200, `GET ${path} 应回退默认参数`);
  }
});
