import React from 'react';
import { GRID_STATUS_META, GRID_STATUS_ORDER, type GridStatus } from '../../lib/renewal';
import { cn } from '../../lib/utils';

export interface StatusDonutProps {
  rows: { status: string; count: number }[];
  size?: 'sm' | 'md' | 'lg';
  showLegend?: boolean;
  interactive?: boolean;
  onStatusClick?: (status: GridStatus) => void;
  className?: string;
}

const SIZE_CONFIG = {
  sm: { r: 28, stroke: 10, font: 'text-xs', legendGap: 2, width: 80, height: 80 },
  md: { r: 40, stroke: 12, font: 'text-sm', legendGap: 1.5, width: 120, height: 120 },
  lg: { r: 55, stroke: 14, font: 'text-base', legendGap: 2, width: 160, height: 160 },
} as const;

export default function StatusDonut({
  rows,
  size = 'md',
  showLegend = true,
  interactive = false,
  onStatusClick,
  className,
}: StatusDonutProps) {
  const total = rows.reduce((sum, r) => sum + (r.count || 0), 0);
  const cfg = SIZE_CONFIG[size];

  if (total === 0) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <div className="text-center">
          <div className={`w-${cfg.width / 4} h-${cfg.height / 4} mx-auto mb-2 rounded-full bg-slate-100 flex items-center justify-center`}>
            <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-slate-400">暂无学生状态数据</p>
        </div>
      </div>
    );
  }

  const CIRC = 2 * Math.PI * cfg.r;
  let offset = 0;

  const segments = GRID_STATUS_ORDER.map((status) => {
    const row = rows.find(r => r.status === status);
    const value = row ? row.count : 0;
    if (value <= 0) return null;
    const len = (value / total) * CIRC;
    const seg = { status, value, len, offset, pct: (value / total) * 100 };
    offset += len;
    return seg;
  }).filter((seg): seg is { status: GridStatus; value: number; len: number; offset: number; pct: number } => seg !== null);

  const [hoveredStatus, setHoveredStatus] = React.useState<GridStatus | null>(null);

  return (
    <div className={cn('flex flex-wrap items-center gap-4 lg:gap-6', className)}>
      <div className="relative flex-shrink-0" style={{ width: cfg.width, height: cfg.height }}>
        <svg
          viewBox={`0 0 ${cfg.width} ${cfg.height}`}
          className={cn('w-full h-full -rotate-90 transition-transform', interactive && 'cursor-pointer')}
          role="img"
          aria-label={`学生状态分布，共 ${total} 人`}
          onMouseLeave={() => setHoveredStatus(null)}
        >
          <circle
            cx={cfg.width / 2}
            cy={cfg.height / 2}
            r={cfg.r}
            fill="none"
            stroke="#F1F5F9"
            strokeWidth={cfg.stroke}
          />
          {segments.map((seg) => {
            const meta = GRID_STATUS_META[seg.status] ?? GRID_STATUS_META.normal;
            const isHovered = hoveredStatus === seg.status;
            const ringColor = meta.hex.replace('#', '');
            return (
              <g
                key={seg.status}
                onMouseEnter={() => { if (interactive) setHoveredStatus(seg.status); }}
                onMouseLeave={() => { if (interactive) setHoveredStatus(null); }}
                onClick={() => { if (interactive) onStatusClick?.(seg.status); }}
                style={{
                  filter: isHovered ? 'brightness(1.1)' : 'none',
                  transition: 'filter 150ms ease',
                }}
              >
                <circle
                  cx={cfg.width / 2}
                  cy={cfg.height / 2}
                  r={cfg.r}
                  fill="none"
                  stroke={meta.hex}
                  strokeWidth={cfg.stroke}
                  strokeDasharray={`${seg.len.toFixed(1)} ${(CIRC - seg.len).toFixed(1)}`}
                  strokeDashoffset={-seg.offset}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          style={{ fontSize: size === 'sm' ? '0.65rem' : size === 'md' ? '0.85rem' : '1.1rem' }}
        >
          <span className="font-bold tabular-nums text-slate-800">{total}</span>
          <span className="text-slate-400 uppercase tracking-wider" style={{ fontSize: '0.55em' }}>总人数</span>
        </div>
      </div>

      {showLegend && (
        <ul className={cn('min-w-[160px] flex-1 space-y-2', cfg.font)}>
          {segments.map((seg) => {
            const meta = GRID_STATUS_META[seg.status] ?? GRID_STATUS_META.normal;
            const isHovered = hoveredStatus === seg.status;
            const ringColor = meta.hex.replace('#', '');
            return (
              <li
                key={seg.status}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors',
                  interactive && 'cursor-pointer hover:bg-slate-50',
                  isHovered && 'bg-brand-50/50',
                )}
                onMouseEnter={() => { if (interactive) setHoveredStatus(seg.status); }}
                onMouseLeave={() => { if (interactive) setHoveredStatus(null); }}
                onClick={() => { if (interactive) onStatusClick?.(seg.status); }}
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={cn('shrink-0 h-3 w-3 rounded-sm flex-shrink-0', isHovered && 'ring-2 ring-offset-1', 'ring-' + ringColor)}
                    style={{ backgroundColor: meta.hex }}
                  />
                  <span className={cn('truncate font-medium text-slate-700', isHovered && 'text-brand-600')}>{meta.label}</span>
                </span>
                <span className="shrink-0 flex items-center gap-1.5 text-slate-600">
                  <span className="font-semibold tabular-nums">{seg.value}</span>
                  <span className="text-slate-400">{seg.pct.toFixed(1)}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
