import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarRange, Loader2, Minus } from 'lucide-react';
import { api } from '../../api/client';
import { Card, CardBody, CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import { count, pct, type ReportSummary } from '../../lib/renewal';

type MetricValue = { current: number | null; previous: number | null; delta: number | null };
type MetricSet = Record<string, number | null>;

export interface RenewalComparisonResponse {
  tab: string;
  currentReport: { reportId: number; statMonth: string | null; uploadedAt: string };
  previousReport: { reportId: number; statMonth: string | null; uploadedAt: string };
  summary: Record<string, MetricValue>;
  teachers: {
    teacherKey: string;
    teacherName: string | null;
    teacherNo: string | null;
    subjectGroup: string | null;
    current: MetricSet;
    previous: MetricSet;
    delta: MetricSet;
  }[];
}

const METRICS = [
  ['baseCount', '学生基数'],
  ['prepaidCount', '总预存'],
  ['prepaidRate', '总预存率'],
  ['renewedCount', '已续科'],
  ['renewRate', '续科率'],
  ['incentiveGap', '80%目标差额'],
] as const;

function Delta({ metric, value }: { metric: string; value: number | null }) {
  if (value === null) return <span className="text-slate-300">—</span>;
  const rate = metric.endsWith('Rate');
  const text = `${value > 0 ? '+' : ''}${rate ? value.toFixed(1) : Math.round(value)}${rate ? ' 个百分点' : ''}`;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-600"><Icon className="h-3.5 w-3.5" />{text}</span>;
}

export default function RenewalComparison({ reports, currentReportId, tab }: {
  reports: ReportSummary[];
  currentReportId: number | null;
  tab: string;
}) {
  const current = reports.find((report) => report.reportId === currentReportId) || null;
  const candidates = useMemo(() => reports.filter((report) =>
    report.reportId !== currentReportId &&
    report.centerName === current?.centerName &&
    ['committed', 'committed_with_warnings'].includes(report.status),
  ), [reports, currentReportId, current?.centerName]);
  const [compareId, setCompareId] = useState('');
  const [data, setData] = useState<RenewalComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const previousScope = useRef({ currentReportId, tab });

  useEffect(() => {
    const requestId = ++requestSequence.current;
    const scopeChanged = previousScope.current.currentReportId !== currentReportId || previousScope.current.tab !== tab;
    previousScope.current = { currentReportId, tab };

    // 批次或 tab 变化时，本次 render 仍可能携带旧选择；先重置，避免用它发起请求。
    if (scopeChanged) {
      setCompareId('');
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    if (!compareId || !currentReportId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const response = await api.get(`/renewal/compare?reportId=${currentReportId}&compareReportId=${compareId}&tab=${encodeURIComponent(tab)}`) as RenewalComparisonResponse & { error?: string };
        if (requestSequence.current !== requestId) return;
        if (response.error) {
          setData(null);
          setError(response.error);
        } else {
          setData(response);
        }
      } catch (reason) {
        if (requestSequence.current !== requestId) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : '对比数据加载失败');
      } finally {
        // 旧请求的 finally 也不能清除新请求的 loading。
        if (requestSequence.current === requestId) setLoading(false);
      }
    })();
    return () => {
      if (requestSequence.current === requestId) requestSequence.current += 1;
    };
  }, [compareId, currentReportId, tab]);

  const teachers = useMemo(() => [...(data?.teachers || [])].sort((a, b) =>
    (b.delta.prepaidCount === null ? -1 : Math.abs(b.delta.prepaidCount ?? 0)) -
    (a.delta.prepaidCount === null ? -1 : Math.abs(a.delta.prepaidCount ?? 0)),
  ), [data]);

  return (
    <Card>
      <CardHeader
        title="多期对比"
        description="仅对比同一学习中心、同一教师统计表；缺失值不参与零值计算"
        icon={<CalendarRange className="h-5 w-5" />}
        action={current && <Badge tone="neutral">{current.statMonth || '未识别月份'}</Badge>}
      />
      <CardBody className="space-y-5">
        <div className="max-w-xl">
          <label htmlFor="renewal-compare-report" className="mb-1.5 block text-sm font-medium text-slate-700">选择对比批次</label>
          <select
            id="renewal-compare-report"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
            value={compareId}
            onChange={(event) => setCompareId(event.target.value)}
          >
            <option value="">请选择同中心的另一批次</option>
            {candidates.map((report) => <option key={report.reportId} value={report.reportId}>{report.statMonth || '未识别月份'} · {report.fileName}</option>)}
          </select>
        </div>
        {candidates.length === 0 && <EmptyState title="暂无可对比批次" description="上传同一学习中心的另一期统计表后，即可查看同口径变化。" />}
        {loading && <div className="flex items-center justify-center py-10 text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在计算同口径变化…</div>}
        {error && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        {!loading && !error && data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {METRICS.filter(([key]) => data.summary[key]).map(([key, label]) => {
                const metric = data.summary[key];
                return (
                  <div key={key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                    <p className="text-xs text-slate-400">{label}</p>
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <p className="text-xl font-semibold text-slate-800">{key.endsWith('Rate') ? pct(metric.current) : count(metric.current)}</p>
                      <Delta metric={key} value={metric.delta} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">对比期：{key.endsWith('Rate') ? pct(metric.previous) : count(metric.previous)}</p>
                  </div>
                );
              })}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">教师</th><th className="px-4 py-3 font-medium">科组</th><th className="px-4 py-3 font-medium">基数变化</th><th className="px-4 py-3 font-medium">预存变化</th><th className="px-4 py-3 font-medium">续科变化</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {teachers.map((teacher) => <tr key={teacher.teacherKey}>
                    <td className="px-4 py-3 font-medium text-slate-700">{teacher.teacherName || '未命名教师'}{teacher.teacherNo ? <span className="ml-1 text-xs font-normal text-slate-400">{teacher.teacherNo}</span> : null}</td>
                    <td className="px-4 py-3 text-slate-500">{teacher.subjectGroup || '—'}</td>
                    <td className="px-4 py-3"><Delta metric="baseCount" value={teacher.delta.baseCount ?? null} /></td>
                    <td className="px-4 py-3"><Delta metric="prepaidCount" value={teacher.delta.prepaidCount ?? null} /></td>
                    <td className="px-4 py-3"><Delta metric="renewedCount" value={teacher.delta.renewedCount ?? null} /></td>
                  </tr>)}
                </tbody>
              </table>
              {teachers.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">这两个批次在该统计表中没有可对比的教师行</p>}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
