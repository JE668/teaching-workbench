import React from 'react';
import { cn } from '../../lib/utils';

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  progress?: number;
  tone?: 'brand' | 'emerald' | 'violet' | 'amber' | 'red' | 'sky';
  className?: string;
}

const TONES = {
  brand: { icon: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500', value: 'text-slate-800' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', value: 'text-emerald-600' },
  violet: { icon: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500', value: 'text-violet-600' },
  amber: { icon: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', value: 'text-amber-600' },
  red: { icon: 'bg-red-50 text-red-600', bar: 'bg-red-500', value: 'text-red-600' },
  sky: { icon: 'bg-sky-50 text-sky-600', bar: 'bg-sky-500', value: 'text-sky-600' },
} as const;

/**
 * 汇总指标卡。
 * 只展示后端读出的值，不做换算 —— 进度条也是从 ratio 直接渲染。
 */
export default function KpiCard({ label, value, hint, icon, progress, tone = 'brand', className }: KpiCardProps) {
  const t = TONES[tone];
  return (
    <div className={cn('rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {icon && (
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', t.icon)}>{icon}</span>
        )}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', t.value)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
      {progress !== undefined && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', t.bar)} style={{ width: Math.max(0, Math.min(100, progress)) + '%' }} />
        </div>
      )}
    </div>
  );
}
