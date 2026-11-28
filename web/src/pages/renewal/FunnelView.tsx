import { Filter, PieChart } from 'lucide-react';
import FunnelChart from '../../components/renewal/FunnelChart';
import StatusDonut from '../../components/renewal/StatusDonut';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { count, NOT_AVAILABLE_YET, pct, type FunnelRow } from '../../lib/renewal';

/**
 * 续生漏斗视图。
 * 左侧是全体漏斗（总数 → 上2月课消 → 上1月课消 → 已续费），
 * 右侧是学管维度的漏斗明细 + 学生色块状态分布。
 */
export default function FunnelView({
  rows,
  statusRows,
}: {
  rows: FunnelRow[];
  statusRows: { status: string; count: number }[];
}) {
  if (rows.length === 0 && statusRows.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Filter className="h-7 w-7" />}
            title={NOT_AVAILABLE_YET}
            description="续生率明细将在下个月录入完成后显示。"
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="整体续生漏斗" description="按续生率 sheet 的标记列逐层收窄" icon={<Filter className="h-5 w-5" />} />
        <CardBody>
          <FunnelChart rows={rows} />
          {statusRows.length > 0 && (
            <>
              <div className="my-6 h-px bg-slate-100" />
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <PieChart className="h-4 w-4 text-brand-500" /> 学生色块状态分布
              </h3>
              <StatusDonut rows={statusRows} />
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="分学管漏斗" description="续生率 = 本月已续费 / 学生总数" />
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <EmptyState title="无数据" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">学管</th>
                    <th className="px-4 py-2.5 font-medium">学生</th>
                    <th className="px-4 py-2.5 font-medium">上2月课消</th>
                    <th className="px-4 py-2.5 font-medium">上1月课消</th>
                    <th className="px-4 py-2.5 font-medium">已续费</th>
                    <th className="px-4 py-2.5 font-medium">续生率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={r.managerName + ':' + i} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-700">{r.managerName}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.students)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{count(r.classedLast2)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{count(r.classedLast1)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.renewed)}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-slate-800">{pct(r.renewRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
