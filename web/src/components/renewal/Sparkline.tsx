import { cn } from '../../lib/utils';

export interface SparklineProps {
  /** 数据点数组（建议 12-24 个点） */
  data: number[];
  /** 颜色主题 */
  tone?: 'brand' | 'emerald' | 'violet' | 'amber' | 'red' | 'sky' | 'slate';
  /** 宽度（默认 120px） */
  width?: number;
  /** 高度（默认 32px） */
  height?: number;
  /** 是否显示点 */
  showDots?: boolean;
  /** 类名 */
  className?: string;
}

const TONES = {
  brand: { stroke: '#4F7CFF', fill: 'rgba(79, 124, 255, 0.12)', dot: '#4F7CFF' },
  emerald: { stroke: '#10B981', fill: 'rgba(16, 185, 129, 0.12)', dot: '#10B981' },
  violet: { stroke: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.12)', dot: '#8B5CF6' },
  amber: { stroke: '#F59E0B', fill: 'rgba(245, 158, 11, 0.12)', dot: '#F59E0B' },
  red: { stroke: '#EF4444', fill: 'rgba(239, 68, 68, 0.12)', dot: '#EF4444' },
  sky: { stroke: '#0EA5E9', fill: 'rgba(14, 165, 233, 0.12)', dot: '#0EA5E9' },
  slate: { stroke: '#64748B', fill: 'rgba(100, 116, 139, 0.12)', dot: '#64748B' },
} as const;

/**
 * 迷你趋势线（Sparkline）
 * - 纯 SVG，零依赖
 * - 支持区域填充 + 关键点标记
 * - 自动归一化数据到画布范围
 */
export default function Sparkline({ data, tone = 'brand', width = 120, height = 32, showDots = false, className }: SparklineProps) {
  if (!data || data.length < 2) {
    return <div className={cn('w-full h-8 opacity-30', className)} aria-hidden="true" />;
  }

  const colors = TONES[tone];
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const n = data.length - 1;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / n) * w;
    const y = padding + h - ((v - min) / range) * h;
    return { x, y };
  });

  // 生成平滑曲线路径（Catmull-Rom 简化版）
  const pathData = points.map((p, i) => {
    if (i === 0) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const prev = points[i - 1];
    const next = points[i + 1];
    if (!next) return `L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const cp1x = prev.x + (p.x - prev.x) / 2;
    const cp1y = prev.y;
    const cp2x = p.x - (next.x - p.x) / 2;
    const cp2y = p.y;
    return `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');

  // 区域填充路径
  const areaPath = [
    `M${points[0].x},${height - padding}`,
    ...points.map(p => `L${p.x},${p.y}`),
    `L${points[points.length - 1].x},${height - padding}`,
    'Z',
  ].join(' ');

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const change = data[0] !== 0 ? ((data[data.length - 1] - data[0]) / Math.abs(data[0])) * 100 : 0;

  return (
    <div className={cn('flex items-end gap-2', className)}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id={`sparkline-gradient-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.fill} stopOpacity="0.6" />
            <stop offset="100%" stopColor={colors.fill} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 区域填充 */}
        <path d={areaPath} fill={`url(#sparkline-gradient-${tone})`} />
        {/* 曲线 */}
        <path d={pathData} fill="none" stroke={colors.stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* 端点标记 */}
        {showDots && (
          <>
            <circle cx={firstPoint.x} cy={firstPoint.y} r={2.5} fill="white" stroke={colors.stroke} strokeWidth="1.5" />
            <circle cx={lastPoint.x} cy={lastPoint.y} r={3.5} fill={colors.stroke} />
          </>
        )}
      </svg>
      <div className="flex flex-col items-end text-right min-w-0">
        <span className="text-xs font-semibold tabular-nums text-slate-700">{data[data.length - 1]}</span>
        <span className={`text-[10px] font-medium ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
