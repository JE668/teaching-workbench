import { cn } from '../../lib/utils';

/**
 * 横向排名条 — 增强版
 * - 支持数值 + 进度条双重编码
 * - 前三名特殊样式（奖牌色）
 * - 悬停高亮 + tooltip 就绪
 * - 支持正/负值（激励差额场景）
 */
export interface BarListRow {
  /** 左侧标签（老师/学管/科组名） */
  label: string;
  /** 主要数值（已格式化为展示串，如 '12 人' / '85.7%'） */
  value: string;
  /** 原始数值，用于计算比例 */
  rawValue: number;
  /** 条的宽度比例 0-100；相对当组最大值 */
  ratio: number;
  /** 次要说明（如「基数 40 · 续科 34」） */
  hint?: string;
  /** 覆盖默认品牌色的行底色（榜单前三用） */
  className?: string;
  /** 是否为负值场景（激励差额：正值=还差，负值=超额） */
  isNegative?: boolean;
  /** 自定义颜色 */
  color?: string;
}

const BAR_COLORS = [
  'bg-brand-500',
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
];

const MEDAL_COLORS = [
  'bg-gradient-to-r from-amber-400 to-amber-600',
  'bg-gradient-to-r from-slate-300 to-slate-500',
  'bg-gradient-to-r from-amber-700 to-amber-900',
];

export default function BarList({
  rows,
  barColor,
  maxValue,
  showValue = true,
  compact = false,
}: {
  rows: BarListRow[];
  barColor?: string;
  maxValue?: number;
  showValue?: boolean;
  compact?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">暂无数据</div>;
  }

  const globalMax = maxValue ?? Math.max(...rows.map(r => Math.abs(r.rawValue)), 1);

  return (
    <ol className={cn('space-y-2', compact && 'space-y-1.5')}>
      {rows.map((row, i) => {
        const isTopThree = i < 3;
        const isNegative = row.isNegative ?? row.rawValue < 0;
        const barBg = row.color
          ? `bg-[${row.color}]`
          : isNegative
          ? 'bg-red-500'
          : isTopThree
          ? MEDAL_COLORS[i]
          : barColor || BAR_COLORS[i % BAR_COLORS.length];

        const valueColor = isNegative ? 'text-red-600' : 'text-slate-800';
        const ratio = globalMax > 0 ? Math.min(100, (Math.abs(row.rawValue) / globalMax) * 100) : 0;

        return (
          <li
            key={`${row.label}:${i}`}
            className={cn(
              'group rounded-lg px-3 py-2.5 transition-colors',
              compact && 'px-2.5 py-1.5',
              row.className,
              isTopThree && 'bg-amber-50/50',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn('min-w-0 truncate text-sm font-medium text-slate-700', compact && 'text-xs')}>
                {isTopThree && (
                  <span className="inline-flex items-center justify-center w-5 h-5 mr-1.5 rounded text-[10px] font-bold text-white" style={{ background: MEDAL_COLORS[i] }}>
                    {i + 1}
                  </span>
                )}
                {row.label}
              </span>
              {showValue && (
                <span className={cn('shrink-0 text-sm font-semibold tabular-nums', valueColor, compact && 'text-xs')}>
                  {row.value}
                </span>
              )}
            </div>
            {row.hint && <div className={cn('mt-1 text-xs text-slate-400', compact && 'hidden sm:block')}>{row.hint}</div>}
            <div
              className={cn('mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100', compact && 'h-1.5 mt-1')}
              aria-hidden="true"
              role="img"
              aria-label={`${row.label} ${ratio.toFixed(0)}%`}
            >
              <div
                className={cn('h-full rounded-full transition-all duration-500 ease-out', barBg)}
                style={{ width: Math.max(2, ratio) + '%' }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
