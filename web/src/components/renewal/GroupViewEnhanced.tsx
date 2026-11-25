import { AlertCircle, FolderTree, TrendingUp } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { TAB_LABELS, TAB_ORDER, count, pct, rankStyle, type GroupSummaryRow } from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';

interface Props {
  rows: GroupSummaryRow[];
  tab: string;
  setTab: (t: string) => void;
}

type Metric = 'baseCount' | 'prepaidCount' | 'renewedCount' | 'incentiveGap';

function rankingFor(rows: GroupSummaryRow[], metric: Metric, positiveOnly = false): BarListRow[] {
  return rows
    .filter(r => typeof r[metric] === 'number' && Number.isFinite(r[metric]) && (!positiveOnly || (r[metric] ?? 0) > 0))
    .slice()
    .sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))
    .map((r, i) => ({
      label: r.subjectGroup || '未分组',
      value: count(r[metric]),
      rawValue: r[metric] ?? 0,
      ratio: 0,
      hint: `${r.teacherCount} 位老师 · 基数 ${count(r.baseCount)} · 预存 ${count(r.prepaidCount)}${metric === 'prepaidCount' ? ` · 预存率 ${pct(r.prepaidRate)}` : ` · 续科率 ${pct(r.renewRate)}`}`,
      className: rankStyle(i),
      color: metric === 'prepaidCount' ? 'bg-violet-500' : metric === 'incentiveGap' ? 'bg-amber-500' : metric === 'baseCount' ? 'bg-sky-500' : undefined,
    }));
}

export default function GroupViewEnhanced({ rows, tab, setTab }: Props) {
  const tabs = (
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
  );

  if (rows.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title="科组对比" icon={<FolderTree className="h-5 w-5" />} action={tabs} />
        <CardBody className="py-16">
          <div className="text-center">
            <FolderTree className="mx-auto mb-4 h-10 w-10 text-slate-300" />
            <h3 className="mb-1 text-lg font-medium text-slate-600">当前统计表暂无科组明细</h3>
            <p className="text-sm text-slate-400">接口已成功返回空列表；这不代表科组已达标</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const showRenewal = tab !== 'stage';
  const showGap = tab === 'incentive';
  const hasGapData = rows.some(r => typeof r.incentiveGap === 'number');
  const baseRanking = rankingFor(rows, 'baseCount');
  const prepaidRanking = rankingFor(rows, 'prepaidCount');
  const renewalRanking = rankingFor(rows, 'renewedCount');
  const gapRanking = rankingFor(rows, 'incentiveGap', true);
  const sections = tab === 'stage'
    ? [
        { key: 'base', title: '学生基数 TOP 科组', rows: baseRanking },
        { key: 'prepaid', title: '预存人数 TOP 科组', rows: prepaidRanking },
      ]
    : [
        { key: 'base', title: '学生基数 TOP 科组', rows: baseRanking },
        { key: 'renewal', title: '续科人数 TOP 科组', rows: renewalRanking },
        ...(showGap && hasGapData ? [{ key: 'gap', title: '激励差额 TOP 科组', rows: gapRanking }] : []),
      ];
  const visibleSections = sections.filter(section => section.rows.length > 0 || section.key === 'gap');

  return (
    <Card className="h-full">
      <CardHeader
        title="科组对比"
        description={`${TAB_LABELS[tab] || tab}口径 · 缺失指标显示 —，不参与达标判断`}
        icon={<FolderTree className="h-5 w-5" />}
        action={tabs}
      />
      <CardBody className="space-y-6 p-4">
        {visibleSections.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleSections.map(section => (
              <div key={section.key} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  {section.key === 'gap' ? <AlertCircle className="h-4 w-4 text-amber-500" /> : <TrendingUp className="h-4 w-4 text-emerald-500" />}
                  {section.title}
                </h4>
                {section.rows.length > 0 ? (
                  <BarList rows={section.rows} compact />
                ) : (
                  <p className="py-5 text-center text-sm text-slate-500">已提供差额数据的科组均无正向缺口</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200">
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
                  {showRenewal && <th className="px-4 py-3 font-medium">续科</th>}
                  {showRenewal && <th className="px-4 py-3 font-medium">续科率</th>}
                  {showGap && <th className="px-4 py-3 font-medium">激励差额</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice().sort((a, b) => (b.baseCount ?? -1) - (a.baseCount ?? -1)).map((r, i) => (
                  <tr key={`${r.subjectGroup}:${i}`} className="transition-colors hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', i < 3 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400')}>{i + 1}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{r.subjectGroup || '未分组'}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{r.teacherCount}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.baseCount)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{count(r.prepaidCount)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{pct(r.prepaidRate)}</td>
                    {showRenewal && <td className="px-4 py-3 tabular-nums font-medium text-slate-700">{count(r.renewedCount)}</td>}
                    {showRenewal && <td className="px-4 py-3 tabular-nums font-semibold text-slate-700">{pct(r.renewRate)}</td>}
                    {showGap && <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.incentiveGap)}</td>}
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
