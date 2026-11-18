import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';

interface XukeRateRow {
  teacher_no: string;
  teacher_name: string;
  subject_group: string | null;
  base_count: number;
  renewed_count: number;
  rate: number;
}

interface XushengRateRow {
  mentor_name: string;
  base_count: number;
  renewed_count: number;
  rate: number;
}

interface PreSaleRow {
  branch_company: string;
  learning_center: string;
  valid_voucher_count: number;
  presale_student_count: number;
  total_amount: number;
}

interface IncentiveRow {
  scope: string;
  scope_value: string;
  target_rate: number;
  base_count: number;
  target_count: number;
  renewed_count: number;
  gap: number;
}

interface MonthlyReport {
  month: string | null;
  xuke: { total_base: number; total_renewed: number; overall_rate: number; teacher_count: number };
  xusheng: { total_base: number; total_renewed: number; overall_rate: number; mentor_count: number };
  presale: { total_vouchers: number; total_students: number; total_amount: number; learning_center_count: number };
  incentive: { entries: number; total_gap: number };
}

type Tab = 'overview' | 'xuke' | 'xusheng' | 'presale' | 'incentive';

export default function BiDashboard() {
  const [tab, setTab] = useState<Tab>('xuke');
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'teacher' | 'subject_group'>('teacher');
  const [xukeRows, setXukeRows] = useState<XukeRateRow[]>([]);
  const [xushengRows, setXushengRows] = useState<XushengRateRow[]>([]);
  const [presaleRows, setPresaleRows] = useState<PreSaleRow[]>([]);
  const [incentiveRows, setIncentiveRows] = useState<IncentiveRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadMonths();
  }, []);

  useEffect(() => {
    if (tab === 'xuke') loadXukeRates();
    else if (tab === 'xusheng') loadXushengRates();
    else if (tab === 'presale') loadPresale();
    else if (tab === 'incentive') loadIncentive();
    else loadReport();
  }, [tab, selectedMonth, groupBy]);

  async function loadMonths() {
    try {
      const res = await api.get('/bi/metrics/months/xuke_detail');
      setMonths(res.months);
      if (res.months.length > 0 && !selectedMonth) {
        setSelectedMonth(res.months[0]);
      }
    } catch (err) {
      toast.error('加载月份列表失败');
    }
  }

  async function loadXukeRates() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth) params.append('month', selectedMonth);
      params.append('groupBy', groupBy);
      const res = await api.get('/bi/metrics/xuke-rates?' + params.toString());
      setXukeRows(res.rows);
    } catch (err) {
      toast.error('加载续科率失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadXushengRates() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth) params.append('month', selectedMonth);
      const res = await api.get('/bi/metrics/xusheng-rates?' + params.toString());
      setXushengRows(res.rows);
    } catch (err) {
      toast.error('加载续生率失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadPresale() {
    setLoading(true);
    try {
      const res = await api.get('/bi/metrics/presale');
      setPresaleRows(res.rows);
    } catch (err) {
      toast.error('加载预存数据失败');
    } finally {
      setLoading(false);
    }
  }

  // 导出当前 tab 的数据为 xlsx。
  // 用 window.open 会丢 Authorization，故用 fetch + Blob 触发下载。
  async function handleExport() {
    const params = new URLSearchParams();
    if (selectedMonth && tab !== 'presale' && tab !== 'overview') params.append('month', selectedMonth);
    if (tab === 'xuke') params.append('groupBy', groupBy);
    const kind = tab === 'overview' ? 'monthly' : tab;
    const token = api.getToken();
    try {
      setExporting(true);
      const res = await fetch('/api/bi/export/' + kind + (params.toString() ? '?' + params.toString() : ''), {
        headers: token ? { Authorization: 'Bearer ' + token } : undefined,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const m = /filename="([^"]+)"/.exec(disposition);
      a.download = m ? decodeURIComponent(m[1]) : 'bi-export.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('导出失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setExporting(false);
    }
  }

  async function loadIncentive() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth) params.append('month', selectedMonth);
      const res = await api.get('/bi/metrics/incentive?' + params.toString());
      setIncentiveRows(res.rows);
    } catch (err) {
      toast.error('加载激励数据失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadReport() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth) params.append('month', selectedMonth);
      const res = await api.get('/bi/metrics/report?' + params.toString());
      setReport(res.report);
    } catch (err) {
      toast.error('加载月度报表失败');
    } finally {
      setLoading(false);
    }
  }

  function rateColor(rate: number): string {
    if (rate >= 80) return 'text-green-600';
    if (rate >= 60) return 'text-yellow-600';
    return 'text-red-600';
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">报表看板</h1>
          <p className="mt-1 text-sm text-slate-600">
            续科率、续生率、预存推断的核心指标。数据来自 <Link to="/bi-reports" className="text-brand-600 underline">报表上传</Link>。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {exporting ? '导出中…' : '导出 xlsx'}
          </button>
          <Link
            to="/bi-reports"
            className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            上传新报表
          </Link>
        </div>
      </div>

      {/* 标签页 */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { key: 'overview' as Tab, label: '总览' },
            { key: 'xuke' as Tab, label: '续科率（老师）' },
            { key: 'xusheng' as Tab, label: '续生率（学管）' },
            { key: 'presale' as Tab, label: '预存（校区）' },
            { key: 'incentive' as Tab, label: '激励差额' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`py-2 px-1 border-b-2 text-sm font-medium ${
                tab === key
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* 筛选器 */}
      {tab !== 'presale' && tab !== 'overview' && (
        <div className="flex gap-4">
          <div>
            <label htmlFor="month" className="block text-xs font-medium text-slate-700">月份</label>
            <select
              id="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="mt-1 block rounded-md border-slate-300 shadow-sm text-sm focus:border-brand-500 focus:ring-brand-500"
            >
              <option value="">最新批次</option>
              {months.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          {tab === 'xuke' && (
            <div>
              <label htmlFor="groupBy" className="block text-xs font-medium text-slate-700">分组</label>
              <select
                id="groupBy"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'teacher' | 'subject_group')}
                className="mt-1 block rounded-md border-slate-300 shadow-sm text-sm focus:border-brand-500 focus:ring-brand-500"
              >
                <option value="teacher">按老师</option>
                <option value="subject_group">按科组</option>
              </select>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" />
        </div>
      )}

      {/* 续科率表格 */}
      {tab === 'xuke' && !loading && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">老师</th>
                {groupBy === 'teacher' && <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">工号</th>}
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">科组</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">基数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">续科</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">续科率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {xukeRows.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-500">暂无数据，请先上传续科率明细</td></tr>
              ) : (
                xukeRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-sm text-slate-900">{r.teacher_name || '-'}</td>
                    {groupBy === 'teacher' && <td className="px-6 py-3 text-sm text-slate-600">{r.teacher_no || '-'}</td>}
                    <td className="px-6 py-3 text-sm text-slate-600">{r.subject_group || '-'}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.base_count}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.renewed_count}</td>
                    <td className={`px-6 py-3 text-sm text-right font-semibold ${rateColor(r.rate)}`}>
                      {r.rate.toFixed(2)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 续生率表格 */}
      {tab === 'xusheng' && !loading && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">学管师</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">学生基数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">续费人数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">续生率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {xushengRows.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-500">暂无数据，请先上传续生率明细</td></tr>
              ) : (
                xushengRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-sm text-slate-900">{r.mentor_name}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.base_count}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.renewed_count}</td>
                    <td className={`px-6 py-3 text-sm text-right font-semibold ${rateColor(r.rate)}`}>
                      {r.rate.toFixed(2)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 预存表格 */}
      {tab === 'presale' && !loading && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">分公司</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">校区</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">有效定金券</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">预存学生数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">总金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {presaleRows.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">暂无数据，请先上传定金券使用报表</td></tr>
              ) : (
                presaleRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-sm text-slate-900">{r.branch_company || '-'}</td>
                    <td className="px-6 py-3 text-sm text-slate-600">{r.learning_center || '-'}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.valid_voucher_count}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.presale_student_count}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-900 font-semibold">
                      ¥{r.total_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 总览面板 */}
      {tab === 'overview' && !loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {report && (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-medium text-slate-500">续科率</h3>
                <p className={`mt-2 text-3xl font-bold ${rateColor(report.xuke.overall_rate)}`}>
                  {report.xuke.overall_rate.toFixed(2)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {report.xuke.total_renewed} / {report.xuke.total_base} 科次 · {report.xuke.teacher_count} 老师
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-medium text-slate-500">续生率</h3>
                <p className={`mt-2 text-3xl font-bold ${rateColor(report.xusheng.overall_rate)}`}>
                  {report.xusheng.overall_rate.toFixed(2)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {report.xusheng.total_renewed} / {report.xusheng.total_base} 学生 · {report.xusheng.mentor_count} 学管
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-medium text-slate-500">预存学生数</h3>
                <p className="mt-2 text-3xl font-bold text-slate-900">{report.presale.total_students}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {report.presale.total_vouchers} 张定金券 · ¥{report.presale.total_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-medium text-slate-500">激励差额（总）</h3>
                <p className="mt-2 text-3xl font-bold text-slate-900">{report.incentive.total_gap}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {report.incentive.entries} 条激励规则
                </p>
              </div>
            </>
          )}
          {!report && <div className="col-span-full py-12 text-center text-sm text-slate-500">暂无数据</div>}
        </div>
      )}

      {/* 激励表格 */}
      {tab === 'incentive' && !loading && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">维度</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500">对象</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">目标比例</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">基数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">目标数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">已完成</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">差额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {incentiveRows.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                  暂无数据，请先配置 <Link to="/bi-settings" className="text-brand-600 underline">激励目标</Link> 并上传续生率明细
                </td></tr>
              ) : (
                incentiveRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-sm text-slate-600">
                      {r.scope === 'mentor' ? '学管' : r.scope === 'branch_company' ? '分公司' : r.scope}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-900">{r.scope_value}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.target_rate}%</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.base_count}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.target_count}</td>
                    <td className="px-6 py-3 text-sm text-right text-slate-600">{r.renewed_count}</td>
                    <td className={`px-6 py-3 text-sm text-right font-semibold ${r.gap > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {r.gap > 0 ? `+${r.gap}` : r.gap}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
