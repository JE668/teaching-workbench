import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';

interface ReconcileRow {
  student_id: string;
  student_name: string | null;
  voucher_prepaid: boolean;
  map_prepaid: number | null;
  map_overridden: boolean;
  teacher_no: string | null;
  status: 'MATCH' | 'ONLY_VOUCHER' | 'ONLY_MAP' | 'OVERRIDE_KEEP';
}

interface Summary {
  match: number;
  onlyVoucher: number;
  onlyMap: number;
  overrideKeep: number;
  total: number;
}

const STATUS_LABEL: Record<ReconcileRow['status'], { text: string; cls: string }> = {
  MATCH: { text: '一致', cls: 'text-green-600' },
  ONLY_VOUCHER: { text: '仅定金券（建议补映射）', cls: 'text-orange-600' },
  ONLY_MAP: { text: '仅映射表（可能老数据）', cls: 'text-yellow-600' },
  OVERRIDE_KEEP: { text: '人工已确认', cls: 'text-slate-500' },
};

export default function BiReconciliation() {
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ReconcileRow['status']>('all');
  const toast = useToast();

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/bi/reconciliation/prepaid');
      setRows(res.rows);
      setSummary(res.summary);
    } catch (err) {
      toast.error('加载对账数据失败');
    } finally {
      setLoading(false);
    }
  }

  const filtered = filter === 'all' ? rows : rows.filter(r => r.status === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">预存对账</h1>
        <p className="mt-1 text-sm text-slate-600">
          比对「定金券推算出的预存学生」与「老师-学生映射表里标记 is_prepaid=1 的学生」，差异一目了然。
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">总数</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{summary.total}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">一致</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{summary.match}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">仅定金券</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{summary.onlyVoucher}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">仅映射表</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{summary.onlyMap}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">人工已确认</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{summary.overrideKeep}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {(['all', 'MATCH', 'ONLY_VOUCHER', 'ONLY_MAP', 'OVERRIDE_KEEP'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${filter === k
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {k === 'all' ? '全部' : STATUS_LABEL[k].text}
          </button>
        ))}
        <button onClick={load} className="ml-auto rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200">刷新</button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">加载中…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">学生ID</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">姓名</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">定金券</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">映射表</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">老师工号</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">暂无数据（请先上传定金券报表和老师-学生映射）</td></tr>
              ) : filtered.map(r => (
                <tr key={r.student_id + (r.teacher_no ?? '')}>
                  <td className="px-4 py-2 text-sm font-mono">{r.student_id}</td>
                  <td className="px-4 py-2 text-sm">{r.student_name ?? '-'}</td>
                  <td className="px-4 py-2 text-sm">
                    {r.voucher_prepaid ? <span className="text-green-600">✓</span> : <span className="text-slate-300">✗</span>}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {r.map_prepaid === 1 ? <span className="text-green-600">✓{r.map_overridden && <span className="text-xs text-slate-500 ml-1">(人工)</span>}</span> : <span className="text-slate-300">✗</span>}
                  </td>
                  <td className="px-4 py-2 text-sm">{r.teacher_no ?? '-'}</td>
                  <td className={`px-4 py-2 text-sm font-medium ${STATUS_LABEL[r.status].cls}`}>
                    {STATUS_LABEL[r.status].text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
