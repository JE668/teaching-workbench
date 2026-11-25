import { Activity, CalendarDays, CheckCircle2, Users } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { count, pct, type FunnelRow } from '../../lib/renewal';

interface Props {
  rows: FunnelRow[];
}

type NumericKey = 'students' | 'classedLast2' | 'classedLast1' | 'renewed';

function sumKnown(rows: FunnelRow[], key: NumericKey): number | null {
  const values = rows.map(r => r[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

export default function FunnelViewEnhanced({ rows }: Props) {
  const students = sumKnown(rows, 'students');
  const classedLast2 = sumKnown(rows, 'classedLast2');
  const classedLast1 = sumKnown(rows, 'classedLast1');
  const renewed = sumKnown(rows, 'renewed');
  const overallRenewRate = students !== null && students > 0 && renewed !== null
    ? (renewed / students) * 100
    : null;
  const metrics = [
    { label: '学生基数', value: students, icon: <Users className="h-5 w-5" />, note: '接口学生基数合计' },
    { label: '上 2 月有课消', value: classedLast2, icon: <CalendarDays className="h-5 w-5" />, note: '独立指标 · 非前置阶段' },
    { label: '上 1 月有课消', value: classedLast1, icon: <Activity className="h-5 w-5" />, note: '独立指标 · 非相邻转化' },
    { label: '本月已续费', value: renewed, icon: <CheckCircle2 className="h-5 w-5" />, note: '整体续费率的分子' },
  ];

  return (
    <Card className="h-full">
      <CardHeader
        title="课消与续费概览"
        description="各列为独立统计，不构成严格嵌套漏斗；不计算阶段转化或阶段流失"
        icon={<Activity className="h-5 w-5" />}
      />
      <CardBody className="space-y-6 p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map(metric => (
            <div key={metric.label} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between text-slate-400">
                <p className="text-xs font-medium text-slate-500">{metric.label}</p>
                {metric.icon}
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-800">{count(metric.value)}</p>
              <p className="mt-1 text-xs text-slate-400">{metric.note}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
          <p className="text-sm font-medium text-brand-800">整体续费率</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-brand-700">{pct(overallRenewRate)}</p>
          <p className="mt-1 text-sm text-brand-700/80">
            本月已续费 {count(renewed)} / 学生基数 {count(students)} · 分子分母同源
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">接口已成功返回空列表，暂无课消与续费明细</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 font-medium">学管</th>
                    <th className="px-4 py-3 font-medium">学生基数</th>
                    <th className="px-4 py-3 font-medium">上 2 月有课消</th>
                    <th className="px-4 py-3 font-medium">上 1 月有课消</th>
                    <th className="px-4 py-3 font-medium">本月已续费</th>
                    <th className="px-4 py-3 font-medium">整体续费率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, index) => (
                    <tr key={`${row.managerName}:${index}`} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-700">{row.managerName || '未分配'}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{count(row.students)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{count(row.classedLast2)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{count(row.classedLast1)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{count(row.renewed)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{pct(row.renewRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
