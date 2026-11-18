import { GRID_STATUS_META, type GridStatus } from '../../lib/renewal';

export interface StudentCell {
  name: string;
  status: string;
}

/**
 * 学生网格（复刻 Excel 里右侧那块条件格式色块）。
 *
 * 颜色由后端在解析时按条件格式优先级算好并落库，
 * 这里只负责把 status 映射回原表的色块，不做任何判定。
 */
export default function StudentGrid({ students }: { students: StudentCell[] }) {
  if (!students || students.length === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="flex max-w-[420px] flex-wrap gap-1" role="list" aria-label="学生状态">
      {students.map((s, i) => {
        const status = s.status as GridStatus;
        const meta = GRID_STATUS_META[status] ?? GRID_STATUS_META.normal;
        return (
          <span
            key={s.name + ':' + i}
            role="listitem"
            title={s.name + ' · ' + meta.label}
            className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-slate-700"
            style={{ backgroundColor: meta.hex }}
          >
            {s.name}
          </span>
        );
      })}
    </div>
  );
}
