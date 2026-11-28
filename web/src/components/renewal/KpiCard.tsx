import React from 'react';
import { cn } from '../../lib/utils';
import Sparkline from './Sparkline';

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  /** 进度 0-100；若不传则不显示进度条 */
  progress?: number;
  /** 进度条语义色：根据业务指标自动判断，或显式指定 */
  progressTone?: 'auto' | 'success' | 'warning' | 'danger' | 'neutral';
  /** 趋势：数值为变化百分比，正=上升，负=下降 */
  trend?: { value: number; label: string } | null;
  /** 迷你趋势图数据点（建议 12-24 个点） */
  sparkline?: number[];
  /** 数据新鲜度：'live' | 'recent' | 'stale' | 'unknown' */
  freshness?: 'live' | 'recent' | 'stale' | 'unknown';
  /** 单位后缀（如 '人'、'万'、'%'），显示在数值右侧小字 */
  unit?: string;
  /** 色调主题 */
  tone?: 'brand' | 'emerald' | 'violet' | 'amber' | 'red' | 'sky' | 'slate';
  className?: string;
}

const TONES = {
  brand: { icon: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500', value: 'text-slate-800', trend: 'text-brand-600', ring: 'ring-brand-500/20' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', value: 'text-emerald-600', trend: 'text-emerald-600', ring: 'ring-emerald-500/20' },
  violet: { icon: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500', value: 'text-violet-600', trend: 'text-violet-600', ring: 'ring-violet-500/20' },
  amber: { icon: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', value: 'text-amber-600', trend: 'text-amber-600', ring: 'ring-amber-500/20' },
  red: { icon: 'bg-red-50 text-red-600', bar: 'bg-red-500', value: 'text-red-600', trend: 'text-red-600', ring: 'ring-red-500/20' },
  sky: { icon: 'bg-sky-50 text-sky-600', bar: 'bg-sky-500', value: 'text-sky-600', trend: 'text-sky-600', ring: 'ring-sky-500/20' },
  slate: { icon: 'bg-slate-50 text-slate-600', bar: 'bg-slate-500', value: 'text-slate-600', trend: 'text-slate-600', ring: 'ring-slate-500/20' },
} as const;

const PROGRESS_TONES = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  neutral: 'bg-slate-400',
  auto: 'bg-brand-500',
} as const;

const FRESHNESS_CONFIG = {
  live: { dot: 'bg-emerald-500', label: '实时', title: '数据为最新上传批次' },
  recent: { dot: 'bg-sky-500', label: '分钟前', title: '数据在 1 小时内更新' },
  stale: { dot: 'bg-amber-500', label: '较旧', title: '数据超过 1 小时未更新' },
  unknown: { dot: 'bg-slate-400', label: '未知', title: '无法确定数据时间' },
} as const;

/**
 * 汇总指标卡 — Phase 2 增强版
 * - 数值更大、视觉层级更清晰
 * - 支持趋势指标（环比/同比）+ 语义色箭头
 * - 进度条支持语义色（达标绿/预警黄/危险红）
 * - 内嵌 Sparkline 迷你趋势图
 * - 数据新鲜度指示器
 * - 单位后缀标准化
 * - 更醒目的图标区域
 */
export default function KpiCard({
  label,
  value,
  hint,
  icon,
  progress,
  progressTone = 'auto',
  trend,
  sparkline,
  freshness = 'unknown',
  unit,
  tone = 'brand',
  className,
}: KpiCardProps) {
  const t = TONES[tone];
  const isUnavailable = value === '下月开启' || value === '—';
  const freshnessCfg = FRESHNESS_CONFIG[freshness];

  // 自动推断进度条语义色
  const resolvedProgressTone = progressTone === 'auto'
    ? (progress !== undefined && progress >= 80 ? 'success' : progress !== undefined && progress >= 60 ? 'warning' : 'danger')
    : progressTone;
  const progressColor = PROGRESS_TONES[resolvedProgressTone];

  return (
    <div className={cn(
      'rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card transition-all duration-200 hover:shadow-card-hover',
      className,
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 tracking-wide uppercase">{label}</span>
              {/* 数据新鲜度指示器 */}
              <span
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white',
                  freshnessCfg.dot,
                )}
                title={freshnessCfg.title}
              >
                {freshnessCfg.label}
              </span>
            </div>
            {icon && (
              <span className={cn('flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-xl', t.icon, t.ring)}>
                {icon}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className={cn('text-3xl font-bold tabular-nums', t.value, isUnavailable && 'text-slate-400')}>
              {value}
            </span>
            {unit && !isUnavailable && (
              <span className="text-lg font-medium text-slate-400 self-end mb-1">{unit}</span>
            )}
          </div>
          {hint && <div className="mt-1.5 text-xs text-slate-400">{hint}</div>}
          {trend && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className={cn(
                'text-xs font-medium flex items-center gap-0.5',
                trend.value > 0 ? 'text-emerald-600' : trend.value < 0 ? 'text-red-600' : 'text-slate-400',
              )}>
                {trend.value > 0 ? (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                ) : trend.value < 0 ? (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M5 12h14" />
                  </svg>
                )}
                {trend.value > 0 ? '+' : ''}{Math.abs(trend.value).toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400">{trend.label}</span>
            </div>
          )}
          {/* Sparkline 迷你趋势图 */}
          {sparkline && sparkline.length > 1 && (
            <div className="mt-3" aria-label={`${label} 趋势：${sparkline.join(', ')}`}>
              <Sparkline data={sparkline} tone={tone} width={160} height={36} showDots={false} />
            </div>
          )}
        </div>
      </div>
      {progress !== undefined && !isUnavailable && (
        <div className="mt-3.5">
          <div className="flex items-center justify-between text-[10px] font-medium mb-1">
            <span className="text-slate-400">进度</span>
            <span className={cn('text-slate-600', progress >= 80 ? 'text-emerald-600' : progress >= 60 ? 'text-amber-600' : 'text-red-600')}>
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn('h-full rounded-full transition-all duration-700 ease-out', progressColor)}
              style={{ width: Math.max(0, Math.min(100, progress)) + '%' }}
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${label} 完成度 ${Math.round(progress)}%`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
