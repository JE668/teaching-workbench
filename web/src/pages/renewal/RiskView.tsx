import { AlertTriangle } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { count, NOT_AVAILABLE_YET, type RiskStudentRow } from '../../lib/renewal';

/**
 * 风险学生清单。
 * 判定完全沿用 Excel 的原始标记：renewed=0 且 class_last1=0（本月未续 + 上1月无课消），
 * 已按「上2月有课消优先、报读天数久优先」排序，方便从上往下逐个跟进。
 */
export default function RiskView({ rows }: { rows: RiskStudentRow[] }) {
  return (
    <Card>
      <CardHeader
        title="风险学生清单"
        description="本月未续费且上 1 个月无课消的学生（沉默/流失高风险）"
        icon={<AlertTriangle className="h-5 w-5" />}
        action={<Badge tone={rows.length > 0 ? 'danger' : 'success'}>{rows.length} 人</Badge>}
      />
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            title="本期数据为空，下月开启"
            description="续生率明细将在下个月录入完成后显示，随后自动生成风险清单。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">学管</th>
                  <th className="px-4 py-2.5 font-medium">学生</th>
                  <th className="px-4 py-2.5 font-medium">学生编号</th>
                  <th className="px-4 py-2.5 font-medium">年级</th>
                  <th className="px-4 py-2.5 font-medium">报读天数</th>
                  <th className="px-4 py-2.5 font-medium">系数</th>
                  <th className="px-4 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 font-medium">课消产品</th>
                  <th className="px-4 py-2.5 font-medium">信号</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.studentId || r.studentName + ':' + i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-600">{r.managerName || '-'}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{r.studentName}</td>
                    <td className="px-4 py-3 text-slate-600">{r.studentId || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.grade || '-'}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{count(r.enrollDays)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{r.coef ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.type || '-'}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-slate-600" title={r.courseProduct || ''}>{r.courseProduct || '-'}</td>
                    <td className="px-4 py-3">
                      {r.classLast2 === 1 ? (
                        <Badge tone="warning">上月消失</Badge>
                      ) : (
                        <Badge tone="neutral">持续沉默</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
