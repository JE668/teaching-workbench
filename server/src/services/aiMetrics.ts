/**
 * AI 调用指标记录工具。
 *
 * 用于记录每次 AI 请求的关键指标：
 * - token 使用量（用于成本核算）
 * - 延迟（用于性能分析）
 * - 状态（success/error/retry）
 * - 字数与字数区间（用于质量监控）
 * - 重试次数
 */

import { db } from '../config/database.js';
import { log } from '../utils/logger.js';

export interface AiMetricsRecord {
  userId: number;
  provider: string;
  model: string;
  endpoint: string;           // 如 followup_stream, report_summary, report_plan
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  status: 'success' | 'error' | 'retry';
  errorMessage?: string;
  retryCount?: number;
  wordCount?: number;
  wordRangeMin?: number;
  wordRangeMax?: number;
}

/**
 * 记录 AI 调用指标。
 * 失败不抛出异常，仅记录日志，避免影响主业务流程。
 */
export async function recordAiMetrics(record: AiMetricsRecord): Promise<void> {
  try {
    const stmt = db.prepare(
      `INSERT INTO ai_metrics
         (user_id, provider, model, endpoint, prompt_tokens, completion_tokens, total_tokens,
          latency_ms, status, error_message, retry_count, word_count, word_range_min, word_range_max, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+8 hours'))`
    );
    stmt.run(
      record.userId,
      record.provider,
      record.model,
      record.endpoint,
      record.promptTokens ?? 0,
      record.completionTokens ?? 0,
      record.totalTokens ?? 0,
      record.latencyMs,
      record.status,
      record.errorMessage ?? null,
      record.retryCount ?? 0,
      record.wordCount ?? null,
      record.wordRangeMin ?? null,
      record.wordRangeMax ?? null
    );
  } catch (error: any) {
    log.warn({ err: error.message }, 'AI 指标记录失败');
  }
}

/**
 * 获取某用户的 AI 调用统计（用于管理后台或用户自查）。
 */
export function getAiMetricsSummary(userId: number, days = 30): any {
  try {
    return db.prepare(
      `SELECT
         provider,
         model,
         endpoint,
         COUNT(*) as calls,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
         AVG(latency_ms) as avg_latency_ms,
         SUM(total_tokens) as total_tokens,
         AVG(word_count) as avg_word_count,
         MAX(created_at) as last_call
       FROM ai_metrics
       WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days', '+8 hours')
       GROUP BY provider, model, endpoint
       ORDER BY last_call DESC`
    ).all(userId, days);
  } catch (error: any) {
    log.warn({ err: error.message }, '获取 AI 指标统计失败');
    return [];
  }
}

/**
 * 获取最近的 AI 错误记录（用于排查）。
 */
export function getRecentAiErrors(userId: number, limit = 20): any {
  try {
    return db.prepare(
      `SELECT provider, model, endpoint, error_message, retry_count, latency_ms, created_at
       FROM ai_metrics
       WHERE user_id = ? AND status = 'error'
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(userId, limit);
  } catch (error: any) {
    log.warn({ err: error.message }, '获取 AI 错误记录失败');
    return [];
  }
}

/**
 * 清理超过保留期的 AI 指标。
 *
 * 为什么需要：ai_metrics 只写不删，随使用无限增长。/metrics 每次抓取都对它
 * 做 24h 聚合（现走 idx_ai_metrics_created_at），getAiMetricsSummary 也按
 * created_at 区间聚合 —— 表越长越大，这些查询与磁盘占用都会持续恶化。
 * 指标是运营遥测而非业务数据，按保留期丢弃旧数据是合理取舍。
 *
 * 默认保留 90 天，可用 AI_METRICS_RETAIN_DAYS 覆盖（最小 7 天防误配）。
 * 返回删除行数，便于启动日志与测试断言。
 */
export function cleanupAiMetrics(retainDays = 90, userId?: number): number {
  const days = Math.max(7, Math.floor(retainDays));
  try {
    const info = db.prepare(
      `DELETE FROM ai_metrics
       WHERE created_at < datetime('now', '-' || ? || ' days', '+8 hours')
         ${userId === undefined ? '' : 'AND user_id = ?'}`
    ).run(...(userId === undefined ? [days] : [days, userId]));
    return info.changes;
  } catch (error: any) {
    log.warn({ err: error.message }, '清理 AI 指标失败');
    return 0;
  }
}
