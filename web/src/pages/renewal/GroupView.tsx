import { FolderTree } from 'lucide-react';
import BarList from '../../components/renewal/BarList';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { TAB_LABELS, TAB_ORDER, count, NOT_AVAILABLE_YET, pct, rankStyle, type GroupSummaryRow } from '../../lib/renewal';

/**
 * 科组对比视图。
 * 后端把同科组的老师加总（teacher_stats 里每行是一个老师），
 * 这里出两组排名条：续科人数 + 激励差额。
 */
export default function GroupView({ rows, tab, setTab }: { rows: GroupSummaryRow[]; tab: string; setTab: (t: string) => void }) {
  const maxRenewed = rows.reduce((m, r) => Math.max(m, r.renewedCount || 0), 0);
  const gapPositive = rows.filter(r => (r.incentiveGap || 0) > 0).sort((a, b) => (b.incentiveGap || 0) - (a.incentiveGap || 0));
  const maxGap = gapPositive.reduce((m, r) => Math.max(m, r.incentiveGap || 0), 0);

  return (
    <Card>
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
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={<FolderTree className="h-7 w-7" />}
            title={NOT_AVAILABLE_YET}
            description="该统计表的数据将在下个月录入完成后显示。"
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">续科人数排名（{TAB_LABELS[tab] || tab}表）</h3>
              <BarList
                rows={rows.map((r, i) => ({
                  label: r.subjectGroup,
                  value: count(r.renewedCount),
                  rawValue: r.renewedCount || 0,
                  ratio: maxRenewed > 0 ? (r.renewedCount / maxRenewed) * 100 : 0,
                  hint: r.teacherCount + ' 位老师 · 基数 ' + count(r.baseCount) + ' · 续科率 ' + pct(r.renewRate),
                  className: rankStyle(i),
                }))}
              />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">激励差额（正值 = 还差）</h3>
              {gapPositive.length === 0 ? (
                <div className="rounded-xl bg-emerald-50/60 px-4 py-6 text-center text-sm text-emerald-700 ring-1 ring-emerald-100">
                  所有科组都已达标，没有缺口
                </div>
              ) : (
                <BarList
                  barColor="bg-amber-500"
                  rows={gapPositive.map((r, i) => ({
                    label: r.subjectGroup,
                    value: count(r.incentiveGap),
                    rawValue: r.incentiveGap || 0,
                    ratio: maxGap > 0 ? (r.incentiveGap / maxGap) * 100 : 0,
                    hint: '基数 ' + count(r.baseCount) + ' · 续科 ' + count(r.renewedCount),
                    className: rankStyle(i),
                  }))}
                />
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
