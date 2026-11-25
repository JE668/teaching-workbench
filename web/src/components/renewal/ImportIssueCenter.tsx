import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Download, Loader2, X } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { downloadCsv, type CsvColumn } from '../../lib/exportCsv';

export type ImportIssueDetails = Record<string, string | number | boolean | null>;

export type ImportErrorRow = {
  sheetName: string | null;
  rowNumber: number | null;
  columnNumber: number | null;
  errorType: string | null;
  severity: 'error' | 'warning';
  errorMessage: string;
  fieldName: string | null;
  details: ImportIssueDetails;
};

type IssueTypeInfo = {
  label: string;
  advice: string;
  priority: number;
};

const ISSUE_TYPES: Record<string, IssueTypeInfo> = {
  summary_detail_mismatch: {
    label: '汇总与明细不一致',
    advice: '先核对教师汇总人数与学生网格明细，统一统计口径并修正源表后重新上传。',
    priority: 0,
  },
  grid_truncated: {
    label: '学生网格超出模板范围',
    advice: '超出模板支持范围的列未完整导入；请将内容整理回模板区域后重新上传。',
    priority: 1,
  },
  missing_sheet: {
    label: '缺少必需工作表',
    advice: '补回模板要求的工作表并保持原名称，再重新上传。',
    priority: 2,
  },
  missing_header: {
    label: '表头缺失或位置变化',
    advice: '恢复模板表头名称和位置，避免移动关键列后重新上传。',
    priority: 3,
  },
  empty_key_data: {
    label: '关键数据为空',
    advice: '补齐教师、学管或学生等关键字段；空白汇总行不计入数据。',
    priority: 4,
  },
  empty_workbook: {
    label: '工作簿为空',
    advice: '使用包含续费模板数据的 .xlsx 文件重新上传。',
    priority: 5,
  },
  xlsx_parse_error: {
    label: '文件解析失败',
    advice: '确认文件可正常打开，并另存为标准 .xlsx 后重新上传。',
    priority: 6,
  },
  formula_error: {
    label: '公式返回错误',
    advice: '先在 Excel/WPS 中修复错误公式，再全量重算、保存并重新上传。',
    priority: 10,
  },
  formula_cache_missing: {
    label: '公式缓存缺失',
    advice: '用 Excel/WPS 打开源文件，执行全量重算并保存为 .xlsx，再重新上传；无需逐条修改。',
    priority: 20,
  },
};

const FALLBACK_INFO: IssueTypeInfo = {
  label: '其他导入问题',
  advice: '按 Sheet 和单元格位置核对源文件，修正后重新上传。',
  priority: 50,
};

const FIELD_LABELS: Record<string, string> = {
  base_count: '学生基数',
  renewed_count: '续费人数',
  teacher_name: '教师姓名',
  manager_name: '学管姓名',
  student_name: '学生姓名',
  student_grid: '学生网格',
};

const DETAIL_LABELS: Record<string, string> = {
  summaryCount: '汇总值',
  detailCount: '明细值',
};

export function importIssueTypeInfo(errorType: string | null): IssueTypeInfo {
  return (errorType && ISSUE_TYPES[errorType]) || {
    ...FALLBACK_INFO,
    label: errorType ? `其他问题（${errorType}）` : FALLBACK_INFO.label,
  };
}

function columnName(columnNumber: number | null): string {
  if (!columnNumber || columnNumber < 1) return '';
  let value = columnNumber;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellLocation(row: ImportErrorRow): string {
  if (row.rowNumber == null) return '—';
  return `${columnName(row.columnNumber)}${row.rowNumber}`;
}

function detailText(details: ImportIssueDetails): string {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${DETAIL_LABELS[key] || key}：${String(value)}`)
    .join(' · ');
}

function IssueRowsTable({ rows }: { rows: ImportErrorRow[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500">
        <tr>
          <th className="px-5 py-2.5 font-medium">Sheet</th>
          <th className="px-5 py-2.5 font-medium">位置</th>
          <th className="px-5 py-2.5 font-medium">级别</th>
          <th className="px-5 py-2.5 font-medium">原因</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row, index) => {
          const differences = detailText(row.details);
          return (
            <tr key={`${row.sheetName}-${row.rowNumber}-${row.columnNumber}-${row.errorType}-${index}`}>
              <td className="px-5 py-2 text-slate-600">{row.sheetName || '—'}</td>
              <td className="px-5 py-2 text-slate-600">
                <div>{row.rowNumber == null ? '—' : `第 ${row.rowNumber} 行${row.columnNumber == null ? '' : ` · 第 ${row.columnNumber} 列`}`}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {cellLocation(row)}{row.fieldName ? ` · ${FIELD_LABELS[row.fieldName] || row.fieldName}` : ''}
                </div>
              </td>
              <td className="px-5 py-2"><Badge tone={row.severity === 'error' ? 'danger' : 'warning'}>{row.severity === 'error' ? '错误' : '警告'}</Badge></td>
              <td className="px-5 py-2 text-slate-600">
                <div>{row.errorMessage}</div>
                {differences && <div className="mt-1 text-xs font-medium text-amber-700">{differences}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function IssueGroup({ group, defaultOpen }: {
  group: { key: string; info: IssueTypeInfo; severity: 'error' | 'warning'; rows: ImportErrorRow[] };
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? group.rows : group.rows.slice(0, 20);
  const sheetCount = new Set(group.rows.map((row) => row.sheetName || '未指定 Sheet')).size;
  return (
    <details
      className="rounded-xl border border-slate-200 bg-white open:border-slate-300"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700">{group.info.label}</span>
            <Badge tone={group.severity === 'error' ? 'danger' : 'warning'}>{group.rows.length} 条</Badge>
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">涉及 {sheetCount} 个 Sheet{open ? '，点击收起' : '，点击展开处理建议与位置'}</span>
        </span>
      </summary>
      {open && (
        <div className="border-t border-slate-100">
          <p className="bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-800">
            <span className="font-medium">处理建议：</span>{group.info.advice}
          </p>
          <div className="max-h-80 overflow-auto">
            <IssueRowsTable rows={visibleRows} />
          </div>
          {group.rows.length > 20 && (
            <div className="border-t border-slate-100 px-4 py-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
                {showAll ? '仅显示前 20 个位置' : `展开全部 ${group.rows.length} 个位置`}
              </Button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

export default function ImportIssueCenter({ reportId, loading, rows, error, onRetry, onClose }: {
  reportId: number;
  loading: boolean;
  rows: ImportErrorRow[];
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; info: IssueTypeInfo; severity: 'error' | 'warning'; rows: ImportErrorRow[] }>();
    rows.forEach((row) => {
      const key = `${row.severity}:${row.errorType || 'unknown'}`;
      const existing = map.get(key);
      if (existing) existing.rows.push(row);
      else map.set(key, { key, info: importIssueTypeInfo(row.errorType), severity: row.severity, rows: [row] });
    });
    return [...map.values()].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return a.info.priority - b.info.priority || b.rows.length - a.rows.length || a.key.localeCompare(b.key);
    });
  }, [rows]);
  const errorCount = rows.filter((row) => row.severity === 'error').length;
  const warningCount = rows.length - errorCount;
  const formulaCacheCount = rows.filter((row) => row.errorType === 'formula_cache_missing').length;
  const sheetCount = new Set(rows.map((row) => row.sheetName || '未指定 Sheet')).size;

  function exportIssues() {
    const columns: CsvColumn<ImportErrorRow>[] = [
      { label: 'Sheet', value: (row) => row.sheetName },
      { label: '行号', value: (row) => row.rowNumber },
      { label: '列号', value: (row) => row.columnNumber },
      { label: '单元格', value: cellLocation },
      { label: '字段', value: (row) => row.fieldName ? (FIELD_LABELS[row.fieldName] || row.fieldName) : '' },
      { label: '类型', value: (row) => importIssueTypeInfo(row.errorType).label },
      { label: '级别', value: (row) => row.severity === 'error' ? '错误' : '警告' },
      { label: '差异详情', value: (row) => detailText(row.details) },
      { label: '原因', value: (row) => row.errorMessage },
      { label: '处理建议', value: (row) => importIssueTypeInfo(row.errorType).advice },
    ];
    downloadCsv(`续费导入问题-批次-${reportId}.csv`, columns, rows);
  }

  return (
    <Card>
      <CardHeader
        title={`导入问题与警告 · 批次 #${reportId}`}
        description="先按问题类型处理，再展开查看位置；无需逐条阅读公式缓存警告"
        icon={<AlertTriangle className="h-5 w-5" />}
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            {rows.length > 0 && <Badge tone={errorCount > 0 ? 'danger' : 'warning'}>{rows.length} 条</Badge>}
            {rows.length > 0 && (
              <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportIssues}>
                下载已记录问题清单
              </Button>
            )}
            <Button size="sm" variant="ghost" aria-label="收起问题清单" icon={<X className="h-4 w-4" />} onClick={onClose} />
          </div>
        )}
      />
      <CardBody className="p-0">
        {loading ? (
          <div role="status" className="flex items-center justify-center px-5 py-8 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在加载批次 #{reportId} 的问题明细…
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-red-600">
            <p>批次 #{reportId} 的错误明细加载失败：{error}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>重试加载错误明细</Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">该批次没有导入问题明细</p>
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="导入问题汇总">
              <div className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-xs text-slate-400">已记录问题</p><p className="mt-1 text-lg font-semibold text-slate-700">{rows.length}</p></div>
              <div className="rounded-xl bg-red-50 px-3 py-3"><p className="text-xs text-red-500">阻断错误</p><p className="mt-1 text-lg font-semibold text-red-700">{errorCount}</p></div>
              <div className="rounded-xl bg-amber-50 px-3 py-3"><p className="text-xs text-amber-600">警告</p><p className="mt-1 text-lg font-semibold text-amber-700">{warningCount}</p></div>
              <div className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-xs text-slate-400">涉及 Sheet</p><p className="mt-1 text-lg font-semibold text-slate-700">{sheetCount}</p></div>
            </div>
            {formulaCacheCount > 0 && (
              <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
                其中 {formulaCacheCount} 条是公式缓存缺失，可通过对源文件全量重算、保存后重传批量处理；请先查看其他汇总差异。
              </p>
            )}
            {rows.length <= 20 ? (
              <div className="space-y-4">
                {groups.map((group) => (
                  <p key={group.key} className="rounded-xl bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-800">
                    <span className="font-medium">{group.info.label}：</span>{group.info.advice}
                  </p>
                ))}
                <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
                  <IssueRowsTable rows={groups.flatMap((group) => group.rows)} />
                </div>
              </div>
            ) : (
              <div className="space-y-3" aria-label="按类型分组的问题清单">
                {groups.map((group) => (
                  <IssueGroup
                    key={`${reportId}-${group.key}`}
                    group={group}
                    defaultOpen={group.severity === 'error' || group.info.priority < 10 || group.rows.length <= 5}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
