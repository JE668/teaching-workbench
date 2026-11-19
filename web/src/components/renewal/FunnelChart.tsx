import { cn } from '../../lib/utils';

export interface FunnelStep {
  label: string;
  count: number;
  width: number;
  /** 可选：转化率（相对于上一层） */
  conversionRate?: number;
  /** 可选：流失数 */
  dropOff?: number;
}

const FUNNEL_COLORS = [
  'from-brand-500 to-brand-400',
  'from-violet-500 to-violet-400',
  'from-sky-500 to-sky-400',
  'from-emerald-500 to-emerald-400',
];

const FUNNEL_BG_COLORS = [
  'bg-brand-50 border-brand-100',
  'bg-violet-50 border-violet-100',
  'bg-sky-50 border-sky-100',
  'bg-emerald-50 border-emerald-100',
];

/**
 * 续生漏斗 — 增强版
 * - 每层显示：标签、人数、占总比、转化率、流失数
 * - 视觉上用梯形/渐变块表示收窄
 * - 支持点击/悬停查看详情
 */
export default function FunnelChart({
  steps,
  unit = '人',
  onStepClick,
}: {
  steps: FunnelStep[];
  unit?: string;
  onStepClick?: (step: FunnelStep, index: number) => void;
}) {
  const total = steps.length > 0 ? steps[0].count : 0;

  if (total === 0) {
    return (
      <div className="py-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <p className="text-sm text-slate-400">暂无漏斗数据</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" role="list" aria-label="续生漏斗">
      {steps.map((step, i) => {
        const prevCount = i === 0 ? total : steps[i - 1].count;
        const conversionRate = step.conversionRate ?? (prevCount > 0 ? (step.count / prevCount) * 100 : 0);
        const dropOff = step.dropOff ?? (prevCount - step.count);
        const widthPct = Math.max(6, step.width);
        const isClickable = typeof onStepClick === 'function';

        return (
          <div
            key={step.label}
            className={cn(
              'relative rounded-xl border overflow-hidden transition-all duration-300',
              FUNNEL_BG_COLORS[i % FUNNEL_BG_COLORS.length],
              isClickable && 'cursor-pointer hover:shadow-md hover:border-brand-300',
            )}
            onClick={() => onStepClick?.(step, i)}
            role="listitem"
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStepClick?.(step, i); }} : undefined}
          >
            <div className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('text-sm font-semibold text-slate-800', i === 0 && 'text-lg')}>
                      {step.label}
                    </span>
                    {i > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                        第 {i} 层
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="font-semibold tabular-nums text-slate-700">{step.count}</span>
                      <span>{unit}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="font-medium tabular-nums">{total > 0 ? Math.round((step.count / total) * 100) : 0}%</span>
                      <span>总量</span>
                    </span>
                    {i > 0 && (
                      <>
                        <span className="flex items-center gap-1 text-emerald-600">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                          <span className="font-medium tabular-nums">{conversionRate.toFixed(1)}%</span>
                          <span>转化</span>
                        </span>
                        {dropOff > 0 && (
                          <span className="flex items-center gap-1 text-red-600">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 17l5-5m0 0l5 5m-5-5v-10" /></svg>
                            <span className="font-medium tabular-nums">{dropOff}</span>
                            <span>流失</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {/* 右侧可视化块 */}
                <div
                  className={cn(
                    'flex-shrink-0 flex items-center justify-center rounded-lg text-sm font-bold text-white shadow-soft',
                    FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                  )}
                  style={{ width: widthPct + '%', minWidth: '60px', height: '44px' }}
                  aria-hidden="true"
                >
                  <span className="tabular-nums">{step.count}</span>
                </div>
              </div>
            </div>
            {/* 底部视觉分割线 - 漏斗收窄效果 */}
            {i < steps.length - 1 && (
              <div
                className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent -mx-4"
                style={{ width: 'calc(100% + 1rem)' }}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
