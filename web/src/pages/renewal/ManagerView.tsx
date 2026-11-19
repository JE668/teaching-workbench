import { Users, Target, TrendingUp } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { cn } from '../../lib/utils';
import { clampRatio, count, money, NOT_AVAILABLE_YET, pct, type ManagerPerfRow } from '../../lib/renewal';

/**
 * 学管业绩视图。
 * 注意 O 列「任务」是现金流大数（百万级），不是人数 —— 已用 money() 转成万。
 * 完成率列用进度条呈现，方便一眼定位谁差得最多。
 */
export default function ManagerView({ rows }: { rows: ManagerPerfRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="没有解析到学管业绩"
            description="确认表格包含「学管业绩统计表」sheet（表头在第 3-4 行，数据第 5 行起）。"
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="学管业绩"
        description="按现金流降序；任务与完成率为现金流口径，不是人数"
        icon={<Target className="h-5 w-5" />}
        action={<Badge tone="brand">{rows.length} 位学管</Badge>}
      />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">学管</th>
                <th className="px-4 py-2.5 font-medium">续费汇总</th>
                <th className="px-4 py-2.5 font-medium">新签汇总</th>
                <th className="px-4 py-2.5 font-medium">续生数</th>
                <th className="px-4 py-2.5 font-medium">续生率</th>
                <th className="px-4 py-2.5 font-medium">任务</th>
                <th className="px-4 py-2.5 font-medium">现金流合计</th>
                <th className="px-4 py-2.5 font-medium">完成率</th>
                <th className="px-4 py-2.5 font-medium">带生数</th>
                <th className="px-4 py-2.5 font-medium">带生单产</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.managerName + ':' + i} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-700">
                    <span className="flex items-center gap-2">
                      <span className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        i === 0 ? 'bg-amber-100 text-amber-700' : i < 3 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400',
                      )}>{i + 1}</span>
                      {r.managerName}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{r.renew.total !== null ? money(r.renew.total) : <span className="text-slate-400">{NOT_AVAILABLE_YET}</span>}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{r.newsign.total !== null ? money(r.newsign.total) : <span className="text-slate-400">{NOT_AVAILABLE_YET}</span>}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.renewedCount)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{pct(r.renewRate)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{money(r.taskAmount)}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-800">{money(r.cashflowTotal)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn('h-full rounded-full', (r.completionRate ?? 0) >= 100 ? 'bg-emerald-500' : (r.completionRate ?? 0) >= 80 ? 'bg-sky-500' : 'bg-amber-500')}
                          style={{ width: Math.max(0, Math.min(100, clampRatio(r.completionRate, 100))) + '%' }}
                        />
                      </div>
                      <span className="tabular-nums text-slate-600">{pct(r.completionRate)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.actualStudents)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{r.perStudent !== null ? money(r.perStudent) : <span className="text-slate-400">{NOT_AVAILABLE_YET}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-1.5 px-5 py-3 text-xs text-slate-400">
          <TrendingUp className="h-3.5 w-3.5" />
          提示：续费/新签各分一对一、一对多、小班、其他四列，已在后端按汇总列读取。
        </div>
      </CardBody>
    </Card>
  );
}
