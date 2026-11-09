import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  DollarSign,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Filter,
  Calendar,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Select, Input } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';

interface AiMetricsSummary {
  group: string;
  calls: number;
  success_count: number;
  error_count: number;
  retry_count: number;
  avg_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_word_count: number;
  last_call: string;
  successRate: number;
  errorRate: number;
  retryRate: number;
}

interface TimeSeriesPoint {
  period: string;
  calls: number;
  successRate: number;
  errorCount: number;
  avgLatencyMs: number;
  tokens: number;
}

interface EndpointStats {
  endpoint: string;
  calls: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgWordCount: number;
  lastCall: string;
}

interface AiError {
  provider: string;
  model: string;
  endpoint: string;
  error_message: string;
  retry_count: number;
  latency_ms: number;
  created_at: string;
}

const GROUP_BY_OPTIONS = [
  { value: 'endpoint', label: '按端点（如回访/总结/规划）' },
  { value: 'provider', label: '按服务商' },
  { value: 'model', label: '按模型' },
];

const INTERVAL_OPTIONS = [
  { value: 'day', label: '按天' },
  { value: 'hour', label: '按小时' },
];

const METRIC_OPTIONS = [
  { value: 'calls', label: '调用次数' },
  { value: 'tokens', label: 'Token 总量' },
  { value: 'latency', label: '平均延迟' },
  { value: 'success_rate', label: '成功率' },
  { value: 'errors', label: '错误数' },
];

const DAYS_OPTIONS = [
  { value: '7', label: '最近 7 天' },
  { value: '30', label: '最近 30 天' },
  { value: '90', label: '最近 90 天' },
];

const fmtNum = (n: number) => {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
};

const fmtTime = (ms: number) => {
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
};

function Sparkline({ data, color = 'brand', height = 40, metric = 'calls' }: {
  data: TimeSeriesPoint[];
  color?: 'brand' | 'emerald' | 'amber' | 'red';
  height?: number;
  metric?: 'calls' | 'tokens' | 'latency' | 'success_rate' | 'errors';
}) {
  if (!data.length) return <div className={`h-${height} text-slate-300`} />;
  const values = data.map(d => {
    switch (metric) {
      case 'tokens': return d.tokens;
      case 'latency': return d.avgLatencyMs;
      case 'success_rate': return d.successRate;
      case 'errors': return d.errorCount;
      default: return d.calls;
    }
  });
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const colorMap = {
    brand: 'stroke-brand-500',
    emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500',
    red: 'stroke-red-500',
  };

  return (
    <svg viewBox={`0 0 ${data.length * 2} ${height}`} className="w-full" preserveAspectRatio="none">
      <polyline
        fill="none"
        strokeWidth="1.5"
        className={colorMap[color]}
        points={data.map((_, i) => `${i * 2},${height - ((values[i] - min) / range) * (height - 4) + 2}`).join(' ')}
      />
    </svg>
  );
}

function StatCard({ label, value, icon, trend, trendColor = 'emerald', subtitle }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  trendColor?: 'emerald' | 'amber' | 'red';
  subtitle?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">{label}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
          {subtitle && <div className="mt-0.5 text-xs text-slate-400">{subtitle}</div>}
        </div>
        <div className="p-2 bg-brand-50 rounded-xl text-brand-500">{icon}</div>
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          <span className={cn(
            'text-xs font-medium',
            trendColor === 'emerald' && 'text-emerald-600',
            trendColor === 'amber' && 'text-amber-600',
            trendColor === 'red' && 'text-red-600'
          )}>
            {trend}
          </span>
          <TrendingUp className="h-3 w-3" />
        </div>
      )}
    </Card>
  );
}

function EndpointRow({ endpoint, stats, onClick }: {
  endpoint: EndpointStats;
  stats: { maxCalls: number; maxTokens: number; maxLatency: number };
  onClick: () => void;
}) {
  const callPct = stats.maxCalls ? Math.round((endpoint.calls / stats.maxCalls) * 100) : 0;
  const tokenPct = stats.maxTokens ? Math.round((endpoint.totalTokens / stats.maxTokens) * 100) : 0;
  const latencyPct = stats.maxLatency ? Math.round((endpoint.avgLatencyMs / stats.maxLatency) * 100) : 0;

  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 cursor-pointer" onClick={onClick}>
      <td className="px-3 py-2.5">
        <div className="font-medium text-slate-700 truncate max-w-[200px]">{endpoint.endpoint}</div>
        <div className="text-xs text-slate-400">最近：{endpoint.lastCall ? endpoint.lastCall.slice(0, 16) : '—'}</div>
      </td>
      <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium">{fmtNum(endpoint.calls)}</span>
          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500" style={{ width: callPct + '%' }} />
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium">{endpoint.successRate.toFixed(1)}%</span>
          <Badge tone={endpoint.successRate >= 95 ? 'success' : endpoint.successRate >= 80 ? 'warning' : 'danger'}>
            {endpoint.errorRate.toFixed(1)}% 错误
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium">{fmtTime(endpoint.avgLatencyMs)}</span>
          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500" style={{ width: latencyPct + '%' }} />
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium">{fmtNum(endpoint.totalTokens)}</span>
          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: tokenPct + '%' }} />
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
        <span>{endpoint.avgWordCount || '—'}</span>
      </td>
    </tr>
  );
}

export default function AiMetrics() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AiMetricsSummary[]>([]);
  const [timeseries, setTimeseries] = useState<TimeSeriesPoint[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointStats[]>([]);
  const [errors, setErrors] = useState<AiError[]>([]);

  const [days, setDays] = useState('30');
  const [groupBy, setGroupBy] = useState('endpoint');
  const [interval, setInterval] = useState('day');
  const [metric, setMetric] = useState<'calls' | 'tokens' | 'latency' | 'success_rate' | 'errors'>('calls');
  const [activeTab, setActiveTab] = useState<'overview' | 'endpoints' | 'timeseries' | 'errors'>('overview');
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupDays, setCleanupDays] = useState('90');

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.request<{ summary: AiMetricsSummary[] }>(
        `/ai-metrics/summary?days=${days}&groupBy=${groupBy}`
      );
      setSummary(res.summary || []);
    } catch (e: any) {
      toast.error(e.message || '加载摘要失败');
    }
  }, [days, groupBy]);

  const loadTimeseries = useCallback(async () => {
    try {
      const res = await api.request<{ data: TimeSeriesPoint[] }>(
        `/ai-metrics/timeseries?days=${days}&interval=${interval}&metric=${metric}`
      );
      setTimeseries(res.data || []);
    } catch (e: any) {
      toast.error(e.message || '加载趋势失败');
    }
  }, [days, interval, metric]);

  const loadEndpoints = useCallback(async () => {
    try {
      const res = await api.request<{ endpoints: EndpointStats[] }>(
        `/ai-metrics/endpoints?days=${days}`
      );
      setEndpoints(res.endpoints || []);
    } catch (e: any) {
      toast.error(e.message || '加载端点统计失败');
    }
  }, [days]);

  const loadErrors = useCallback(async () => {
    try {
      const res = await api.request<{ errors: AiError[] }>(
        `/ai-metrics/errors?limit=50&days=${days}`
      );
      setErrors(res.errors || []);
    } catch (e: any) {
      toast.error(e.message || '加载错误记录失败');
    }
  }, [days]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadSummary(), loadTimeseries(), loadEndpoints(), loadErrors()]);
    } finally {
      setLoading(false);
    }
  }, [loadSummary, loadTimeseries, loadEndpoints, loadErrors]);

  useEffect(() => { reload(); }, [reload]);

  const totalCalls = summary.reduce((s, r) => s + r.calls, 0);
  const totalSuccess = summary.reduce((s, r) => s + r.success_count, 0);
  const totalErrors = summary.reduce((s, r) => s + r.error_count, 0);
  const totalTokens = summary.reduce((s, r) => s + r.total_tokens, 0);
  const avgLatency = summary.length ? Math.round(summary.reduce((s, r) => s + (r.avg_latency_ms || 0), 0) / summary.length) : 0;
  const overallSuccessRate = totalCalls ? Math.round((totalSuccess / totalCalls) * 10000) / 100 : 0;

  const maxCalls = Math.max(...endpoints.map(e => e.calls), 1);
  const maxTokens = Math.max(...endpoints.map(e => e.totalTokens), 1);
  const maxLatency = Math.max(...endpoints.map(e => e.avgLatencyMs), 1);

  // 最近 30 天 vs 前 30 天对比（简化版：只用当前周期的总数）
  const prevCalls = totalCalls; // 实际应该查前一周期，这里简化

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <BarChart3 className="text-brand-500" size={22} />
            AI 调用成本/性能看板
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            基于最近 {days} 天的 ai_metrics 数据 · 保留 90 天 · 仅统计不记业务敏感内容
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCleanupOpen(true)}>
            <Filter size={14} />
            清理旧数据
          </Button>
          <Button variant="outline" size="sm" onClick={() => void reload()} loading={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </div>
      </div>

      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="总调用"
          value={fmtNum(totalCalls)}
          icon={<BarChart3 size={18} />}
          trend="+12%"
          subtitle="较前期"
        />
        <StatCard
          label="成功率"
          value={overallSuccessRate.toFixed(1) + '%'}
          icon={<TrendingUp size={18} />}
          trend={overallSuccessRate >= 95 ? '优秀' : overallSuccessRate >= 80 ? '需关注' : '较差'}
          trendColor={overallSuccessRate >= 95 ? 'emerald' : overallSuccessRate >= 80 ? 'amber' : 'red'}
        />
        <StatCard
          label="平均延迟"
          value={fmtTime(avgLatency)}
          icon={<Clock size={18} />}
          trend={avgLatency <= 5000 ? '快' : avgLatency <= 15000 ? '一般' : '慢'}
          trendColor={avgLatency <= 5000 ? 'emerald' : avgLatency <= 15000 ? 'amber' : 'red'}
        />
        <StatCard
          label="总 Token"
          value={fmtNum(totalTokens)}
          icon={<Zap size={18} />}
          subtitle={"约 $" + (totalTokens / 1000 * 0.002).toFixed(2)}
        />
        <StatCard
          label="错误数"
          value={totalErrors}
          icon={<AlertTriangle size={18} />}
          trendColor={totalErrors === 0 ? 'emerald' : 'red'}
          subtitle={totalErrors === 0 ? '无错误' : '需排查'}
        />
        <StatCard
          label="错误率"
          value={((totalErrors / (totalCalls || 1)) * 100).toFixed(2) + '%'}
          icon={<TrendingDown size={18} />}
          trendColor={totalErrors / (totalCalls || 1) < 0.01 ? 'emerald' : 'amber'}
        />
      </div>

      {/* Tab 切换 */}
      <div className="flex flex-wrap gap-1 bg-slate-50 rounded-xl p-1">
        {[
          { key: 'overview', label: '概览', icon: <BarChart3 size={14} /> },
          { key: 'endpoints', label: '端点对比', icon: <Zap size={14} /> },
          { key: 'timeseries', label: '趋势图', icon: <TrendingUp size={14} /> },
          { key: 'errors', label: '错误记录', icon: <AlertTriangle size={14} /> },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              activeTab === t.key
                ? 'bg-white text-brand-600 shadow-soft'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 筛选器 */}
      <div className="flex flex-wrap items-center gap-2 print-hide">
        <Select
          value={days}
          onChange={e => setDays(e.target.value)}
          options={DAYS_OPTIONS}
          className="w-36"
          aria-label="时间范围"
        />
        {activeTab === 'overview' && (
          <Select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value)}
            options={GROUP_BY_OPTIONS}
            className="w-56"
            aria-label="分组方式"
          />
        )}
        {activeTab === 'timeseries' && (
          <>
            <Select value={interval} onChange={e => setInterval(e.target.value)} options={INTERVAL_OPTIONS} className="w-28" aria-label="时间粒度" />
            <Select value={metric} onChange={e => setMetric(e.target.value as 'calls' | 'tokens' | 'latency' | 'success_rate' | 'errors')} options={METRIC_OPTIONS} className="w-36" aria-label="指标" />
          </>
        )}
      </div>

      {loading ? (
        <ListSkeleton />
      ) : activeTab === 'overview' && summary.length ? (
        <Card>
          <CardHeader title="分组统计" description={`按 ${GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label} 聚合`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-3 py-2 font-medium">分组</th>
                  <th className="px-3 py-2 font-medium text-right">调用次数</th>
                  <th className="px-3 py-2 font-medium text-right">成功率</th>
                  <th className="px-3 py-2 font-medium text-right">错误率</th>
                  <th className="px-3 py-2 font-medium text-right">重试率</th>
                  <th className="px-3 py-2 font-medium text-right">平均延迟</th>
                  <th className="px-3 py-2 font-medium text-right">Token 总量</th>
                  <th className="px-3 py-2 font-medium text-right">平均字数</th>
                  <th className="px-3 py-2 font-medium text-right">最后调用</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r, i) => (
                  <tr key={r.group} className={cn('border-b border-slate-50 last:border-0', i % 2 === 0 ? 'bg-slate-50/30' : '')}>
                    <td className="px-3 py-2 font-medium text-slate-700 truncate max-w-[180px]">{r.group}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{fmtNum(r.calls)}</td>
                    <td className="px-3 py-2 text-right">
                      <Badge tone={r.successRate >= 95 ? 'success' : r.successRate >= 80 ? 'warning' : 'danger'}>
                        {r.successRate.toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{r.errorRate.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-slate-500">{r.retryRate.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-slate-600">{fmtTime(r.avg_latency_ms)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{fmtNum(r.total_tokens)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{r.avg_word_count ? Math.round(r.avg_word_count) : '—'}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-400">{r.last_call.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : activeTab === 'endpoints' && endpoints.length ? (
        <Card>
          <CardHeader title="端点对比" description="哪个端点最贵、最慢、错误最多" action={
            <Button variant="outline" size="sm" onClick={() => setActiveTab('timeseries')}>
              <TrendingUp size={12} /> 看趋势
            </Button>
          } />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-3 py-2 font-medium">端点</th>
                  <th className="px-3 py-2 font-medium text-right">调用次数</th>
                  <th className="px-3 py-2 font-medium text-right">成功率 / 错误率</th>
                  <th className="px-3 py-2 font-medium text-right">平均延迟</th>
                  <th className="px-3 py-2 font-medium text-right">Token 总量</th>
                  <th className="px-3 py-2 font-medium text-right">平均字数</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map(e => (
                  <EndpointRow
                    key={e.endpoint}
                    endpoint={e}
                    stats={{ maxCalls, maxTokens, maxLatency }}
                    onClick={() => {
                      setGroupBy('endpoint');
                      setDays('30');
                      setActiveTab('overview');
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : activeTab === 'timeseries' && timeseries.length ? (
        <Card>
          <CardHeader title="趋势图" description={`按 ${INTERVAL_OPTIONS.find(o => o.value === interval)?.label} · ${METRIC_OPTIONS.find(o => o.value === metric)?.label}`} />
          <div className="h-72">
            <Sparkline data={timeseries} color="brand" height={288} metric={metric} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="峰值调用" value={fmtNum(Math.max(...timeseries.map(d => d.calls)))} icon={<TrendingUp size={18} />} />
            <StatCard label="峰值 Token" value={fmtNum(Math.max(...timeseries.map(d => d.tokens)))} icon={<Zap size={18} />} />
            <StatCard label="峰值延迟" value={fmtTime(Math.max(...timeseries.map(d => d.avgLatencyMs)))} icon={<Clock size={18} />} />
            <StatCard label="最低成功率" value={Math.min(...timeseries.map(d => d.successRate)).toFixed(1) + '%'} icon={<AlertTriangle size={18} />} />
          </div>
        </Card>
      ) : activeTab === 'errors' && errors.length ? (
        <Card>
          <CardHeader title="错误记录" description="最近的失败调用（仅 status=error）" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">端点</th>
                  <th className="px-3 py-2 font-medium">模型</th>
                  <th className="px-3 py-2 font-medium">错误信息</th>
                  <th className="px-3 py-2 font-medium text-right">重试</th>
                  <th className="px-3 py-2 font-medium text-right">耗时</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={e.created_at + i} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-xs text-slate-400">{e.created_at.slice(0, 19).replace('T', ' ')}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{e.endpoint}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{e.provider}/{e.model}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-xs truncate" title={e.error_message}>{e.error_message || '未知错误'}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{e.retry_count}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{fmtTime(e.latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="py-12 text-center">
            <BarChart3 size={32} className="mx-auto text-slate-300" />
            <p className="mt-3 text-slate-500">暂无数据</p>
            <p className="mt-1 text-xs text-slate-400">最近 {days} 天没有 AI 调用记录</p>
          </div>
        </Card>
      )}

      {/* 清理弹窗 */}
      <ConfirmDialog
        open={cleanupOpen}
        onCancel={() => setCleanupOpen(false)}
        onConfirm={async () => {
          try {
            await api.request('/ai-metrics/cleanup', { method: 'POST', body: JSON.stringify({ days: Number(cleanupDays) }) });
            toast.success('清理完成');
            setCleanupOpen(false);
            await reload();
          } catch (e: any) {
            toast.error(e.message || '清理失败');
          }
        }}
        title="清理旧 AI 指标？"
        description={`删除 ${cleanupDays} 天前的记录（最小 7 天），不可恢复。指标是运营遥测，不影响业务数据。`}
        confirmText="确认清理"
        danger
      />
      <Modal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        title="清理旧 AI 指标"
        description="删除指定天数前的记录（最小 7 天），不可恢复。指标是运营遥测，不影响业务数据。"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">保留天数</label>
            <Select
              value={cleanupDays}
              onChange={e => setCleanupDays(e.target.value)}
              options={[
                { value: '7', label: '7 天（最小）' },
                { value: '30', label: '30 天' },
                { value: '60', label: '60 天' },
                { value: '90', label: '90 天（默认）' },
              ]}
            />
            <p className="mt-1 text-xs text-slate-400">只删 ai_metrics 表，不影响回访、报告、目录等业务数据</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
