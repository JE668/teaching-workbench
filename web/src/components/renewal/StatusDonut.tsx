import { GRID_STATUS_META, GRID_STATUS_ORDER, type GridStatus } from '../../lib/renewal';

/**
 * 学生网格颜色状态分布（环形图）。
 *
 * SVG 手画：不引图表库（前端依赖只有 react/router/tailwind）。
 * 各段颜色取自 Excel 条件格式的原始色值，图例与色块共用同一份 meta。
 */
export default function StatusDonut({ rows }: { rows: { status: string; count: number }[] }) {
  const total = rows.reduce((sum, r) => sum + (r.count || 0), 0);
  if (total === 0) {
    return <div className="py-8 text-center text-sm text-slate-400">暂无学生网格数据</div>;
  }

  // 圆环用 stroke-dasharray 分段：r=45 时周长 = 2*PI*45 ≈ 282.74
  const R = 45;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  const segments = GRID_STATUS_ORDER.map((status) => {
    const row = rows.find(r => r.status === status);
    const value = row ? row.count : 0;
    if (value <= 0) return null;
    const len = (value / total) * CIRC;
    const seg = { status, value, len, offset };
    offset += len;
    return seg;
  }).filter((seg): seg is { status: GridStatus; value: number; len: number; offset: number } => seg !== null);

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label="学生状态分布">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#F1F5F9" strokeWidth="14" />
        {segments.map((seg) => {
          const meta = GRID_STATUS_META[seg.status] ?? GRID_STATUS_META.normal;
          return (
            <circle
              key={seg.status}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={meta.hex}
              strokeWidth="14"
              strokeDasharray={String(seg.len) + ' ' + String(CIRC - seg.len)}
              strokeDashoffset={-seg.offset}
            />
          );
        })}
      </svg>
      <ul className="min-w-[180px] flex-1 space-y-1.5 text-sm">
        {segments.map((seg) => {
          const meta = GRID_STATUS_META[seg.status] ?? GRID_STATUS_META.normal;
          return (
            <li key={seg.status} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-slate-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: meta.hex }} />
                {meta.label}
              </span>
              <span className="font-medium tabular-nums text-slate-700">
                {seg.value}
                <span className="ml-1 text-xs text-slate-400">{Math.round((seg.value / total) * 100)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
