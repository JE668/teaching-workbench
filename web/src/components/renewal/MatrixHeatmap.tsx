import { useMemo, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, Search, Download, Filter, ArrowUpDown } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { cn } from '../../lib/utils';
import { GRID_STATUS_META, type GridStatus, type MentorMatrix, type TeacherGradeMatrix, type GroupGradeMatrix, type MatrixCellData } from '../../lib/renewal';
import CellDetailModal from './CellDetailModal';

/** 矩阵数据适配器：把三种矩阵统一转为 MatrixCellData[] */
function adaptMatrix(
  matrix: MentorMatrix | TeacherGradeMatrix | GroupGradeMatrix,
  type: 'mentor' | 'grade' | 'group'
): MatrixCellData[] {
  if (!matrix) return [];

  const rows = type === 'mentor' ? (matrix as MentorMatrix).teachers
    : type === 'grade' ? (matrix as TeacherGradeMatrix).teachers
    : (matrix as GroupGradeMatrix).subjectGroups;
  const cols = type === 'mentor' ? (matrix as MentorMatrix).managers
    : type === 'grade' ? (matrix as TeacherGradeMatrix).grades
    : (matrix as GroupGradeMatrix).grades;
  const cells = matrix.cells;

  return rows.flatMap(rowKey => {
    const rowCells = cols.map(colKey => {
      let cell;
      if (type === 'mentor') {
        const m = matrix as MentorMatrix;
        cell = m.cells.find(c => c.teacherName === rowKey && c.managerName === colKey);
      } else if (type === 'grade') {
        const m = matrix as TeacherGradeMatrix;
        cell = m.cells.find(c => c.teacherName === rowKey && c.grade === colKey);
      } else {
        const m = matrix as GroupGradeMatrix;
        cell = m.cells.find(c => c.subjectGroup === rowKey && c.grade === colKey);
      }
      return {
        rowKey,
        rowLabel: rowKey,
        colKey,
        colLabel: colKey,
        studentCount: cell?.studentCount ?? 0,
        prepaidCount: cell?.prepaidCount ?? 0,
        renewedCount: cell?.renewedCount ?? 0,
        prepaidRate: cell?.prepaidRate ?? null,
        renewRate: cell?.renewRate ?? null,
        students: cell?.students ?? [],
      };
    });
    return rowCells;
  });
}

/** 计算行/列合计 */
function computeTotals(cells: MatrixCellData[], rowKeys: string[], colKeys: string[]) {
  const rowTotals = new Map<string, { students: number; prepaid: number; renewed: number; prepaidRate: number; renewRate: number }>();
  const colTotals = new Map<string, { students: number; prepaid: number; renewed: number; prepaidRate: number; renewRate: number }>();

  for (const rowKey of rowKeys) {
    const rc = cells.filter(c => c.rowKey === rowKey);
    const totalStudents = rc.reduce((s, c) => s + c.studentCount, 0);
    const totalPrepaid = rc.reduce((s, c) => s + c.prepaidCount, 0);
    const totalRenewed = rc.reduce((s, c) => s + c.renewedCount, 0);
    rowTotals.set(rowKey, {
      students: totalStudents,
      prepaid: totalPrepaid,
      renewed: totalRenewed,
      prepaidRate: totalStudents > 0 ? (totalPrepaid / totalStudents) * 100 : 0,
      renewRate: totalPrepaid > 0 ? (totalRenewed / totalPrepaid) * 100 : 0,
    });
  }
  for (const colKey of colKeys) {
    const cc = cells.filter(c => c.colKey === colKey);
    const totalStudents = cc.reduce((s, c) => s + c.studentCount, 0);
    const totalPrepaid = cc.reduce((s, c) => s + c.prepaidCount, 0);
    const totalRenewed = cc.reduce((s, c) => s + c.renewedCount, 0);
    colTotals.set(colKey, {
      students: totalStudents,
      prepaid: totalPrepaid,
      renewed: totalRenewed,
      prepaidRate: totalStudents > 0 ? (totalPrepaid / totalStudents) * 100 : 0,
      renewRate: totalPrepaid > 0 ? (totalRenewed / totalPrepaid) * 100 : 0,
    });
  }
  return { rowTotals, colTotals };
}

/** 颜色插值：根据数值在 min-max 区间映射到颜色 */
function interpolateColor(value: number, min: number, max: number, colorStops: string[]): string {
  if (max === min) return colorStops[0];
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const index = ratio * (colorStops.length - 1);
  const i = Math.floor(index);
  const f = index - i;
  if (i >= colorStops.length - 1) return colorStops[colorStops.length - 1];

  const c1 = hexToRgb(colorStops[i]);
  const c2 = hexToRgb(colorStops[i + 1]);
  if (!c1 || !c2) return colorStops[i];
  const r = Math.round(c1.r + (c2.r - c1.r) * f);
  const g = Math.round(c1.g + (c2.g - c1.g) * f);
  const b = Math.round(c1.b + (c2.b - c1.b) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** 亮度判断：决定黑/白文字 */
function getTextColor(bgColor: string): string {
  const rgb = hexToRgb(bgColor.replace('rgb(', '').replace(')', '')) ||
    (() => { const m = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); return m ? { r: +m[1], g: +m[2], b: +m[3] } : null; })();
  if (!rgb) return '#1e293b';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? '#1e293b' : '#f8fafc';
}

interface MatrixHeatmapProps {
  /** 矩阵数据（三种之一） */
  matrix: MentorMatrix | TeacherGradeMatrix | GroupGradeMatrix | null;
  /** 矩阵类型 */
  type: 'mentor' | 'grade' | 'group';
  /** 报表 ID（用于钻取详情） */
  reportId?: number;
  /** 是否显示加载态 */
  loading?: boolean;
  /** 点击单元格回调 */
  onCellClick?: (cell: MatrixCellData) => void;
  /** 标题前缀 */
  title?: string;
  /** 是否显示排序控制 */
  showSort?: boolean;
  /** 是否显示导出按钮 */
  showExport?: boolean;
  /** 默认着色指标：'students' | 'prepaidRate' | 'renewRate' | 'prepaidCount' | 'renewedCount' */
  defaultColorBy?: 'students' | 'prepaidRate' | 'renewRate' | 'prepaidCount' | 'renewedCount';
}

const COLOR_SCALES: Record<string, string[]> = {
  students: ['#fef3c7', '#fde68a', '#fcd34d', '#f59e0b', '#d97706'], // amber
  prepaidRate: ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d'], // pink/rose
  renewRate: ['#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d'], // green
  prepaidCount: ['#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca'], // indigo
  renewedCount: ['#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857'], // emerald
};

const COLOR_LABELS: Record<string, string> = {
  students: '学生数',
  prepaidRate: '预存率',
  renewRate: '续费率',
  prepaidCount: '预存人数',
  renewedCount: '续费人数',
};

export default function MatrixHeatmap({
  matrix,
  type,
  reportId,
  loading = false,
  onCellClick,
  title,
  showSort = true,
  showExport = false,
  defaultColorBy = 'students',
}: MatrixHeatmapProps) {
  const [colorBy, setColorBy] = useState(defaultColorBy);
  const [sortBy, setSortBy] = useState<'label' | 'students' | 'prepaidRate' | 'renewRate'>('label');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDetail, setShowDetail] = useState<MatrixCellData | null>(null);

  const adaptedCells = useMemo(() => adaptMatrix(matrix!, type), [matrix, type]);
  if (!matrix || adaptedCells.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title={title || '匹配矩阵'} />
        <CardBody className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <Filter className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-medium text-slate-600 mb-1">暂无矩阵数据</h3>
          <p className="text-sm text-slate-400">当前报表未生成该维度矩阵</p>
        </CardBody>
      </Card>
    );
  }

  const rowKeys = useMemo(() => [...new Set(adaptedCells.map(c => c.rowKey))], [adaptedCells]);
  const colKeys = useMemo(() => [...new Set(adaptedCells.map(c => c.colKey))], [adaptedCells]);

  const { rowTotals, colTotals } = useMemo(() => computeTotals(adaptedCells, rowKeys, colKeys), [adaptedCells, rowKeys, colKeys]);

  // 排序行
  const sortedRowKeys = useMemo(() => {
    if (sortBy === 'label') {
      return [...rowKeys].sort((a, b) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
    }
    return [...rowKeys].sort((a, b) => {
      const va = rowTotals.get(a)?.[sortBy] ?? 0;
      const vb = rowTotals.get(b)?.[sortBy] ?? 0;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [rowKeys, sortBy, sortDir, rowTotals]);

  // 搜索过滤
  const filteredRowKeys = useMemo(() => {
    if (!searchQuery) return sortedRowKeys;
    const q = searchQuery.toLowerCase();
    return sortedRowKeys.filter(k => k.toLowerCase().includes(q));
  }, [sortedRowKeys, searchQuery]);

  // 计算色阶范围
  const colorScale = COLOR_SCALES[colorBy];
  const values = adaptedCells.map(c => {
    switch (colorBy) {
      case 'students': return c.studentCount;
      case 'prepaidRate': return c.prepaidRate ?? -1;
      case 'renewRate': return c.renewRate ?? -1;
      case 'prepaidCount': return c.prepaidCount;
      case 'renewedCount': return c.renewedCount;
    }
  }).filter(v => v >= 0);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;

  const handleCellClick = useCallback((cell: MatrixCellData) => {
    if (onCellClick) onCellClick(cell);
    setShowDetail(cell);
  }, [onCellClick]);

  const formatRate = (rate: number | null) => rate === null ? '—' : rate.toFixed(1) + '%';
  const formatCount = (count: number) => count === 0 ? '—' : String(count);

  const headerLabel = type === 'mentor' ? '教师' : type === 'grade' ? '教师' : '科组';
  const colHeaderLabel = type === 'mentor' ? '学管' : '年级';

  return (
    <Card className="h-full">
      <CardHeader
        title={title || (type === 'mentor' ? '教师 × 学管匹配矩阵' : type === 'grade' ? '教师 × 年级分布' : '科组 × 年级分布')}
         action={
          <div className="flex items-center gap-2">
            {showSort && (
              <div className="flex items-center gap-1.5" role="group" aria-label="排序与着色">
                <span className="text-xs text-slate-500">着色：</span>
                <select
                  value={colorBy}
                  onChange={e => setColorBy(e.target.value as any)}
                  className="text-xs rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:border-brand-400"
                >
                  {Object.entries(COLOR_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-500 ml-2">排序：</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="text-xs rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:border-brand-400"
                >
                  <option value="label">名称</option>
                  <option value="students">学生数</option>
                  <option value="prepaidRate">预存率</option>
                  <option value="renewRate">续费率</option>
                </select>
                <button
                  onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className="p-1 rounded hover:bg-slate-100 text-slate-500"
                  aria-label={sortDir === 'asc' ? '降序' : '升序'}
                >
                  {sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
            <div className="relative">
              <input
                type="search"
                placeholder="搜索行标签…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-48 sm:w-56 h-8 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>
            {showExport && (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => exportMatrix(adaptedCells, rowKeys, colKeys, type)}
              >
                <Download className="h-3.5 w-3.5" />
                导出 CSV
              </button>
            )}
          </div>
          }
        />
      <CardBody className="p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-500 border-t-transparent" />
            <span className="ml-3 text-sm text-slate-500">加载矩阵中…</span>
          </div>
        )}

        {!loading && (
          <>
            {/* 色阶图例 */}
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500" aria-label="热力图色阶">
              <span className="font-medium text-slate-700">色阶（${COLOR_LABELS[colorBy]}）：</span>
              <div className="flex items-center gap-1">
                {colorScale.map((color, i) => (
                  <div
                    key={i}
                    className="w-6 h-4 rounded border border-slate-200"
                    style={{ backgroundColor: color }}
                    title={`${Math.round(minVal + (maxVal - minVal) * (i / (colorScale.length - 1)))} ${colorBy.includes('Rate') ? '%' : '人'}`}
                  />
                ))}
              </div>
            </div>

            {/* 矩阵表格 */}
            <div className="overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label={`${title || '矩阵'} 可横向滚动`} tabIndex={0}>
              <table className="w-full text-left text-sm min-w-max">
                <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0 z-10">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 font-medium sticky left-0 z-20 bg-slate-50 border-r border-slate-200 min-w-[140px]">
                      ${headerLabel}
                      <span className="ml-1 text-[10px] text-slate-400">(${filteredRowKeys.length}/${rowKeys.length})</span>
                    </th>
                    {colKeys.map(col => (
                      <th key={col} className="px-3 py-2 font-medium text-center min-w-[110px] whitespace-nowrap">
                        ${col}
                        <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                          ${formatCount(colTotals.get(col)?.students ?? 0)} 人
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium text-center min-w-[110px] border-l border-slate-200 bg-slate-50/50 sticky right-0 z-20">
                      合计
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRowKeys.map(rowKey => {
                    const total = rowTotals.get(rowKey);
                    return (
                      <tr key={rowKey} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 z-10 bg-white border-r border-slate-200">
                          ${rowKey}
                        </td>
                        {colKeys.map(col => {
                          const cell = adaptedCells.find(c => c.rowKey === rowKey && c.colKey === col);
                          if (!cell || cell.studentCount === 0) {
                            return (
                              <td key={col} className="px-3 py-2 text-center text-slate-300">—</td>
                            );
                          }
                          const val = colorBy === 'students' ? cell.studentCount
                            : colorBy === 'prepaidRate' ? (cell.prepaidRate ?? -1)
                            : colorBy === 'renewRate' ? (cell.renewRate ?? -1)
                            : colorBy === 'prepaidCount' ? cell.prepaidCount
                            : cell.renewedCount;
                          const bgColor = val >= 0 ? interpolateColor(val, minVal, maxVal, colorScale) : '#f8fafc';
                          const textColor = val >= 0 ? getTextColor(bgColor) : '#94a3b8';

                          return (
                            <td
                              key={col}
                              className="px-2 py-2 text-center relative cursor-pointer hover:bg-brand-50/30 transition-colors"
                              onClick={() => handleCellClick(cell!)}
                              style={{ backgroundColor: bgColor }}
                              title={`${cell.studentCount} 人 · 预存 ${cell.prepaidCount} · 续费 ${cell.renewedCount} · 预存率 ${formatRate(cell.prepaidRate)} · 续费率 ${formatRate(cell.renewRate)}`}
                              role="button"
                              tabIndex={0}
                              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleCellClick(cell!)}
                            >
                              <div className="font-medium" style={{ color: textColor }}>
                                ${formatCount(cell.studentCount)}
                              </div>
                              <div className="flex justify-center gap-1 text-[10px] mt-0.5" style={{ color: textColor }}>
                                <span className="px-1 py-0.5 rounded bg-white/70 backdrop-blur-sm">预 ${formatCount(cell.prepaidCount)}</span>
                                <span className="px-1 py-0.5 rounded bg-white/70 backdrop-blur-sm">续 ${formatCount(cell.renewedCount)}</span>
                              </div>
                              {(cell.prepaidRate !== null || cell.renewRate !== null) && (
                                <div className="text-[9px] mt-0.5" style={{ color: textColor }}>
                                  ${cell.prepaidRate !== null ? '预 ' + cell.prepaidRate.toFixed(1) + '%' : '—'} · ${cell.renewRate !== null ? '续 ' + cell.renewRate.toFixed(1) + '%' : '—'}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center font-medium text-slate-700 bg-slate-50/50 border-l border-slate-200 sticky right-0 z-10">
                          <div>${formatCount(total?.students ?? 0)}</div>
                          <div className="flex justify-center gap-1 text-xs mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 ${formatCount(total?.prepaid ?? 0)}</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 ${formatCount(total?.renewed ?? 0)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* 列合计行 */}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-3 py-2 sticky left-0 z-10 bg-slate-100 border-r border-slate-200">合计</td>
                    {colKeys.map(col => {
                      const total = colTotals.get(col);
                      return (
                        <td key={col} className="px-3 py-2 text-center border-t border-slate-200">
                          <div>${formatCount(total?.students ?? 0)}</div>
                          <div className="flex justify-center gap-1 text-xs mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 ${formatCount(total?.prepaid ?? 0)}</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 ${formatCount(total?.renewed ?? 0)}</span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center border-t border-slate-200 border-l border-slate-200 bg-slate-200 sticky right-0 z-10">
                      <div>${adaptedCells.reduce((s, c) => s + c.studentCount, 0)}</div>
                      <div className="flex justify-center gap-1 text-xs mt-0.5">
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 ${adaptedCells.reduce((s, c) => s + c.prepaidCount, 0)}</span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 ${adaptedCells.reduce((s, c) => s + c.renewedCount, 0)}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {searchQuery && filteredRowKeys.length === 0 && (
              <div className="mt-4 text-center text-sm text-slate-400">未找到匹配 "${searchQuery}" 的行</div>
            )}
          </>
        )}

        {/* 单元格详情 Modal */}
        {showDetail && reportId && (
          <CellDetailModal
            cell={showDetail}
            type={type}
            reportId={reportId}
            onClose={() => setShowDetail(null)}
            isOpen={!!showDetail}
          />
        )}
      </CardBody>
    </Card>
  );
}

/** 导出矩阵为 CSV */
function exportMatrix(cells: MatrixCellData[], rowKeys: string[], colKeys: string[], type: string) {
  const headers = ['行标签', ...colKeys, '合计_学生数', '合计_预存', '合计_续费'];
  const rows = rowKeys.map(rowKey => {
    const rowData = colKeys.map(colKey => {
      const cell = cells.find(c => c.rowKey === rowKey && c.colKey === colKey);
      return cell ? `${cell.studentCount} (${cell.prepaidRate !== null ? cell.prepaidRate.toFixed(1) + '%' : '—'} / ${cell.renewRate !== null ? cell.renewRate.toFixed(1) + '%' : '—'})` : '—';
    });
    const total = cells.filter(c => c.rowKey === rowKey).reduce((s, c) => ({ students: s.students + c.studentCount, prepaid: s.prepaid + c.prepaidCount, renewed: s.renewed + c.renewedCount }), { students: 0, prepaid: 0, renewed: 0 });
    return [rowKey, ...rowData, total.students, total.prepaid, total.renewed];
  });
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `matrix-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
