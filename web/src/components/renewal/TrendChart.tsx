import { useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { cn } from '../../lib/utils';
import { TrendingUp, BarChart3, Download, RotateCcw } from 'lucide-react';
import { count, pct } from '../../lib/renewal';

/** 多期对比数据点（来自 /analytics/multi-period） */
export interface PeriodSnapshot {
  reportId: number;
  statMonth: string;
  centerName: string | null;
  uploadedAt: string;
  overview: {
    baseCount: number | null;
    prepaidCount: number | null;
    renewedCount: number | null;
    prepaidRate: number | null;
    renewRate: number | null;
    incentiveGap: number | null;
  };
  teacherCount: number;
}

/** 趋势数据点 */
export interface TrendPoint {
  month: string;
  label: string;
  value: number | null;
  rawValue: number;
}

const METRIC_DEFINITIONS = [
  { key: 'baseCount', label: '学生基数', unit: '人', format: count, color: '#4F7CFF', isRate: false },
  { key: 'prepaidCount', label: '预存人数', unit: '人', format: count, color: '#8B5CF6', isRate: false },
  { key: 'renewedCount', label: '续费人数', unit: '人', format: count, color: '#10B981', isRate: false },
  { key: 'prepaidRate', label: '预存率', unit: '%', format: (v: number | null) => pct(v), color: '#0EA5E9', isRate: true },
  { key: 'renewRate', label: '续费率', unit: '%', format: (v: number | null) => pct(v), color: '#F59E0B', isRate: true },
  { key: 'incentiveGap', label: '激励差额', unit: '人', format: count, color: '#EF4444', isRate: false },
] as const;

type MetricKey = typeof METRIC_DEFINITIONS[number]['key'];

interface TrendChartProps {
  /** 多期对比数据 */
  snapshots: PeriodSnapshot[];
  /** 当前报表 ID（可选，用于高亮当前月份） */
  currentReportId?: number;
  /** 当前选中的指标 */
  metric?: MetricKey;
  /** 指标变更回调 */
  onMetricChange?: (key: MetricKey) => void;
  /** 高度 */
  height?: number;
  /** 是否显示面积填充 */
  showArea?: boolean;
  /** 是否显示数据点 */
  showDots?: boolean;
  /** 自定义标题 */
  title?: string;
  /** 是否显示同比/环比 */
  showComparison?: boolean;
}

function extractTrendData(snapshots: PeriodSnapshot[], metric: MetricKey): TrendPoint[] {
  // 按月份排序
  const sorted = [...snapshots].sort((a, b) => a.statMonth.localeCompare(b.statMonth));
  return sorted.map(s => {
    const overview = s.overview as any;
    const value = overview[metric] ?? null;
    return {
      month: s.statMonth,
      label: `${s.statMonth}月`,
      value,
      rawValue: typeof value === 'number' && Number.isFinite(value) ? value : 0,
    };
  });
}

function computeComparison(trendPoints: TrendPoint[]) {
  if (trendPoints.length < 2) return null;
  const current = trendPoints[trendPoints.length - 1];
  const previous = trendPoints[trendPoints.length - 2];
  if (current.rawValue === 0 && previous.rawValue === 0) return { mom: null, yoy: null };

  const mom = previous.rawValue !== 0
    ? ((current.rawValue - previous.rawValue) / Math.abs(previous.rawValue)) * 100
    : null;

  // 同比：找 12 个月前的数据点
  const currentMonth = current.month;
  const yoyIndex = trendPoints.findIndex(p => {
    const pm = parseInt(p.month, 10);
    const cm = parseInt(currentMonth, 10);
    return pm === ((cm - 12 - 1) % 12) + 1; // 简化：同比很难在不同年份数据中匹配，返回 null
  });
  const yoy = null; // 需要跨年数据支持

  return { mom, yoy };
}

export default function TrendChart({
  snapshots,
  currentReportId,
  metric = 'renewRate',
  onMetricChange,
  height = 300,
  showArea = true,
  showDots = true,
  title,
  showComparison = true,
}: TrendChartProps) {
  const [selectedMetric, setSelectedMetric] = useState(metric);
  const [showTargets, setShowTargets] = useState(false);

  const trendData = useMemo(() => extractTrendData(snapshots, selectedMetric), [snapshots, selectedMetric]);
  const comparison = useMemo(() => computeComparison(trendData), [trendData]);
  const metricDef = METRIC_DEFINITIONS.find(m => m.key === selectedMetric)!;

  const validPoints = trendData.filter(p => p.value !== null);
  const values = validPoints.map(p => p.rawValue);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const range = maxVal - minVal || 1;

  // SVG 尺寸
  const width = 600; // 响应式由容器控制
  const padding = { top: 20, right: 30, bottom: 40, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // 生成平滑曲线路径
  const pathData = validPoints.map((p, i) => {
    const x = padding.left + (i / (validPoints.length - 1 || 1)) * innerWidth;
    const y = padding.top + innerHeight - ((p.rawValue - minVal) / range) * innerHeight;
    if (i === 0) return `M${x.toFixed(1)},${y.toFixed(1)}`;
    const prev = validPoints[i - 1];
    const prevX = padding.left + ((i - 1) / (validPoints.length - 1 || 1)) * innerWidth;
    const prevY = padding.top + innerHeight - ((prev.rawValue - minVal) / range) * innerHeight;
    const cp1x = prevX + (x - prevX) / 2;
    const cp1y = prevY;
    const cp2x = x - (x - prevX) / 2;
    const cp2y = y;
    return `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // 面积填充路径
  const areaPath = [
    `M${padding.left},${padding.top + innerHeight}`,
    ...validPoints.map((p, i) => {
      const x = padding.left + (i / (validPoints.length - 1 || 1)) * innerWidth;
      const y = padding.top + innerHeight - ((p.rawValue - minVal) / range) * innerHeight;
      return `L${x.toFixed(1)},${y.toFixed(1)}`;
    }),
    `L${padding.left + innerWidth},${padding.top + innerHeight}`,
    'Z',
  ].join(' ');

  // Y 轴刻度
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => minVal + (range * i) / (yTicks - 1));

  if (snapshots.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title={title || '多期趋势'} icon={<TrendingUp className="h-5 w-5" />} />
        <CardBody className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-medium text-slate-600 mb-1">暂无多期对比数据</h3>
          <p className="text-sm text-slate-400">需上传多期报表并选择同一校区</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader
        title={title || '多期趋势对比'}
        icon={<TrendingUp className="h-5 w-5" />}
        description={`共 ${snapshots.length} 期数据 · 当前指标：${metricDef.label}`}
        action={
          <div className="flex items-center gap-2">
            <select
              value={selectedMetric}
              onChange={e => { const k = e.target.value as MetricKey; setSelectedMetric(k); onMetricChange?.(k); }}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-brand-400"
            >
              {METRIC_DEFINITIONS.map(m => (
                <option key={m.key} value={m.key}>${m.label} (${m.unit})</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showTargets} onChange={e => setShowTargets(e.target.checked)} className="rounded border-slate-300 text-brand-600" />
              显示目标线
            </label>
            <button className="p-1.5 rounded hover:bg-slate-100 text-slate-500" aria-label="导出趋势数据">
              <Download className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <CardBody className="p-4">
        {/* 同比/环比指标卡 */}
        {showComparison && comparison && (
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 ring-1 ring-slate-100">
              <span className="text-xs text-slate-500">环比</span>
              <span className={cn('text-sm font-semibold', comparison.mom !== null && comparison.mom > 0 ? 'text-emerald-600' : comparison.mom !== null && comparison.mom < 0 ? 'text-red-600' : 'text-slate-600')}>
                {comparison.mom !== null ? `${comparison.mom > 0 ? '+' : ''}${comparison.mom.toFixed(1)}%` : '—'}
              </span>
              <span className="text-xs text-slate-400">vs 上月</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 ring-1 ring-slate-100">
              <span className="text-xs text-slate-500">最新值</span>
              <span className="text-sm font-semibold text-slate-800">
                {validPoints.length ? metricDef.format(validPoints[validPoints.length - 1].value) : '—'}
              </span>
            </div>
          </div>
        )}

        {/* SVG 图表 */}
        <div className="relative" style={{ width: '100%', maxWidth: width, margin: '0 auto' }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`${metricDef.label} 趋势图`}>
            <defs>
              <linearGradient id="trend-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metricDef.color} stopOpacity="0.15" />
                <stop offset="100%" stopColor={metricDef.color} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="trend-line-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={metricDef.color} />
                <stop offset="100%" stopColor={metricDef.color} stopOpacity="0.6" />
              </linearGradient>
            </defs>

            {/* Y 轴网格线 */}
            <g stroke="#e2e8f0" strokeWidth="0.5">
              {yTickValues.map(val => {
                const y = padding.top + innerHeight - ((val - minVal) / range) * innerHeight;
                return (
                  <line key={val} x1={padding.left} y1={y} x2={padding.left + innerWidth} y2={y} />
                );
              })}
            </g>

            {/* Y 轴刻度标签 */}
            <g fontSize="10" fill="#94a3b8" textAnchor="end">
              {yTickValues.map(val => {
                const y = padding.top + innerHeight - ((val - minVal) / range) * innerHeight;
                return (
                  <text key={val} x={padding.left - 8} y={y + 3} dominantBaseline="central">
                    {metricDef.isRate ? val.toFixed(1) + '%' : count(val)}
                  </text>
                );
              })}
            </g>

            {/* X 轴网格线 */}
            <g stroke="#e2e8f0" strokeWidth="0.5">
              {validPoints.map((_, i) => {
                const x = padding.left + (i / (validPoints.length - 1 || 1)) * innerWidth;
                return <line key={i} x1={x} y1={padding.top} x2={x} y2={padding.top + innerHeight} />;
              })}
            </g>

            {/* 面积填充 */}
            {showArea && (
              <path d={areaPath} fill="url(#trend-area-gradient)" />
            )}

            {/* 曲线 */}
            <path d={pathData} fill="none" stroke="url(#trend-line-gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

            {/* 数据点 */}
            {showDots && validPoints.map((p, i) => (
              <g key={i}>
                <circle
                  cx={padding.left + (i / (validPoints.length - 1 || 1)) * innerWidth}
                  cy={padding.top + innerHeight - ((p.rawValue - minVal) / range) * innerHeight}
                  r={4}
                  fill="white"
                  stroke={metricDef.color}
                  strokeWidth="2.5"
                />
                <circle
                  cx={padding.left + (i / (validPoints.length - 1 || 1)) * innerWidth}
                  cy={padding.top + innerHeight - ((p.rawValue - minVal) / range) * innerHeight}
                  r={2}
                  fill={metricDef.color}
                />
              </g>
            ))}

            {/* 目标线：预存率/续费率 80% */}
            {showTargets && metricDef.isRate && (
              <line
                x1={padding.left}
                y1={padding.top + innerHeight - ((80 - minVal) / range) * innerHeight}
                x2={padding.left + innerWidth}
                y2={padding.top + innerHeight - ((80 - minVal) / range) * innerHeight}
                stroke="#10B981"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.7"
              />
            )}
          </svg>

          {/* X 轴标签 */}
          <div className="flex justify-between px-2 mt-1 text-xs text-slate-500" style={{ width: '100%', maxWidth: width, margin: '0 auto' }}>
            {validPoints.map((p, i) => (
              <span key={i} style={{ width: `${100 / (validPoints.length - 1 || 1)}%`, textAlign: i === 0 ? 'left' : i === validPoints.length - 1 ? 'right' : 'center' }}>
                {p.label}
              </span>
            ))}
          </div>
        </div>

        {/* 数据表格 */}
        <div className="mt-6 rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-medium">月份</th>
                  <th className="px-4 py-3 font-medium text-right">${metricDef.label}</th>
                  <th className="px-4 py-3 font-medium text-right">环比</th>
                  <th className="px-4 py-3 font-medium">校区</th>
                  <th className="px-4 py-3 font-medium">上传时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trendData.slice().reverse().map((p, i) => {
                  const mom = i < trendData.length - 1
                    ? trendData[trendData.length - 2 - i]?.rawValue
                    : null;
                  const momPct = mom !== null && mom !== 0
                    ? ((p.rawValue - mom) / Math.abs(mom)) * 100
                    : null;
                  return (
                    <tr key={p.month} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-700">${p.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                        {p.value !== null ? metricDef.format(p.value) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {momPct !== null ? (
                          <span className={cn('font-medium', momPct > 0 ? 'text-emerald-600' : momPct < 0 ? 'text-red-600' : 'text-slate-600')}>
                            {momPct > 0 ? '+' : ''}${momPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {snapshots.find(s => s.statMonth === p.month)?.centerName || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {snapshots.find(s => s.statMonth === p.month)?.uploadedAt?.slice(0, 10) || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
