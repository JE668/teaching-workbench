import React from 'react';
import { cn } from '../../lib/utils';

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  progress?: number;
  trend?: { value: number; label: string } | null;
  tone?: 'brand' | 'emerald' | 'violet' | 'amber' | 'red' | 'sky' | 'slate';
  className?: string;
}

const TONES = {
  brand: { icon: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500', value: 'text-slate-800', trend: 'text-brand-600' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', value: 'text-emerald-600', trend: 'text-emerald-600' },
  violet: { icon: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500', value: 'text-violet-600', trend: 'text-violet-600' },
  amber: { icon: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', value: 'text-amber-600', trend: 'text-amber-600' },
  red: { icon: 'bg-red-50 text-red-600', bar: 'bg-red-500', value: 'text-red-600', trend: 'text-red-600' },
  sky: { icon: 'bg-sky-50 text-sky-600', bar: 'bg-sky-500', value: 'text-sky-600', trend: 'text-sky-600' },
  slate: { icon: 'bg-slate-50 text-slate-600', bar: 'bg-slate-500', value: 'text-slate-600', trend: 'text-slate-600' },
} as const;

/**
 * 汇总指标卡 — 重新设计版
 * - 更大的数值字体，视觉层级更清晰
 * - 支持趋势指标（环比/同比）
 * - 进度条更精细，支持语义色
 * - 图标区域更醒目
 */
export default function KpiCard({ label, value, hint, icon, progress, trend, tone = 'brand', className }: KpiCardProps) {
  const t = TONES[tone];
  const isUnavailable = value === '下月开启';

  return (
    <div className={cn('rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 tracking-wide uppercase">{label}</span>
            {icon && (
              <span className={cn('flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg', t.icon)}>
                {icon}
              </span>
            )}
          </div>
          <div className={cn('mt-2 text-3xl font-bold tabular-nums', t.value, isUnavailable && 'text-slate-400')}>
            {value}
          </div>
          {hint && <div className="mt-1.5 text-xs text-slate-400">{hint}</div>}
          {trend && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className={cn('text-xs font-medium flex items-center gap-0.5', t.trend)}>
                {trend.value >= 0 ? (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                )}
                {Math.abs(trend.value).toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400">{trend.label}</span>
            </div>
          )}
        </div>
      </div>
      {progress !== undefined && !isUnavailable && (
        <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all duration-500', t.bar)}
            style={{ width: Math.max(0, Math.min(100, progress)) + '%' }}
          />
        </div>
      )}
    </div>
  );
}
