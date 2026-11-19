import { GRID_STATUS_META, type GridStatus } from '../../lib/renewal';

export interface StudentCell {
  name: string;
  status: string;
}

/**
 * 计算相对亮度，决定黑/白文字更易读（WCAG 对比度简化版）。
 * 公式：L = 0.2126*R + 0.7152*G + 0.0722*B，归一化到 0-1。
 * 阈值 0.5：亮底用黑字，暗底用白字。
 */
function textColorForHex(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? 'text-slate-900' : 'text-white';
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
        const textColor = textColorForHex(meta.hex);
        return (
          <span
            key={s.name + ':' + i}
            role="listitem"
            title={s.name + ' · ' + meta.label}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${textColor}`}
            style={{ backgroundColor: meta.hex }}
          >
            {s.name}
          </span>
        );
      })}
    </div>
  );
}
