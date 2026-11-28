import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Search, Filter, Download, X, ArrowUpDown,
  Grid, List, FileText, AlertTriangle, CheckCircle, XCircle,
  MinusCircle, HelpCircle, User, GraduationCap, Briefcase, Calendar
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';
import { GRID_STATUS_META, type GridStatus, type MatrixCellData } from '../../lib/renewal';

export interface CellDetailStudent {
  studentId: string | null;
  studentName: string;
  status: string;
  grade: string | null;
  enrollDays: number | null;
  courseProduct: string | null;
  classLast1: number | null;
  classLast2: number | null;
  coef: number | null;
  type: string | null;
  managerName: string | null;
  subjectGroup: string | null;
}

export interface CellDetailSummary {
  studentCount: number;
  prepaidCount: number;
  renewedCount: number;
  stoppedCount: number;
  closedCount: number;
  grade3Count: number;
  normalCount: number;
  prepaidRate: number | null;
  renewRate: number | null;
}

export interface CellDetailPage {
  rows: CellDetailStudent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  summary: CellDetailSummary;
}

interface CellDetailModalProps {
  /** 当前选中的单元格数据 */
  cell: MatrixCellData | null;
  /** 矩阵类型 */
  type: 'mentor' | 'grade' | 'group';
  /** 关闭回调 */
  onClose: () => void;
  /** 报表 ID */
  reportId: number;
  /** 是否显示 */
  isOpen: boolean;
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'renewed', label: '已续费' },
  { value: 'prepaid', label: '已预存' },
  { value: 'stopped', label: '停课' },
  { value: 'closed', label: '结课' },
  { value: 'grade3', label: '高三' },
  { value: 'normal', label: '未标记' },
];

const SORT_OPTIONS = [
  { value: 'name', label: '学生姓名' },
  { value: 'status', label: '状态' },
  { value: 'grade', label: '年级' },
  { value: 'enrollDays', label: '在读天数' },
  { value: 'classLast1', label: '上月课消' },
  { value: 'classLast2', label: '上上月课消' },
];

export default function CellDetailModal({
  cell,
  type,
  onClose,
  reportId,
  isOpen,
}: CellDetailModalProps) {
  const [data, setData] = useState<CellDetailPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'grade' | 'enrollDays' | 'classLast1' | 'classLast2'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  const title = useMemo(() => {
    if (!cell) return '单元格详情';
    if (type === 'mentor') return `${cell.rowLabel}（教师） × ${cell.colLabel}（学管）`;
    if (type === 'grade') return `${cell.rowLabel}（教师） × ${cell.colLabel}（年级）`;
    return `${cell.rowLabel}（科组） × ${cell.colLabel}（年级）`;
  }, [cell, type]);

  // Fetch data when cell, page, sort, filter changes
  const fetchData = useCallback(async () => {
    if (!cell || !reportId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        reportId: String(reportId),
        type,
        rowKey: cell.rowKey,
        colKey: cell.colKey,
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
        ...(statusFilter && { statusFilter }),
      });
      const response = await fetch(`/api/renewal/analytics/cell-detail?${params}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch cell detail:', error);
    } finally {
      setLoading(false);
    }
  }, [cell, reportId, type, page, pageSize, sortBy, sortDir, statusFilter]);

  useEffect(() => {
    if (isOpen && cell) {
      setPage(1); // Reset to first page when opening
      fetchData();
    }
  }, [isOpen, cell, fetchData]);

  // Handle sort
  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  // Handle row selection
  const toggleSelect = (studentId: string) => {
    setSelectedStudents(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    if (selectedStudents.size === data.rows.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(data.rows.map(r => r.studentId || r.studentName)));
    }
  };

  // Export to CSV
  const handleExport = () => {
    if (!data) return;
    const headers = ['学生姓名', '学生编号', '状态', '年级', '在读天数', '产品', '上月课消', '上上月课消', '系数', '类型', '学管', '科组'];
    const rows = data.rows.map(r => [
      r.studentName,
      r.studentId || '—',
      GRID_STATUS_META[r.status as GridStatus]?.label || r.status,
      r.grade || '—',
      r.enrollDays?.toString() || '—',
      r.courseProduct || '—',
      r.classLast1?.toString() || '—',
      r.classLast2?.toString() || '—',
      r.coef?.toString() || '—',
      r.type || '—',
      r.managerName || '—',
      r.subjectGroup || '—',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cell-detail-${cell?.rowKey}-${cell?.colKey}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen || !cell) return null;

  const totalPages = data?.totalPages ?? 1;
  const filteredRows = data?.rows ?? [];

  // Client-side search filter
  const displayRows = useMemo(() => {
    if (!searchQuery) return filteredRows;
    const q = searchQuery.toLowerCase();
    return filteredRows.filter(r =>
      r.studentName.toLowerCase().includes(q) ||
      r.studentId?.toLowerCase().includes(q) ||
      r.grade?.toLowerCase().includes(q) ||
      r.courseProduct?.toLowerCase().includes(q) ||
      r.managerName?.toLowerCase().includes(q) ||
      r.subjectGroup?.toLowerCase().includes(q)
    );
  }, [filteredRows, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="cell-detail-title">
      <div className="w-full max-w-6xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="border-b border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <h3 id="cell-detail-title" className="text-lg font-semibold text-slate-800">{title}</h3>
            <Badge tone="brand" className="text-xs">${data?.total ?? cell.studentCount} 人</Badge>
            {data && (
              <>
                <Badge tone="success" className="text-xs">预存 ${data.summary.prepaidCount} (${data.summary.prepaidRate?.toFixed(1) ?? '—'}%)</Badge>
                <Badge tone="brand" className="text-xs">续费 ${data.summary.renewedCount} (${data.summary.renewRate?.toFixed(1) ?? '—'}%)</Badge>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleExport} disabled={!data || data.rows.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              导出 CSV
            </Button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3 bg-white">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">状态筛选：</label>
            <select
              value={statusFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-36 h-9 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-brand-400"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs text-slate-500">每页：</label>
            <select
              value={String(pageSize)}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="w-24 h-9 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-brand-400"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          <div className="relative flex-1 max-w-md ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="搜索姓名、编号、年级、产品…"
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 rounded ${viewMode === 'table' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-100'}`}
              aria-label="表格视图"
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-2 rounded ${viewMode === 'cards' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-100'}`}
              aria-label="卡片视图"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-500 border-t-transparent" />
              <span className="ml-3 text-sm text-slate-500">加载学生明细中…</span>
            </div>
          )}

          {!loading && data && displayRows.length === 0 && (
            <div className="text-center py-16">
              <HelpCircle className="w-12 h-12 mx-auto text-slate-300 mb-3" />
              <h4 className="text-lg font-medium text-slate-600 mb-1">无匹配学生</h4>
              <p className="text-sm text-slate-400">请尝试调整筛选条件或搜索关键词</p>
            </div>
          )}

          {!loading && data && displayRows.length > 0 && (
            <>
              {/* Status Distribution Bar */}
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-700">状态分布：</span>
                {[
                  { key: 'renewed', count: data.summary.renewedCount, label: '已续费' },
                  { key: 'prepaid', count: data.summary.prepaidCount, label: '已预存' },
                  { key: 'stopped', count: data.summary.stoppedCount, label: '停课' },
                  { key: 'closed', count: data.summary.closedCount, label: '结课' },
                  { key: 'grade3', count: data.summary.grade3Count, label: '高三' },
                  { key: 'normal', count: data.summary.normalCount, label: '未标记' },
                ].map(item => (
                  item.count > 0 && (
                    <Badge
                      key={item.key}
                      tone={item.key === 'renewed' ? 'success' : item.key === 'prepaid' ? 'violet' : item.key === 'stopped' ? 'warning' : item.key === 'closed' ? 'danger' : item.key === 'grade3' ? 'info' : 'neutral'}
                      className="gap-1"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: GRID_STATUS_META[item.key as GridStatus]?.hex }} />
                      ${item.label} ${item.count}
                    </Badge>
                  )
                ))}
              </div>

              {/* Table View */}
              {viewMode === 'table' && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0 z-10">
                      <tr className="border-b border-slate-200">
                        <th className="px-3 py-2 text-left w-10">
                          <input
                            type="checkbox"
                            checked={selectedStudents.size === displayRows.length && displayRows.length > 0}
                            onChange={toggleSelectAll}
                            className="rounded border-slate-300"
                            aria-label="全选"
                          />
                        </th>
                        <th className="px-3 py-2 text-left cursor-pointer min-w-[140px]"
                          onClick={() => handleSort('name')}>
                          学生
                          {sortBy === 'name' && (sortDir === 'asc' ? <ChevronUp className="inline h-3.5 w-3.5 ml-1" /> : <ChevronDown className="inline h-3.5 w-3.5 ml-1" />)}
                        </th>
                        <th className="px-3 py-2 text-left cursor-pointer"
                          onClick={() => handleSort('status')}>
                          状态
                          {sortBy === 'status' && (sortDir === 'asc' ? <ChevronUp className="inline h-3.5 w-3.5 ml-1" /> : <ChevronDown className="inline h-3.5 w-3.5 ml-1" />)}
                        </th>
                        <th className="px-3 py-2 text-left cursor-pointer"
                          onClick={() => handleSort('grade')}>
                          年级
                          {sortBy === 'grade' && (sortDir === 'asc' ? <ChevronUp className="inline h-3.5 w-3.5 ml-1" /> : <ChevronDown className="inline h-3.5 w-3.5 ml-1" />)}
                        </th>
                        <th className="px-3 py-2 text-right cursor-pointer"
                          onClick={() => handleSort('enrollDays')}>
                          在读天数
                          {sortBy === 'enrollDays' && (sortDir === 'asc' ? <ChevronUp className="inline h-3.5 w-3.5 ml-1" /> : <ChevronDown className="inline h-3.5 w-3.5 ml-1" />)}
                        </th>
                        <th className="px-3 py-2 text-left">产品</th>
                        <th className="px-3 py-2 text-right cursor-pointer"
                          onClick={() => handleSort('classLast1')}>
                          上月课消
                          {sortBy === 'classLast1' && (sortDir === 'asc' ? <ChevronUp className="inline h-3.5 w-3.5 ml-1" /> : <ChevronDown className="inline h-3.5 w-3.5 ml-1" />)}
                        </th>
                        <th className="px-3 py-2 text-right cursor-pointer"
                          onClick={() => handleSort('classLast2')}>
                          上上月课消
                          {sortBy === 'classLast2' && (sortDir === 'asc' ? <ChevronUp className="inline h-3.5 w-3.5 ml-1" /> : <ChevronDown className="inline h-3.5 w-3.5 ml-1" />)}
                        </th>
                        <th className="px-3 py-2 text-left">系数</th>
                        <th className="px-3 py-2 text-left">类型</th>
                        <th className="px-3 py-2 text-left">学管</th>
                        <th className="px-3 py-2 text-left">科组</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {displayRows.map((row, idx) => {
                        const studentKey = row.studentId || row.studentName;
                        const isSelected = selectedStudents.has(studentKey);
                        const status = row.status as GridStatus;
                        const meta = GRID_STATUS_META[status] ?? GRID_STATUS_META.normal;
                        const textColor = (() => {
                          const h = meta.hex.replace('#', '');
                          const r = parseInt(h.slice(0, 2), 16) / 255;
                          const g = parseInt(h.slice(2, 4), 16) / 255;
                          const b = parseInt(h.slice(4, 6), 16) / 255;
                          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                          return luminance > 0.5 ? '#1e293b' : '#f8fafc';
                        })();
                        return (
                          <tr key={idx} className={`hover:bg-slate-50/60 ${isSelected ? 'bg-brand-50/50' : ''}`}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(studentKey)}
                                className="rounded border-slate-300"
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-700">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-slate-300" />
                                <span>{row.studentName}</span>
                              </div>
                              {row.studentId && <span className="text-xs text-slate-400">ID: {row.studentId}</span>}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                tone={status === 'renewed' ? 'success' : status === 'prepaid' ? 'violet' : status === 'stopped' ? 'warning' : status === 'closed' ? 'danger' : status === 'grade3' ? 'info' : 'neutral'}
                                className="gap-1"
                              >
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.hex }} />
                                {meta.label}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              {row.grade ? (
                                <div className="flex items-center gap-1.5">
                                  <GraduationCap className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{row.grade}</span>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                              {row.enrollDays !== null ? row.enrollDays : '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-[150px]">
                              {row.courseProduct ? (
                                <div className="flex items-center gap-1.5">
                                  <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{row.courseProduct}</span>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                              {row.classLast1 !== null ? (
                                <span className={cn('font-medium', row.classLast1 > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                  {row.classLast1}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                              {row.classLast2 !== null ? (
                                <span className={cn('font-medium', row.classLast2 > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                  {row.classLast2}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {row.coef !== null ? row.coef.toFixed(2) : '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {row.type ? (
                                <Badge tone="neutral" className="text-xs">{row.type}</Badge>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {row.managerName ? (
                                <div className="flex items-center gap-1.5">
                                  <User className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{row.managerName}</span>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {row.subjectGroup ? (
                                <div className="flex items-center gap-1.5">
                                  <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{row.subjectGroup}</span>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Card View */}
              {viewMode === 'cards' && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {displayRows.map((row, idx) => {
                    const studentKey = row.studentId || row.studentName;
                    const isSelected = selectedStudents.has(studentKey);
                    const status = row.status as GridStatus;
                    const meta = GRID_STATUS_META[status] ?? GRID_STATUS_META.normal;
                    return (
                      <div
                        key={idx}
                        className={`rounded-lg border ${isSelected ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200'} hover:shadow-md transition-shadow`}
                        onClick={() => toggleSelect(studentKey)}
                      >
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 font-medium text-slate-700 truncate">
                                <User className="h-4 w-4 text-slate-300 flex-shrink-0" />
                                <span className="truncate">{row.studentName}</span>
                              </div>
                              {row.studentId && <span className="text-xs text-slate-400">ID: {row.studentId}</span>}
                            </div>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={e => { e.stopPropagation(); toggleSelect(studentKey); }}
                              className="rounded border-slate-300 mt-0.5 flex-shrink-0"
                            />
                          </div>
                          <div className="mt-3 space-y-2 text-sm">
                            <Badge
                              tone={status === 'renewed' ? 'success' : status === 'prepaid' ? 'violet' : status === 'stopped' ? 'warning' : status === 'closed' ? 'danger' : status === 'grade3' ? 'info' : 'neutral'}
                              className="gap-1"
                            >
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.hex }} />
                              {meta.label}
                            </Badge>
                            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                              {row.grade && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-50">
                                  <GraduationCap className="h-3 w-3" />
                                  {row.grade}
                                </span>
                              )}
                              {row.enrollDays !== null && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-50">
                                  <Calendar className="h-3 w-3" />
                                  {row.enrollDays}天
                                </span>
                              )}
                              {row.courseProduct && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-50 truncate max-w-[120px]">
                                  <Briefcase className="h-3 w-3" />
                                  {row.courseProduct}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <span className="text-slate-400">上月</span>
                                {row.classLast1 !== null ? (
                                  <span className={cn('font-medium', row.classLast1 > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                    {row.classLast1}
                                  </span>
                                ) : <span className="text-slate-400">—</span>}
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-slate-400">上上月</span>
                                {row.classLast2 !== null ? (
                                  <span className={cn('font-medium', row.classLast2 > 0 ? 'text-emerald-600' : 'text-red-600')}>
                                    {row.classLast2}
                                  </span>
                                ) : <span className="text-slate-400">—</span>}
                              </span>
                            </div>
                            {row.coef !== null && (
                              <span className="text-xs text-slate-500">系数: {row.coef.toFixed(2)}</span>
                            )}
                            {row.type && (
                              <Badge tone="neutral" className="text-xs">{row.type}</Badge>
                            )}
                            {row.managerName && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <User className="h-3 w-3" />
                                {row.managerName}
                              </span>
                            )}
                            {row.subjectGroup && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <Briefcase className="h-3 w-3" />
                                {row.subjectGroup}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-slate-600">
                    第 {page} / {totalPages} 页，共 {data.total} 条
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
