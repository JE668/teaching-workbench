import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, url } from './helpers.js';
import { resetMetricsForTest, normalizeRoutePath } from '../utils/metrics.js';

// /metrics 端点行为：
// - 未设 METRICS_TOKEN 时开放（内网默认）
// - 设了 METRICS_TOKEN 必须携带正确 token，否则 404（不暴露端点存在性）
// - 数字路径段归一为 :id，控制标签基数
// - /metrics 自身不进直方图

before(async () => {
  delete process.env.METRICS_TOKEN;
  resetMetricsForTest();
  await startServer();
});

after(async () => {
  await stopServer();
  delete process.env.METRICS_TOKEN;
});

test('开放模式：返回 Prometheus 文本与核心指标', async () => {
  await req('GET', '/health');
  await req('GET', '/api/students/123/notes', { token: 'bogus' }); // 401 也是流量

  const res = await fetch(url('/metrics'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/plain/);
  const body = await res.text();

  assert.match(body, /# TYPE process_uptime_seconds gauge/);
  assert.match(body, /app_build_info\{build="[^"]*"\} 1/);
  assert.match(body, /http_requests_total\{method="GET",path="\/health",status_class="2xx"\} \d+/);
  // 数字 ID 已归一化，不出现基数爆炸的原始路径
  assert.doesNotMatch(body, /path="\/api\/students\/123\/notes"/);
  assert.match(body, /path="\/api\/students\/:id\/notes"/);
  assert.match(body, /http_request_duration_ms_bucket\{[^}]*le="\+Inf"\} \d+/);
  // AI 聚合（24h 窗口，空表也应输出 HELP/TYPE）
  assert.match(body, /# TYPE ai_calls_total counter/);
});

test('直方图 le 桶累计不减且 +Inf 等于总数', async () => {
  await req('GET', '/health');
  const body = await (await fetch(url('/metrics'))).text();
  const lines = body.split('\n');
  const countLine = lines.find((l) => l.startsWith('http_request_duration_ms_count{method="GET",path="/health"}'));
  assert.ok(countLine, '应有 /health 计数');
  const total = Number(countLine!.split(' ').pop());
  let cumulative = -1;
  let sawInf = false;
  for (const line of lines) {
    const m = line.match(/^http_request_duration_ms_bucket\{method="GET",path="\/health",le="([^"]+)"\} (\d+)$/);
    if (!m) continue;
    const v = Number(m[2]);
    assert.ok(v >= cumulative, 'le 桶必须累计不减');
    cumulative = v;
    if (m[1] === '+Inf') { sawInf = true; assert.equal(v, total); }
  }
  assert.ok(sawInf, '应有 +Inf 桶');
});

test('/metrics 自身不进直方图', async () => {
  await fetch(url('/metrics'));
  const body = await (await fetch(url('/metrics'))).text();
  assert.equal((body.match(/path="\/metrics"/g) || []).length, 0);
});

test('设 METRICS_TOKEN 后：无 token 404、query/Bearer 放行', async () => {
  process.env.METRICS_TOKEN = 's3cret-metrics';
  try {
    const anon = await fetch(url('/metrics'));
    assert.equal(anon.status, 404);

    const wrong = await fetch(url('/metrics?token=nope'));
    assert.equal(wrong.status, 404);

    const viaQuery = await fetch(url('/metrics?token=s3cret-metrics'));
    assert.equal(viaQuery.status, 200);

    const viaBearer = await fetch(url('/metrics'), {
      headers: { Authorization: 'Bearer s3cret-metrics' },
    });
    assert.equal(viaBearer.status, 200);
  } finally {
    delete process.env.METRICS_TOKEN;
  }
});

test('normalizeRoutePath 基数控制', () => {
  assert.equal(normalizeRoutePath('/api/students/42'), '/api/students/:id');
  assert.equal(normalizeRoutePath('/api/students/42/notes'), '/api/students/:id/notes');
  assert.equal(normalizeRoutePath('/api/reports/7/exports/12'), '/api/reports/:id/exports/:id');
  assert.equal(normalizeRoutePath('/api/students/abc'), '/api/students/abc');
  assert.equal(normalizeRoutePath('/health'), '/health');
});
