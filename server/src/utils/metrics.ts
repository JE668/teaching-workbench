/**
 * 进程级与业务级指标（Prometheus 文本格式，供 /metrics 抓取）。
 *
 * 设计约束：
 * - 零依赖：用 perf_hooks + 内存直方图，不引入 prom-client。
 * - 无敏感数据：只输出聚合计数/分位数，不含用户信息与业务行数据。
 * - 可选鉴权：设 METRICS_TOKEN 后必须以 ?token= 或 Bearer 携带，否则 404。
 *   NAS 内网默认可直接访问，公网暴露时务必设置该变量。
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';
import { db } from '../config/database.js';

// ===== HTTP 直方图 =====
// 延迟桶（ms）。累计计数法，渲染时输出 le 桶，Grafana 侧可算 p50/p95。
const HTTP_BUCKETS_MS = [5, 15, 50, 100, 300, 1000, 3000, 10000];

interface RouteStats {
  count: number;
  sumMs: number;
  buckets: number[]; // 与 HTTP_BUCKETS_MS 对齐的累计计数
  byClass: Record<string, number>; // '2xx' | '4xx' | '5xx'
}

const httpRoutes = new Map<string, RouteStats>();

/**
 * 路由基数上限。normalizeRoutePath 只折叠纯数字段（/123 → /:id），
 * 但像 /images/:userId/:filename 这类参数是任意字符串（真实文件名），
 * 折叠不掉 —— 若不设上限，已登录用户遍历不同路径就能无限撑大这个 Map
 * （内存）与 /metrics 输出（Prometheus 基数爆炸）。
 *
 * 超限后不再新增键，而是把后续未知的 method+path 折进 `ALL __other__` 聚合桶
 * （带 method 段是为了和正常键 `method path` 格式一致，渲染时统一 split）：
 * 总量、时延、状态分布仍可见（只是不再按细粒度路由区分），拒绝服务而不丢数据。
 */
const MAX_HTTP_ROUTE_KEYS = 200;
const OVERFLOW_ROUTE_KEY = 'ALL __other__';

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  return '2xx';
}

/** /api/students/123/notes → /api/students/:id/notes，控制基数防指标爆炸 */
export function normalizeRoutePath(rawPath: string): string {
  return rawPath.replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function observeHttpRequest(method: string, rawPath: string, status: number, durationMs: number): void {
  let route = normalizeRoutePath(rawPath);
  let key = method + ' ' + route;
  // 已有的路由键继续原地累加；只有「新路由且基数已达上限」才折叠进溢出桶，
  // 避免超限后仍不断新增键，同时也保住前 MAX 条正常路由的细粒度可观测性。
  // 溢出桶一旦创建会占一个 size，所以封顶后 size 始终是 MAX+1（含溢出桶），
  // 后续新路由因 size 已 >= MAX 会一直落到 OVERFLOW_ROUTE_KEY，不再新增键。
  if (!httpRoutes.has(key) && httpRoutes.size >= MAX_HTTP_ROUTE_KEYS) {
    route = OVERFLOW_ROUTE_KEY.split(' ')[1];
    key = OVERFLOW_ROUTE_KEY;
  }
  let s = httpRoutes.get(key);
  if (!s) {
    s = { count: 0, sumMs: 0, buckets: new Array(HTTP_BUCKETS_MS.length).fill(0), byClass: {} };
    httpRoutes.set(key, s);
  }
  s.count += 1;
  s.sumMs += durationMs;
  const cls = statusClass(status);
  s.byClass[cls] = (s.byClass[cls] || 0) + 1;
  for (let i = 0; i < HTTP_BUCKETS_MS.length; i++) {
    if (durationMs <= HTTP_BUCKETS_MS[i]) s.buckets[i] += 1;
  }
}

// ===== 事件循环延迟 =====
type LoopDelay = ReturnType<typeof monitorEventLoopDelay>;
let loopDelay: LoopDelay | null = null;
function getLoopDelay(): LoopDelay | null {
  if (!loopDelay) {
    try {
      loopDelay = monitorEventLoopDelay({ resolution: 20 });
      loopDelay.enable();
    } catch {
      return null; // 老运行时不支持时静默降级
    }
  }
  return loopDelay;
}

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/** 渲染 Prometheus 文本（text/plain; version=0.0.4） */
export function renderPrometheus(buildSha: string): string {
  const out: string[] = [];
  const mem = process.memoryUsage();

  const push = (name: string, help: string, type: string, samples: Array<[Record<string, string>, number]>) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(',');
      out.push(`${name}${labelStr ? '{' + labelStr + '}' : ''} ${value}`);
    }
  };

  push('process_uptime_seconds', 'Process uptime', 'gauge', [[{}, process.uptime()]]);
  push('process_resident_memory_bytes', 'RSS', 'gauge', [[{}, mem.rss]]);
  push('nodejs_heap_used_bytes', 'V8 heap used', 'gauge', [[{}, mem.heapUsed]]);
  const ld = getLoopDelay();
  if (ld) {
    push('nodejs_eventloop_lag_p50_seconds', 'Event loop delay p50', 'gauge', [[{}, ld.percentile(50) / 1e9]]);
    push('nodejs_eventloop_lag_p99_seconds', 'Event loop delay p99', 'gauge', [[{}, ld.percentile(99) / 1e9]]);
  }
  push('app_build_info', 'Build SHA of the running image', 'gauge', [[{ build: buildSha }, 1]]);

  // HTTP：按路由聚合的计数、时延总和、le 桶
  push('http_requests_total', 'HTTP requests by route/status class', 'counter',
    [...httpRoutes.entries()].flatMap(([route, s]) =>
      Object.entries(s.byClass).map(([cls, n]) =>
        [({ method: route.split(' ')[0], path: route.split(' ').slice(1).join(' '), status_class: cls }) as Record<string, string>, n] as [Record<string, string>, number])));
  out.push('# HELP http_request_duration_ms HTTP duration summary', '# TYPE http_request_duration_ms summary');
  for (const [route, s] of httpRoutes) {
    const [method, path] = route.split(' ');
    out.push(`http_request_duration_ms_sum{method="${method}",path="${esc(path)}"} ${Math.round(s.sumMs)}`);
    out.push(`http_request_duration_ms_count{method="${method}",path="${esc(path)}"} ${s.count}`);
  }
  out.push('# TYPE http_request_duration_ms_bucket histogram');
  for (const [route, s] of httpRoutes) {
    const [method, path] = route.split(' ');
    for (let i = 0; i < HTTP_BUCKETS_MS.length; i++) {
      out.push(`http_request_duration_ms_bucket{method="${method}",path="${esc(path)}",le="${HTTP_BUCKETS_MS[i]}"} ${s.buckets[i]}`);
    }
    out.push(`http_request_duration_ms_bucket{method="${method}",path="${esc(path)}",le="+Inf"} ${s.count}`);
  }

  // AI：最近 24h 聚合（来自 ai_metrics 表，纯统计无行数据）
  try {
    const rows = db.prepare(`
      SELECT endpoint, provider, model, status,
             COUNT(*) AS n,
             COALESCE(SUM(total_tokens),0) AS tokens,
             COALESCE(SUM(latency_ms),0) AS latency_sum
      FROM ai_metrics
      WHERE created_at > datetime('now','+8 hours','-24 hours')
      GROUP BY endpoint, provider, model, status
    `).all() as Array<{ endpoint: string; provider: string; model: string; status: string; n: number; tokens: number; latency_sum: number }>;
    push('ai_calls_total', 'AI calls in last 24h by endpoint/status', 'counter',
      rows.map((r) => [({ endpoint: r.endpoint, provider: r.provider, model: r.model, status: r.status }) as Record<string, string>, r.n] as [Record<string, string>, number]));
    push('ai_tokens_total', 'AI tokens used in last 24h', 'counter',
      rows.map((r) => [({ endpoint: r.endpoint, provider: r.provider, model: r.model }) as Record<string, string>, r.tokens] as [Record<string, string>, number]));
    push('ai_latency_ms_sum', 'AI latency sum (ms) in last 24h — divide by ai_calls_total for avg', 'counter',
      rows.map((r) => [({ endpoint: r.endpoint, provider: r.provider, model: r.model }) as Record<string, string>, r.latency_sum] as [Record<string, string>, number]));
  } catch {
    // 指标表不可用不影响 /metrics 其余部分
  }

  return out.join('\n') + '\n';
}

/** 测试用：清空路由直方图 */
export function resetMetricsForTest(): void {
  httpRoutes.clear();
}
