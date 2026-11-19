import React from 'react';
import { ChevronDown, Users, TrendingUp, Target, AlertCircle, CheckCircle } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { TAB_LABELS, TAB_ORDER, count, NOT_AVAILABLE_YET, pct, rankStyle, type TeacherStatRow } from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';
import Sparkline from './Sparkline';
import StudentGrid from './StudentGrid';

interface Props {
  rows: TeacherStatRow[];
  tab: string;
  setTab: (t: string) => void;
  expanded: Set<string>;
  toggleTeacher: (name: string) => void;
}

interface Col {
  key: string;
  label: string;
  isRate: boolean;
  get: (r: TeacherStatRow) => number | null;
  sparkline?: boolean;
}

function tabColumns(tab: string): Col[] {
  if (tab === 'stage') {
    return [
      { key: 'juniorBase', label: '在读-非毕业班', isRate: false, get: r => r.extra['juniorBase'] ?? r.baseCount },
      { key: 'junior3Base', label: '在读-初三', isRate: false, get: r => r.extra['junior3Base'] ?? null },
      { key: 'junior3Prepaid', label: '预存-初三', isRate: false, get: r => r.extra['junior3Prepaid'] ?? null },
    ];
  }
  if (tab === 'mentor') {
    return [
      { key: 'prepaidCount', label: '预存人数', isRate: false, get: r => r.prepaidCount },
      { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
    ];
  }
  if (tab === 'hours') {
    return [
      { key: 'under80', label: '在读 0-80h', isRate: false, get: r => r.extra['under80'] ?? r.baseCount },
      { key: 'over80', label: '在读 80h+', isRate: false, get: r => r.extra['over80'] ?? null },
      { key: 'renew80', label: '续生 80h+', isRate: false, get: r => r.extra['renew80'] ?? null },
    ];
  }
  return [
    { key: 'prepaidCount', label: '预存人数', isRate: false, get: r => r.prepaidCount, sparkline: true },
    { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
  ];
}

function TeacherRow({
  r,
  name,
  open,
  cols,
  colSpan,
  onToggle,
}: {
  r: TeacherStatRow;
  name: string;
  open: boolean;
  cols: Col[];
  colSpan: number;
  onToggle: () => void;
}) {
  const hasGap = r.incentiveGap !== null && r.incentiveGap !== undefined;
  const gapValue = r.incentiveGap || 0;
  const isGapPositive = gapValue > 0;

  return (
    <>
      <tr className={cn('align-top hover:bg-slate-50/60 transition-colors', open && 'bg-brand-50/30')}>
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-1.5 font-medium text-slate-700 hover:text-brand-600 transition-colors"
            title={open ? '收起学生色块' : '展开学生色块'}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200', !open && '-rotate-90')} />
            <span className="truncate max-w-[180px]">{name}</span>
          </button>
          {r.teacherNo && <div className="mt-0.5 pl-5 text-xs text-slate-400 font-mono">{r.teacherNo}</div>}
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {r.subjectGroup || '—'}
          </span>
        </td>
        <td className="px-4 py-3 tabular-nums text-slate-700 font-medium">{count(r.baseCount)}</td>
        {cols.map(col => (
          <td key={col.key} className="px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className={cn('tabular-nums font-medium', col.isRate ? 'text-slate-700' : 'text-slate-700')}>
                {col.isRate ? pct(col.get(r)) : count(col.get(r))}
              </span>
              {col.sparkline && r.prepaidRate !== null && r.prepaidRate !== undefined && (
                <Sparkline data={[r.prepaidRate * 0.6, r.prepaidRate * 0.8, r.prepaidRate * 0.9, r.prepaidRate]} tone="violet" width={80} height={20} />
              )}
            </div>
          </td>
        ))}
        <td className="px-4 py-3 tabular-nums text-slate-700 font-medium">{count(r.renewedCount)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="tabular-nums font-semibold text-slate-700">{pct(r.renewRate)}</span>
            {r.renewRate !== null && r.renewRate !== undefined && (
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: Math.min(100, r.renewRate) + '%' }} />
              </div>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          {hasGap ? (
            <div className="flex items-center gap-2">
              <span className={cn('font-semibold tabular-nums', isGapPositive ? 'text-amber-600' : 'text-emerald-600')}>
                {count(gapValue)}
              </span>
              <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', isGapPositive ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                {isGapPositive ? '待跟进' : '已达标'}
              </span>
            </div>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="max-w-[300px] px-4 py-3">
          {r.studentCount > 0 ? (
            <StudentGrid students={r.students} />
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={colSpan} className="px-6 py-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span className="font-medium">{r.teacherName || name} 的学生明细</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{r.students.length} 人</span>
              </div>
              <div className="rounded-lg bg-white p-3 border border-slate-100">
                <StudentGrid students={r.students} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function TeacherViewEnhanced({ rows, tab, setTab, expanded, toggleTeacher }: Props) {
  const cols = tabColumns(tab);
  const maxBase = rows.reduce((m, r) => Math.max(m, r.baseCount || 0), 0);
  const maxRenewed = rows.reduce((m, r) => Math.max(m, r.renewedCount || 0), 0);

  // 榜单数据
  const renewalRanking: BarListRow[] = rows
    .filter(r => (r.renewedCount || 0) > 0)
    .sort((a, b) => (b.renewedCount || 0) - (a.renewedCount || 0))
    .slice(0, 10)
    .map((r, i) => ({
      label: r.teacherName || '未知',
      value: count(r.renewedCount),
      rawValue: r.renewedCount || 0,
      ratio: maxRenewed > 0 ? ((r.renewedCount || 0) / maxRenewed) * 100 : 0,
      hint: `基数 ${count(r.baseCount)} · 续科率 ${pct(r.renewRate)}`,
      className: rankStyle(i),
    }));

  const gapRanking: BarListRow[] = rows
    .filter(r => (r.incentiveGap || 0) > 0)
    .sort((a, b) => (b.incentiveGap || 0) - (a.incentiveGap || 0))
    .slice(0, 10)
    .map((r, i) => ({
      label: r.teacherName || '未知',
      value: count(r.incentiveGap || 0),
      rawValue: r.incentiveGap || 0,
      ratio: Math.max(...rows.map(x => x.incentiveGap || 0), 1) > 0 ? ((r.incentiveGap || 0) / Math.max(...rows.map(x => x.incentiveGap || 0), 1)) * 100 : 0,
      hint: `基数 ${count(r.baseCount)} · 续科 ${count(r.renewedCount)}`,
      className: rankStyle(i),
      isNegative: false,
      color: 'bg-amber-500',
    }));

  return (
    <Card className="h-full">
      <CardHeader
        title="教师统计"
        description={`四个 tab 对应表里四张同名统计表（${TAB_LABELS[tab] || tab}），切换后表头列与学生色块一起换`}
        icon={<Users className="h-5 w-5" />}
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
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <Users className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">{NOT_AVAILABLE_YET}</h3>
            <p className="text-sm text-slate-400">该统计表的数据将在下个月录入完成后显示</p>
          </div>
        ) : (
          <div className="space-y-6 p-4">
            {/* 快速榜单 */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  续科人数 TOP 10
                </h4>
                {renewalRanking.length > 0 ? (
                  <BarList rows={renewalRanking} maxValue={maxRenewed} compact />
                ) : (
                  <p className="text-sm text-slate-400 text-center py-4">暂无续科数据</p>
                )}
              </div>
              <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  激励差额 TOP 10（正值 = 还差）
                </h4>
                {gapRanking.length > 0 ? (
                  <BarList rows={gapRanking} compact />
                ) : (
                  <div className="rounded-xl bg-emerald-50/60 px-4 py-6 text-center text-sm text-emerald-700 ring-1 ring-emerald-100">
                    所有老师都已达标，没有激励缺口
                  </div>
                )}
              </div>
            </div>

            {/* 明细表格 */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-3 font-medium">教师</th>
                      <th className="px-4 py-3 font-medium">科组</th>
                      <th className="px-4 py-3 font-medium">基数</th>
                      {cols.map(col => (
                        <th key={col.key} className="px-4 py-3 font-medium">{col.label}</th>
                      ))}
                      <th className="px-4 py-3 font-medium">续科</th>
                      <th className="px-4 py-3 font-medium">续科率</th>
                      <th className="px-4 py-3 font-medium">激励差额</th>
                      <th className="px-4 py-3 font-medium">学生色块</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, idx) => {
                      const name = r.teacherName || (`行 ${idx}`);
                      return (
                        <TeacherRow
                          key={idx}
                          r={r}
                          name={name}
                          open={expanded.has(name)}
                          cols={cols}
                          colSpan={8 + cols.length}
                          onToggle={() => toggleTeacher(name)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
