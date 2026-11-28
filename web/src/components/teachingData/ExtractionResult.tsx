import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Table2 } from 'lucide-react';
import type { TeachingDataResult } from '../../lib/teachingData';
import { PREVIEW_COLUMNS } from '../../lib/teachingData';
import Button from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';

interface ExtractionResultProps {
  result: TeachingDataResult;
  downloading: boolean;
  onDownload: () => void;
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export default function ExtractionResult({ result, downloading, onDownload }: ExtractionResultProps) {
  const stats = [
    { label: '提取记录', value: result.total.toLocaleString(), suffix: '条', tone: 'text-brand-700 bg-brand-50' },
    { label: '成功页数', value: result.stats.okPages.toLocaleString(), suffix: '页', tone: 'text-emerald-700 bg-emerald-50' },
    { label: '失败页数', value: result.stats.failedPages.toLocaleString(), suffix: '页', tone: result.stats.failedPages > 0 ? 'text-red-700 bg-red-50' : 'text-slate-700 bg-slate-50' },
    { label: '耗时', value: result.stats.elapsedSeconds.toFixed(1), suffix: '秒', tone: 'text-violet-700 bg-violet-50' },
  ];

  return (
    <div className="space-y-5" aria-live="polite">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className={'rounded-2xl p-4 ' + item.tone}>
            <p className="text-xs font-medium opacity-80">{item.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{item.value}<span className="ml-1 text-sm font-medium opacity-70">{item.suffix}</span></p>
          </div>
        ))}
      </div>

      {result.warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" role="status">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> 本次提取有 {result.warnings.length} 条提示</div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-amber-800">
            {result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader
          icon={<Table2 className="h-5 w-5" />}
          title="数据预览"
          description={result.total > 0 ? '页面仅显示前 10 条，下载文件包含全部提取结果' : '当前筛选条件下没有提取到记录'}
          action={<Button type="button" icon={<Download className="h-4 w-4" />} loading={downloading} onClick={onDownload}>下载完整 Excel</Button>}
        />
        <CardBody className="p-0">
          {result.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-500">序号</th>
                    {PREVIEW_COLUMNS.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-500">{column}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {result.data.slice(0, 10).map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-slate-400">{rowIndex + 1}</td>
                      {PREVIEW_COLUMNS.map((column) => (
                        <td key={column} className="max-w-[240px] whitespace-nowrap px-4 py-3 text-slate-700" title={displayValue(row[column])}>
                          <span className="block truncate">{displayValue(row[column])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              {result.stats.failedPages > 0 ? <AlertTriangle className="h-10 w-10 text-amber-500" /> : <CheckCircle2 className="h-10 w-10 text-slate-300" />}
              <p className="mt-3 text-sm font-medium text-slate-700">{result.stats.failedPages > 0 ? '没有可预览的数据，请先查看提取提示' : '没有符合条件的记录'}</p>
              <p className="mt-1 text-xs text-slate-500">可以调整日期、科组或统计口径后重新提取。</p>
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-500">
            <FileSpreadsheet className="h-4 w-4" /> Excel 将按当前模块和统计口径生成对应 Sheet。
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
