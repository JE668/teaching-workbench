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

type Tab = 'xuke' | 'xusheng' | 'presale';

export default function BiDashboard() {
  const [tab, setTab] = useState<Tab>('xuke');
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'teacher' | 'subject_group'>('teacher');
  const [xukeRows, setXukeRows] = useState<XukeRateRow[]>([]);
  const [xushengRows, setXushengRows] = useState<XushengRateRow[]>([]);
  const [presaleRows, setPresaleRows] = useState<PreSaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadMonths();
  }, []);

  useEffect(() => {
    if (tab === 'xuke') loadXukeRates();
    else if (tab === 'xusheng') loadXushengRates();
    else loadPresale();
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
        <Link
          to="/bi-reports"
          className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
        >
          上传新报表
        </Link>
      </div>

      {/* 标签页 */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { key: 'xuke' as Tab, label: '续科率（老师）' },
            { key: 'xusheng' as Tab, label: '续生率（学管）' },
            { key: 'presale' as Tab, label: '预存（校区）' },
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
      {tab !== 'presale' && (
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
    </div>
  );
}
