import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileUp, Trash2, TrendingUp, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { cn, relativeTime } from '../lib/utils';
import { fileSize, type ReportSummary } from '../lib/renewal';

/**
 * 续费统计表上传页。
 *
 * 只收一份 xlsx —— 用户在 Excel 里已经做好的汇总表（16 个 sheet）。
 * 上传后后端解析入库，看板页即可出图。一次上传 = 一个批次，可整批删除重传。
 */
export default function RenewalUpload() {
  const navigate = useNavigate();
  const toast = useToast();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [doneReport, setDoneReport] = useState<ReportSummary | null>(null);
  const [errors, setErrors] = useState<{ sheetName: string | null; rowNumber: number | null; errorMessage: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorReportId = useRef<number | null>(null);

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
  }, [toast]);

  const pick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPicked(file);
    if (file) setDoneReport(null);
  }, []);

  async function doUpload() {
    if (!picked) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', picked);
      const res = await api.upload<{ report: ReportSummary }>('/renewal/upload', form);
      setDoneReport(res.report);
      toast.success('上传并解析完成');
      setPicked(null);
      await loadReports();
      navigate('/renewal');
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
      toast.success('已删除');
      await loadReports();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }

  /** 点批次行拉取解析错误明细（后端 /reports/:id/errors） */
  async function showErrors(report: ReportSummary) {
    try {
      const res = await api.get('/renewal/reports/' + report.reportId + '/errors') as { errors: { sheet_name: string | null; row_number: number | null; error_message: string }[] };
      // 后端 renewal_import_error 的列名是 snake_case，映射成前端状态用的驼峰
      setErrors((res.errors || []).map((e) => ({
        sheetName: e.sheet_name,
        rowNumber: e.row_number,
        errorMessage: e.error_message,
      })));
      errorReportId.current = report.reportId;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载错误明细失败');
    }
  }

  const latest = reports[0];

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
            <p className="text-xs text-slate-400">上传后自动跳转看板；重复上传会新增批次，不会覆盖旧数据。</p>
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
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700">解析完成：{doneReport.fileName}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {doneReport.centerName ? doneReport.centerName + ' · ' : ''}
                  {doneReport.statMonth || '未识别月份'} · 解析行数 {doneReport.rowCount ?? 0} · 错误 {doneReport.errorCount} 条
                </p>
                <div className="mt-2">
                  <Link to="/renewal" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                    <TrendingUp className="h-4 w-4" /> 查看看板
                  </Link>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {errors.length > 0 && (
        <Card>
          <CardHeader
            title="解析错误明细"
            description="这些行没进看板，其余行不受影响"
            icon={<AlertTriangle className="h-5 w-5" />}
            action={<Badge tone="danger">{errors.length} 条</Badge>}
          />
          <CardBody className="max-h-64 overflow-y-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">sheet</th>
                  <th className="px-5 py-2.5 font-medium">行</th>
                  <th className="px-5 py-2.5 font-medium">原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {errors.map((e, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2 text-slate-600">{e.sheetName || '-'}</td>
                    <td className="px-5 py-2 text-slate-600">{e.rowNumber ?? '-'}</td>
                    <td className="px-5 py-2 text-slate-600">{e.errorMessage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="历史批次" description="点击行可下载解析错误明细；删除为整批回滚" icon={<CheckCircle2 className="h-5 w-5" />} />
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
                        {r.errorCount > 0 ? (
                          <button onClick={() => showErrors(r)} className="inline-flex" title="查看解析错误明细">
                            <Badge tone="warning">{r.errorCount} 条错误</Badge>
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
