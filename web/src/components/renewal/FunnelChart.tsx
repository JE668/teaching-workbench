import { cn } from '../../lib/utils';

export interface FunnelStep {
  label: string;
  count: number;
  width: number;
}

const FUNNEL_COLORS = [
  'from-brand-500 to-brand-400',
  'from-violet-500 to-violet-400',
  'from-sky-500 to-sky-400',
  'from-emerald-500 to-emerald-400',
];

/**
 * 续生漏斗。
 *
 * 层级来自续生率 sheet 的标记列：学生总数 → 上2个月有课消 → 上1个月有课消 → 本月已续费。
 * 宽度按相对第 0 层的比例缩放，一眼能看出在哪一层掉得最狠。
 */
export default function FunnelChart({ steps, unit = '人' }: { steps: FunnelStep[]; unit?: string }) {
  const total = steps.length > 0 ? steps[0].count : 0;

  if (total === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">暂无漏斗数据</div>;
  }

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={step.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-slate-500">{step.label}</span>
            <span className="font-semibold tabular-nums text-slate-700">
              {step.count} {unit}
              <span className="ml-1.5 font-normal text-slate-400">
                {total > 0 ? Math.round((step.count / total) * 100) : 0}%
              </span>
            </span>
          </div>
          <div
            className={cn('flex h-9 items-center justify-center rounded-lg bg-gradient-to-r text-sm font-semibold text-white shadow-soft', FUNNEL_COLORS[i % FUNNEL_COLORS.length])}
            style={{ width: Math.max(6, step.width) + '%' }}
          >
            {step.count}
          </div>
        </div>
      ))}
    </div>
  );
}
