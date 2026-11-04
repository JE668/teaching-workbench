/**
 * AI 调用成本/性能看板。
 *
 * 面向教学主管/校区负责人：看 AI 用量、成本、成功率、延迟分布、错误排查。
 * 基于 ai_metrics 表（只写不删、90 天保留），不增加新表。
 */
import { Router } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { getAiMetricsSummary, getRecentAiErrors, cleanupAiMetrics } from '../services/aiMetrics.js';

const router = Router();

/**
 * GET /api/ai-metrics/summary
 * 查询参数：days（默认 30）、groupBy（provider|model|endpoint，默认 endpoint）
 * 返回：分组聚合统计（调用量、成功率、平均延迟、总 token、平均字数、最后调用时间）
 */
router.get('/summary', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);
    const groupBy = (req.query.groupBy as string) || 'endpoint';

    const validGroupBy = ['provider', 'model', 'endpoint'];
    if (!validGroupBy.includes(groupBy)) {
      return res.status(400).json({ error: 'groupBy 必须是 provider|model|endpoint 之一' });
    }

    const rows = db
      .prepare(
        `SELECT
           ${groupBy} as \`group\`,
           COUNT(*) as calls,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
           SUM(CASE WHEN status = 'retry' THEN 1 ELSE 0 END) as retry_count,
           AVG(latency_ms) as avg_latency_ms,
           MIN(latency_ms) as min_latency_ms,
           MAX(latency_ms) as max_latency_ms,
           SUM(total_tokens) as total_tokens,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           AVG(word_count) as avg_word_count,
           MAX(created_at) as last_call
         FROM ai_metrics
         WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days', '+8 hours')
         GROUP BY ${groupBy}
         ORDER BY calls DESC`
      )
      .all(userId, days) as any[];

    // 计算成功率
    const summary = rows.map((r) => ({
      ...r,
      successRate: r.calls ? Math.round((r.success_count / r.calls) * 10000) / 100 : 0,
      errorRate: r.calls ? Math.round((r.error_count / r.calls) * 10000) / 100 : 0,
      retryRate: r.calls ? Math.round((r.retry_count / r.calls) * 10000) / 100 : 0,
      avg_latency_ms: r.avg_latency_ms ? Math.round(r.avg_latency_ms) : 0,
    }));

    res.json({ summary, days, groupBy });
  } catch (error: any) {
    res.status(500).json({ error: '获取 AI 指标摘要失败', message: error.message });
  }
});

/**
 * GET /api/ai-metrics/timeseries
 * 查询参数：days（默认 30）、interval（hour|day，默认 day）、metric（calls|tokens|latency|success_rate）
 * 返回：时间序列数据，用于画折线图
 */
router.get('/timeseries', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 90);
    const interval = (req.query.interval as string) || 'day';
    const metric = (req.query.metric as string) || 'calls';

    const validInterval = ['hour', 'day'];
    if (!validInterval.includes(interval)) {
      return res.status(400).json({ error: 'interval 必须是 hour 或 day' });
    }
    const validMetric = ['calls', 'tokens', 'latency', 'success_rate', 'errors'];
    if (!validMetric.includes(metric)) {
      return res.status(400).json({ error: 'metric 必须是 calls|tokens|latency|success_rate|errors 之一' });
    }

    const dateFormat = interval === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
    const groupBy = interval === 'hour'
      ? "strftime('%Y-%m-%d %H:00', created_at)"
      : "date(created_at)";

    const rows = db
      .prepare(
        `SELECT
           ${groupBy} as period,
           COUNT(*) as calls,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
           AVG(latency_ms) as avg_latency_ms,
           SUM(total_tokens) as total_tokens
         FROM ai_metrics
         WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days', '+8 hours')
         GROUP BY ${groupBy}
         ORDER BY period ASC`
      )
      .all(userId, days) as any[];

    // 补全缺失的时间点
    const data = rows.map((r) => ({
      period: r.period,
      calls: r.calls,
      successRate: r.calls ? Math.round((r.success_count / r.calls) * 10000) / 100 : 0,
      errorCount: r.error_count,
      avgLatencyMs: r.avg_latency_ms ? Math.round(r.avg_latency_ms) : 0,
      tokens: r.total_tokens,
    }));

    res.json({ data, days, interval, metric });
  } catch (error: any) {
    res.status(500).json({ error: '获取 AI 指标时间序列失败', message: error.message });
  }
});

/**
 * GET /api/ai-metrics/errors
 * 查询参数：limit（默认 50）、days（默认 30）
 * 返回：最近的错误记录，用于排查
 */
router.get('/errors', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 90);

    const rows = db
      .prepare(
        `SELECT
           provider, model, endpoint, error_message, retry_count, latency_ms, created_at
         FROM ai_metrics
         WHERE user_id = ? AND status = 'error'
           AND created_at >= datetime('now', '-' || ? || ' days', '+8 hours')
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, days, limit) as any[];

    res.json({ errors: rows, limit, days });
  } catch (error: any) {
    res.status(500).json({ error: '获取 AI 错误记录失败', message: error.message });
  }
});

/**
 * GET /api/ai-metrics/endpoints
 * 返回所有 endpoint 的统计对比（哪个端点最贵、最慢、错误最多）
 */
router.get('/endpoints', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);

    const rows = db
      .prepare(
        `SELECT
           endpoint,
           COUNT(*) as calls,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
           AVG(latency_ms) as avg_latency_ms,
           SUM(total_tokens) as total_tokens,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           AVG(word_count) as avg_word_count,
           MAX(created_at) as last_call
         FROM ai_metrics
         WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days', '+8 hours')
         GROUP BY endpoint
         ORDER BY calls DESC`
      )
      .all(userId, days) as any[];

    const endpoints = rows.map((r) => ({
      endpoint: r.endpoint,
      calls: r.calls,
      successRate: r.calls ? Math.round((r.success_count / r.calls) * 10000) / 100 : 0,
      errorRate: r.calls ? Math.round((r.error_count / r.calls) * 10000) / 100 : 0,
      avgLatencyMs: r.avg_latency_ms ? Math.round(r.avg_latency_ms) : 0,
      totalTokens: r.total_tokens,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      avgWordCount: r.avg_word_count ? Math.round(r.avg_word_count) : 0,
      lastCall: r.last_call,
    }));

    res.json({ endpoints, days });
  } catch (error: any) {
    res.status(500).json({ error: '获取端点统计失败', message: error.message });
  }
});

/**
 * POST /api/ai-metrics/cleanup
 * 手动触发清理（保留天数默认 90 天，最小 7 天）
 * 管理员可见
 */
router.post('/cleanup', (req: AuthenticatedRequest, res) => {
  try {
    const days = Math.max(7, Math.floor(Number(req.body?.days || 90)));
    const deleted = cleanupAiMetrics(days);
    res.json({ deleted, days });
  } catch (error: any) {
    res.status(500).json({ error: '清理 AI 指标失败', message: error.message });
  }
});

export default router;