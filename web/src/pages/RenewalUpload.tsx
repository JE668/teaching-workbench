import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Trash2, TrendingUp, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { cn, relativeTime } from '../lib/utils';
import { fileSize, type ManagerPerfRow, type ReportSummary, type TeacherStatRow } from '../lib/renewal';
import ImportIssueCenter, { type ImportErrorRow, type ImportIssueDetails } from '../components/renewal/ImportIssueCenter';

type ImportErrorDetails = {
  reportId: number | null;
  loading: boolean;
  rows: ImportErrorRow[];
  error: string;
};

type Reconciliation = {
  baseCount: number | null;
  prepaidCount: number | null;
  nongradPrepaid: number | null;
  managerCount: number;
};

function parseIssueDetails(value: unknown): ImportIssueDetails {
  let parsed = value;
  if (typeof value === 'string' && value.trim()) {
    try { parsed = JSON.parse(value); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([, item]) => (
      item === null || ['string', 'number', 'boolean'].includes(typeof item)
    )),
  ) as ImportIssueDetails;
}

/**
 * 续费统计表上传页。
 *
 * 只收一份 xlsx —— 用户在 Excel 里已经做好的汇总表（16 个 sheet）。
 * 上传后后端解析入库，看板页即可出图。一次上传 = 一个批次，可整批删除重传。
 */
export default function RenewalUpload() {
  const toast = useToast();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [doneReport, setDoneReport] = useState<ReportSummary | null>(null);
  const [deduplicated, setDeduplicated] = useState(false);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [reconciliationError, setReconciliationError] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportErrorDetails>({
    reportId: null,
    loading: false,
    rows: [],
    error: '',
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const importErrorRequestRef = useRef(0);
  const currentErrorReportIdRef = useRef<number | null>(null);

  const clearImportErrors = useCallback(() => {
    importErrorRequestRef.current += 1;
    currentErrorReportIdRef.current = null;
    setImportErrors({ reportId: null, loading: false, rows: [], error: '' });
  }, []);

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    setLoading(true);
    try {
      const res = await api.get('/renewal/reports') as { reports: ReportSummary[] };
      setReports(res.reports || []);
    } catch {
      toast.error('加载批次列表失败');
    } finally {
      setLoading(false);
    }
  }

  /** 拖拽时必须在事件内同步读 files：事件结束后 dataTransfer 会被浏览器清空 */
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer?.files;
    const first = files && files[0];
    if (!first) return;
    if (!/\.(xlsx|xls)$/i.test(first.name)) {
      toast.error('请上传 xlsx / xls 文件');
      return;
    }
    setPicked(first);
    setDoneReport(null);
    setReconciliation(null);
    setReconciliationError(false);
    clearImportErrors();
  }, [toast, clearImportErrors]);

  const pick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPicked(file);
    if (file) {
      setDoneReport(null);
      setReconciliation(null);
      setReconciliationError(false);
      clearImportErrors();
    }
  }, [clearImportErrors]);

  async function doUpload() {
    if (!picked) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', picked);
      const res = await api.upload<{ report: ReportSummary; deduplicated?: boolean }>('/renewal/upload', form);
      const report = res.report;
      setDoneReport(report);
      setDeduplicated(res.deduplicated === true);
      setReconciliation(null);
      setReconciliationError(false);
      clearImportErrors();
      if (res.deduplicated) toast.info('这份文件已上传过，已定位到原批次');
      else if (report.errorCount > 0 || report.status === 'committed_with_warnings') toast.info('批次已保存，请先核对导入警告');
      else toast.success('上传并解析完成');
      setPicked(null);
      await Promise.all([loadReports(), loadReconciliation(report)]);
      if (report.errorCount > 0) await showErrors(report);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function removeReport(id: number) {
    if (!window.confirm('删除该批次后，对应看板和明细会一起清空。确定删除吗？')) return;
    try {
      await api.delete('/renewal/reports/' + id);
      if (currentErrorReportIdRef.current === id || doneReport?.reportId === id) {
        clearImportErrors();
        setDoneReport(null);
        setReconciliation(null);
        setReconciliationError(false);
        setDeduplicated(false);
      }
      toast.success('已删除');
      await loadReports();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }

  /** 上传后先对账，再由用户主动进入看板，避免错误批次被当成完整数据。 */
  async function loadReconciliation(report: ReportSummary) {
    try {
      const [stageRes, managerRes] = await Promise.all([
        api.get('/renewal/dashboard/teacher-stats?tab=stage&reportId=' + report.reportId) as Promise<{ rows: TeacherStatRow[] }>,
        api.get('/renewal/analytics/manager-perf?reportId=' + report.reportId) as Promise<{ rows: ManagerPerfRow[] }>,
      ]);
      const sum = (selector: (row: TeacherStatRow) => number | null | undefined) => {
        let available = false;
        const total = (stageRes.rows || []).reduce((acc, row) => {
          const value = selector(row);
          if (typeof value !== 'number' || !Number.isFinite(value)) return acc;
          available = true;
          return acc + value;
        }, 0);
        return available ? total : null;
      };
      setReconciliation({
        baseCount: sum((row) => row.baseCount),
        prepaidCount: sum((row) => row.prepaidCount),
        nongradPrepaid: sum((row) => row.extra?.prepaid_nongrad),
        managerCount: (managerRes.rows || []).length,
      });
    } catch {
      setReconciliationError(true);
    }
  }

  /** 点批次行拉取解析错误明细（后端 /reports/:id/errors） */
  async function showErrors(report: ReportSummary | number) {
    const reportId = typeof report === 'number' ? report : report.reportId;
    const requestId = ++importErrorRequestRef.current;
    currentErrorReportIdRef.current = reportId;
    setImportErrors({ reportId, loading: true, rows: [], error: '' });
    try {
      const res = await api.get('/renewal/reports/' + reportId + '/errors') as { errors: {
        sheet_name?: string | null; row_number?: number | null; column_number?: number | null;
        error_type?: string | null; severity?: 'error' | 'warning'; error_message: string;
        sheetName?: string | null; rowNumber?: number | null; columnNumber?: number | null;
        errorType?: string | null; errorMessage?: string;
        field_name?: string | null; details_json?: string | null;
        fieldName?: string | null; details?: ImportIssueDetails | string | null;
      }[] };
      const rows = (res.errors || []).map((e) => ({
        sheetName: e.sheetName ?? e.sheet_name ?? null,
        rowNumber: e.rowNumber ?? e.row_number ?? null,
        columnNumber: e.columnNumber ?? e.column_number ?? null,
        errorType: e.errorType ?? e.error_type ?? null,
        severity: e.severity === 'warning' ? 'warning' as const : 'error' as const,
        errorMessage: e.errorMessage ?? e.error_message,
        fieldName: e.fieldName ?? e.field_name ?? null,
        details: parseIssueDetails(e.details ?? e.details_json),
      }));
      if (requestId !== importErrorRequestRef.current || currentErrorReportIdRef.current !== reportId) return;
      setImportErrors({ reportId, loading: false, rows, error: '' });
    } catch (err) {
      if (requestId !== importErrorRequestRef.current || currentErrorReportIdRef.current !== reportId) return;
      setImportErrors({
        reportId,
        loading: false,
        rows: [],
        error: err instanceof Error ? err.message : '加载错误明细失败',
      });
    }
  }

  const latest = reports[0];
  const doneHasIssues = Boolean(doneReport && (doneReport.errorCount > 0 || doneReport.status === 'committed_with_warnings'));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">续费统计表上传</h1>
        <p className="mt-1 text-sm text-slate-400">
          上传你在 Excel 里已做好的续费统计汇总表（含 16 个 sheet），系统解析后即可出图。
        </p>
      </div>

      <Card>
        <CardBody className="p-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="选择或拖拽上传续费统计表"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            className={cn(
              'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
              dragActive ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-slate-50/50 hover:border-brand-300 hover:bg-brand-50/30',
            )}
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
              <FileUp className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-slate-700">
              {picked ? picked.name : '把续费统计表拖到这里，或点击选择文件'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {picked ? fileSize(picked.size) : '仅支持 xlsx / xls，单文件不超过 60MB'}
            </p>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={pick} />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">上传后先展示识别结果与对账警告；相同文件重复上传会定位到原批次。</p>
            <Button onClick={doUpload} loading={uploading} disabled={!picked} icon={<FileUp className="h-4 w-4" />}>
              {uploading ? '解析中…' : '上传并解析'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {doneReport && (
        <Card>
          <CardBody className="p-5">
            <div className="flex items-start gap-3">
              {doneHasIssues
                ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-700">
                    {doneHasIssues ? '解析完成，请先核对' : '解析完成'}：{doneReport.fileName}
                  </p>
                  {deduplicated && <Badge tone="info">原批次</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {doneReport.centerName ? doneReport.centerName + ' · ' : ''}
                  {doneReport.statMonth || '未识别月份'} · 解析行数 {doneReport.rowCount ?? '—'} · 待核对 {doneReport.errorCount} 条
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="上传对账摘要">
                  {([
                    ['学段学生基数', reconciliation?.baseCount],
                    ['总预存', reconciliation?.prepaidCount],
                    ['非毕业班预存', reconciliation?.nongradPrepaid],
                    ['学管人数', reconciliation?.managerCount],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 px-3 py-3">
                      <p className="text-xs text-slate-400">{label}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-700">{value ?? '—'}</p>
                    </div>
                  ))}
                </div>
                {reconciliationError && <p className="mt-2 text-xs text-amber-600">批次已保存，对账摘要加载失败；请进入看板后重试。</p>}
                <div className="mt-4">
                  <Link to={'/renewal?reportId=' + doneReport.reportId} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                    <TrendingUp className="h-4 w-4" /> 查看这个批次的看板
                  </Link>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {importErrors.reportId !== null && (
        <ImportIssueCenter
          reportId={importErrors.reportId}
          loading={importErrors.loading}
          rows={importErrors.rows}
          error={importErrors.error}
          onRetry={() => {
            if (importErrors.reportId !== null) void showErrors(importErrors.reportId);
          }}
          onClose={clearImportErrors}
        />
      )}

      <Card>
        <CardHeader title="历史批次" description="点击待核对数量查看问题位置；删除为整批回滚" icon={<CheckCircle2 className="h-5 w-5" />} />
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : reports.length === 0 ? (
            <EmptyState
              icon={<FileUp className="h-7 w-7" />}
              title="还没有任何续费统计批次"
              description="上传你做好的汇总表，看板就会自动出图。"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">文件</th>
                    <th className="px-5 py-3 font-medium">月份</th>
                    <th className="px-5 py-3 font-medium">解析行数</th>
                    <th className="px-5 py-3 font-medium">状态</th>
                    <th className="px-5 py-3 font-medium">上传时间</th>
                    <th className="px-5 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.map((r) => (
                    <tr key={r.reportId} className={cn('hover:bg-slate-50/60', latest && r.reportId === latest.reportId && 'bg-brand-50/40')}>
                      <td className="px-5 py-3">
                        <div className="max-w-[320px] truncate font-medium text-slate-700" title={r.fileName}>{r.fileName}</div>
                        <div className="text-xs text-slate-400">
                          {r.centerName || '-'} · {fileSize(r.fileSize)}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{r.statMonth || '-'}</td>
                      <td className="px-5 py-3 text-slate-600">{r.rowCount ?? '-'}</td>
                      <td className="px-5 py-3">
                        {r.status === 'processing' ? (
                          <Badge tone="info">解析中</Badge>
                        ) : r.status === 'failed' ? (
                          <button onClick={() => showErrors(r)} className="inline-flex" title="查看导入失败原因">
                            <Badge tone="danger">导入失败{r.errorCount > 0 ? ` · ${r.errorCount} 条` : ''}</Badge>
                          </button>
                        ) : r.errorCount > 0 ? (
                          <button onClick={() => showErrors(r)} className="inline-flex" title="查看导入问题与警告">
                            <Badge tone="warning">{r.errorCount} 条{r.status === 'committed_with_warnings' ? '警告' : '错误'}</Badge>
                          </button>
                        ) : (
                          <Badge tone="success">正常</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{relativeTime(r.uploadedAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeReport(r.reportId)}>
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
