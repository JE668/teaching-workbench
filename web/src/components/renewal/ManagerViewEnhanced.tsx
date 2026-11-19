import React from 'react';
import { Users, Target, TrendingUp, DollarSign, Award, AlertTriangle } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { cn } from '../../lib/utils';
import { clampRatio, count, money, NOT_AVAILABLE_YET, pct, rankStyle, type ManagerPerfRow } from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';
import Sparkline from './Sparkline';

interface Props {
  rows: ManagerPerfRow[];
}

export default function ManagerViewEnhanced({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Card className="h-full">
        <CardBody className="py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <Users className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">没有解析到学管业绩</h3>
            <p className="text-sm text-slate-400">确认表格包含「学管业绩统计表」sheet（表头在第 3-4 行，数据第 5 行起）</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  // 汇总计算
  const totals = rows.reduce(
    (acc, r) => {
      acc.cashflow += r.cashflowTotal || 0;
      acc.task += r.taskAmount || 0;
      acc.renewed += r.renewedCount || 0;
      acc.tutored += r.tutoredCount || 0;
      return acc;
    },
    { cashflow: 0, task: 0, renewed: 0, tutored: 0 }
  );

  const completionRate = totals.task > 0 ? (totals.cashflow / totals.task) * 100 : 0;

  // 榜单数据
  const cashflowRanking: BarListRow[] = rows
    .slice(0, 10)
    .map((r, i) => ({
      label: r.managerName,
      value: money(r.cashflowTotal),
      rawValue: r.cashflowTotal || 0,
      ratio: Math.max(...rows.map(x => x.cashflowTotal || 0), 1) > 0 ? ((r.cashflowTotal || 0) / Math.max(...rows.map(x => x.cashflowTotal || 0), 1)) * 100 : 0,
      hint: `任务 ${money(r.taskAmount)} · 完成率 ${pct(r.completionRate)}`,
      className: rankStyle(i),
    }));

  const completionRanking: BarListRow[] = rows
    .slice()
    .sort((a, b) => (a.completionRate || 0) - (b.completionRate || 0))
    .slice(0, 10)
    .map((r, i) => ({
      label: r.managerName,
      value: pct(r.completionRate),
      rawValue: r.completionRate || 0,
      ratio: (r.completionRate || 0),
      hint: `现金流 ${money(r.cashflowTotal)} / 任务 ${money(r.taskAmount)}`,
      className: rankStyle(i),
      color: (r.completionRate || 0) >= 100 ? 'bg-emerald-500' : (r.completionRate || 0) >= 80 ? 'bg-sky-500' : 'bg-amber-500',
    }));

  return (
    <Card className="h-full">
      <CardHeader
        title="学管业绩"
        description="按现金流降序；任务与完成率为现金流口径，不是人数"
        icon={<Target className="h-5 w-5" />}
        action={<Badge tone="brand">{rows.length} 位学管</Badge>}
      />
      <CardBody className="space-y-6 p-4">
        {/* 汇总卡片行 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">团队现金流</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{money(totals.cashflow)}</p>
            <p className="mt-1 text-xs text-slate-400">任务 ${money(totals.task)} · 完成率 ${pct(completionRate)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">续生人数</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600 tabular-nums">{count(totals.renewed)}</p>
            <p className="mt-1 text-xs text-slate-400">带生 ${count(totals.tutored)} 人</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">平均单产</p>
            <p className="mt-1 text-2xl font-bold text-brand-600 tabular-nums">
              {rows.length > 0 ? money(totals.cashflow / rows.length) : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-400">人均现金流</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">达标人数</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-${completionRate >= 100 ? 'emerald-600' : 'brand-600'}">
              {rows.filter(r => (r.completionRate || 0) >= 100).length} / {rows.length}
            </p>
            <p className="mt-1 text-xs text-slate-400">完成率 ≥ 100%</p>
          </div>
        </div>

        {/* 榜单 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              现金流 TOP 10
            </h4>
            <BarList rows={cashflowRanking} compact />
          </div>
          <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
              <Award className="h-4 w-4 text-amber-500" />
              完成率排序（低→高，重点关注）
            </h4>
            <BarList rows={completionRanking} compact />
          </div>
        </div>

        {/* 明细表格 */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-medium">排名</th>
                  <th className="px-4 py-3 font-medium">学管</th>
                  <th className="px-4 py-3 font-medium">续费汇总</th>
                  <th className="px-4 py-3 font-medium">新签汇总</th>
                  <th className="px-4 py-3 font-medium">续生数</th>
                  <th className="px-4 py-3 font-medium">续生率</th>
                  <th className="px-4 py-3 font-medium">任务</th>
                  <th className="px-4 py-3 font-medium">现金流合计</th>
                  <th className="px-4 py-3 font-medium">完成率</th>
                  <th className="px-4 py-3 font-medium">带生数</th>
                  <th className="px-4 py-3 font-medium">带生单产</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.managerName + ':' + i} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <span className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        i === 0 ? 'bg-amber-100 text-amber-700' : i < 3 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400',
                      )}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{r.managerName}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {r.renew.total !== null ? money(r.renew.total) : <span className="text-slate-400">{NOT_AVAILABLE_YET}</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {r.newsign.total !== null ? money(r.newsign.total) : <span className="text-slate-400">{NOT_AVAILABLE_YET}</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.renewedCount)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{pct(r.renewRate)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{money(r.taskAmount)}</td>
                    <td className="px-4 py-3 tabular-nums font-bold text-slate-800">{money(r.cashflowTotal)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', (r.completionRate ?? 0) >= 100 ? 'bg-emerald-500' : (r.completionRate ?? 0) >= 80 ? 'bg-sky-500' : 'bg-amber-500')}
                            style={{ width: Math.max(0, Math.min(100, clampRatio(r.completionRate, 100))) + '%' }}
                          />
                        </div>
                        <span className="tabular-nums text-slate-600">{pct(r.completionRate)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.actualStudents)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {r.perStudent !== null ? money(r.perStudent) : <span className="text-slate-400">{NOT_AVAILABLE_YET}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <TrendingUp className="h-3.5 w-3.5" />
          提示：续费/新签各分一对一、一对多、小班、其他四列，已在后端按汇总列读取。
        </div>
      </CardBody>
    </Card>
  );
}
