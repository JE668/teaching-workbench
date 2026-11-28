import { useEffect, useState } from 'react';
import { CloudDownload, DatabaseZap, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import ConnectionPanel from '../components/teachingData/ConnectionPanel';
import ExtractionForm from '../components/teachingData/ExtractionForm';
import ExtractionResult from '../components/teachingData/ExtractionResult';
import Button from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { useToast } from '../components/ui/Toast';
import type { TeachingDataConfig, TeachingDataFilters, TeachingDataResult } from '../lib/teachingData';
import { defaultTeachingDataFilters, MODEL_OPTIONS, saveDownloadedFile } from '../lib/teachingData';

export default function TeachingData() {
  const { success, error, info } = useToast();
  const [config, setConfig] = useState<TeachingDataConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [configVersion, setConfigVersion] = useState(0);
  const [filters, setFilters] = useState<TeachingDataFilters | null>(null);
  const [platformToken, setPlatformToken] = useState('');
  const [result, setResult] = useState<TeachingDataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    setConfigError('');
    api.get<TeachingDataConfig>('/teaching-data/config')
      .then((response) => {
        if (!active) return;
        setConfig(response);
        setFilters((current) => current || defaultTeachingDataFilters(response.campus));
      })
      .catch((reason: unknown) => {
        if (active) setConfigError(reason instanceof Error ? reason.message : '加载提取配置失败');
      });
    return () => { active = false; };
  }, [configVersion]);

  function connect(token: string) {
    setPlatformToken(token);
    setResult(null);
  }

  function disconnect() {
    setPlatformToken('');
    setResult(null);
    info('已断开教学平台连接');
  }

  async function extract() {
    if (!filters || !platformToken) {
      error('请先连接教学平台并设置提取条件');
      return;
    }
    if (filters.modelType !== 'evaluate_analysis') {
      if (!filters.startDate || !filters.endDate) {
        error('请选择开始日期和结束日期');
        return;
      }
      if (filters.startDate > filters.endDate) {
        error('开始日期不能晚于结束日期');
        return;
      }
    }
    if (!filters.branchId.trim() || !filters.branchName.trim() || !filters.campusId.trim() || !filters.campusName.trim()) {
      error('请完整填写校区匹配设置');
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const response = await api.request<TeachingDataResult>('/teaching-data/fetch', {
        method: 'POST',
        body: JSON.stringify({ token: platformToken, ...filters }),
        timeoutMs: 300000,
      });
      setResult(response);
      if (response.warnings.length > 0) info('提取完成，请查看部分失败或截断提示');
      else success('数据提取完成');
    } catch (reason) {
      error(reason instanceof Error ? reason.message : '提取教学数据失败');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!result || !filters) return;
    setDownloading(true);
    try {
      const file = await api.downloadFile('/teaching-data/download/' + encodeURIComponent(result.fetchId));
      const model = MODEL_OPTIONS.find((item) => item.value === filters.modelType)?.label || '教学数据';
      const filename = '晓教育_' + model + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
      saveDownloadedFile(file.blob, file.filename || filename);
      success('Excel 已下载');
    } catch (reason) {
      error(reason instanceof Error ? reason.message : '下载 Excel 失败');
    } finally {
      setDownloading(false);
    }
  }

  const steps = [
    { label: '连接平台', done: Boolean(platformToken) },
    { label: '设置筛选', done: Boolean(platformToken && filters) },
    { label: '预览导出', done: Boolean(result) },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      <header className="overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-violet-50 p-6 shadow-soft sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
              <DatabaseZap className="h-3.5 w-3.5" /> 教学运营工具
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">教学数据提取</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">连接晓教育平台，提取课堂反馈、个辅方案、阶段评估和课前备课明细，预览后导出完整 Excel。</p>
          </div>
          <ol className="grid grid-cols-3 gap-2 lg:w-[390px]" aria-label="提取步骤">
            {steps.map((step, index) => (
              <li key={step.label} className={'rounded-2xl border bg-white/80 p-3 text-center ' + (step.done ? 'border-emerald-200 text-emerald-800' : 'border-slate-200 text-slate-500')}>
                <span className={'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ' + (step.done ? 'bg-emerald-100' : 'bg-slate-100')}>{index + 1}</span>
                <span className="mt-2 block text-xs font-medium">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <ConnectionPanel connected={Boolean(platformToken)} onToken={connect} onDisconnect={disconnect} />

      {filters ? (
        <ExtractionForm value={filters} onChange={setFilters} onSubmit={extract} connected={Boolean(platformToken)} busy={busy} />
      ) : (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            {configError ? (
              <>
                <p role="alert" className="text-sm text-red-600">{configError}</p>
                <Button type="button" variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfigVersion((value) => value + 1)}>重新加载配置</Button>
              </>
            ) : (
              <><RefreshCw className="h-6 w-6 animate-spin text-brand-500" /><p className="text-sm text-slate-500">正在加载提取配置…</p></>
            )}
          </CardBody>
        </Card>
      )}

      {busy && (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800" role="status">
          <RefreshCw className="h-4 w-4 animate-spin" /> 正在分页提取并整理数据，多科组或较大日期范围可能需要几分钟。
        </div>
      )}

      {result && !busy && <ExtractionResult result={result} downloading={downloading} onDownload={download} />}

      {!result && !busy && config && (
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-500">
          <CloudDownload className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>单页提取上限 {config.pageSize} 条，单个科组最多扫描 {config.maxPages} 页，失败页自动重试 {config.retryTimes} 次。结果仅短期保留，请及时下载 Excel。</p>
        </div>
      )}
    </div>
  );
}
