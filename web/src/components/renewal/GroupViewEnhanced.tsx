import { FolderTree, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { TAB_LABELS, TAB_ORDER, count, NOT_AVAILABLE_YET, pct, rankStyle, type GroupSummaryRow } from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';

interface Props {
  rows: GroupSummaryRow[];
  tab: string;
  setTab: (t: string) => void;
}

export default function GroupViewEnhanced({ rows, tab, setTab }: Props) {
  if (rows.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader
          title="科组对比"
          description="同科组老师已归并求和，可直接看科组之间的差距"
          icon={<FolderTree className="h-5 w-5" />}
          action={
            <div role="tablist" aria-label="统计表 tab" className="flex gap-1">
              {TAB_ORDER.map(t => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === t ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {TAB_LABELS[t] || t}
                </button>
              ))}
            </div>
          }
        />
        <CardBody className="py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <FolderTree className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">{NOT_AVAILABLE_YET}</h3>
            <p className="text-sm text-slate-400">该统计表的数据将在下个月录入完成后显示</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const maxRenewed = rows.reduce((m, r) => Math.max(m, r.renewedCount || 0), 0);
  const maxBase = rows.reduce((m, r) => Math.max(m, r.baseCount || 0), 0);

  const gapPositive = rows.filter(r => (r.incentiveGap || 0) > 0).sort((a, b) => (b.incentiveGap || 0) - (a.incentiveGap || 0));
  const maxGap = gapPositive.reduce((m, r) => Math.max(m, r.incentiveGap || 0), 0);

  // 榜单数据
  const renewalRanking: BarListRow[] = rows
    .sort((a, b) => (b.renewedCount || 0) - (a.renewedCount || 0))
    .map((r, i) => ({
      label: r.subjectGroup,
      value: count(r.renewedCount),
      rawValue: r.renewedCount || 0,
      ratio: maxRenewed > 0 ? ((r.renewedCount || 0) / maxRenewed) * 100 : 0,
      hint: `${r.teacherCount} 位老师 · 基数 ${count(r.baseCount)} · 续科率 ${pct(r.renewRate)}`,
      className: rankStyle(i),
    }));

  const baseRanking: BarListRow[] = rows
    .sort((a, b) => (b.baseCount || 0) - (a.baseCount || 0))
    .map((r, i) => ({
      label: r.subjectGroup,
      value: count(r.baseCount),
      rawValue: r.baseCount || 0,
      ratio: maxBase > 0 ? ((r.baseCount || 0) / maxBase) * 100 : 0,
      hint: `${r.teacherCount} 位老师 · 续科 ${count(r.renewedCount)}`,
      className: rankStyle(i),
      color: 'bg-sky-500',
    }));

  const gapRanking: BarListRow[] = gapPositive
    .map((r, i) => ({
      label: r.subjectGroup,
      value: count(r.incentiveGap || 0),
      rawValue: r.incentiveGap || 0,
      ratio: maxGap > 0 ? ((r.incentiveGap || 0) / maxGap) * 100 : 0,
      hint: `基数 ${count(r.baseCount)} · 续科 ${count(r.renewedCount)} · 续科率 ${pct(r.renewRate)}`,
      className: rankStyle(i),
      color: 'bg-amber-500',
    }));

  return (
    <Card className="h-full">
      <CardHeader
        title="科组对比"
        description="同科组老师已归并求和，可直接看科组之间的差距"
        icon={<FolderTree className="h-5 w-5" />}
        action={
          <div role="tablist" aria-label="统计表 tab" className="flex gap-1">
            {TAB_ORDER.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === t ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {TAB_LABELS[t] || t}
              </button>
            ))}
          </div>
        }
      />
      <CardBody className="space-y-6 p-4">
        {/* 汇总指标 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">科组总数</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{rows.length}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">总基数</p>
            <p className="mt-1 text-2xl font-bold text-brand-600 tabular-nums">{count(rows.reduce((s, r) => s + (r.baseCount || 0), 0))}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">总续科</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600 tabular-nums">{count(rows.reduce((s, r) => s + (r.renewedCount || 0), 0))}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">总激励差额</p>
            <p className="mt-1 text-2xl font-bold text-amber-600 tabular-nums">{count(rows.reduce((s, r) => s + (r.incentiveGap || 0), 0))}</p>
          </div>
        </div>

        {/* 榜单 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              基数 TOP 科组
            </h4>
            <BarList rows={baseRanking} compact />
          </div>
          <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
              <TrendingUp className="h-4 w-4 text-brand-500" />
              续科人数 TOP 科组
            </h4>
            <BarList rows={renewalRanking} compact />
          </div>
        </div>

        <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            激励差额（正值 = 还差）
          </h4>
          {gapRanking.length === 0 ? (
            <div className="rounded-xl bg-emerald-50/60 px-4 py-6 text-center text-sm text-emerald-700 ring-1 ring-emerald-100 flex items-center justify-center gap-2">
              <CheckCircle className="h-5 w-5" />
              所有科组都已达标，没有缺口
            </div>
          ) : (
            <BarList rows={gapRanking} />
          )}
        </div>

        {/* 明细表格 */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-medium">排名</th>
                  <th className="px-4 py-3 font-medium">科组</th>
                  <th className="px-4 py-3 font-medium">老师数</th>
                  <th className="px-4 py-3 font-medium">基数</th>
                  <th className="px-4 py-3 font-medium">预存</th>
                  <th className="px-4 py-3 font-medium">预存率</th>
                  <th className="px-4 py-3 font-medium">续科</th>
                  <th className="px-4 py-3 font-medium">续科率</th>
                  <th className="px-4 py-3 font-medium">激励差额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows
                  .slice()
                  .sort((a, b) => (b.baseCount || 0) - (a.baseCount || 0))
                  .map((r, i) => (
                    <tr key={r.subjectGroup + ':' + i} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          i === 0 ? 'bg-amber-100 text-amber-700' : i < 3 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400',
                        )}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{r.subjectGroup}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{r.teacherCount}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.baseCount)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{count(r.prepaidCount)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{pct(r.prepaidRate)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700 font-medium">{count(r.renewedCount)}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-slate-700">{pct(r.renewRate)}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {r.incentiveGap !== null && r.incentiveGap !== undefined ? (
                          <span className={cn('font-medium', r.incentiveGap > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                            {count(r.incentiveGap)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
