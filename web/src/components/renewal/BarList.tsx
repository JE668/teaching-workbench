import { cn } from '../../lib/utils';

/**
 * 横向排名条。
 *
 * 为什么自己画而不是引图表库：
 * 前端依赖只有 react / router / tailwind（见 package.json），
 * 引 recharts/echarts 会改动 lock 文件并触发 CI 的依赖校验，
 * 而为「按人数排个序」这点诉求不值得多一个重依赖。
 * div + 宽度百分比已经完全够用。
 */
export interface BarListRow {
  /** 左侧标签（老师/学管/科组名） */
  label: string;
  /** 主要数值（已格式化为展示串，如 '12 人' / '85.7%'） */
  value: string;
  /** 条的宽度比例 0-100；相对当组最大值 */
  ratio: number;
  /** 次要说明（如「基数 40 · 续科 34」） */
  hint?: string;
  /** 覆盖默认品牌色的行底色（榜单前三用） */
  className?: string;
}

const BAR_COLORS = [
  'bg-brand-500',
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
];

export default function BarList({ rows, barColor }: { rows: BarListRow[]; barColor?: string }) {
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">暂无数据</div>;
  }

  return (
    <ol className="space-y-2.5">
      {rows.map((row, i) => (
        <li key={row.label + ':' + i} className={cn('rounded-lg px-3 py-2', row.className)}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-slate-700">{row.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{row.value}</span>
          </div>
          {row.hint && <div className="mt-0.5 text-xs text-slate-400">{row.hint}</div>}
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div
              className={cn('h-full rounded-full', barColor || BAR_COLORS[i % BAR_COLORS.length])}
              style={{ width: Math.max(2, Math.min(100, row.ratio)) + '%' }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
