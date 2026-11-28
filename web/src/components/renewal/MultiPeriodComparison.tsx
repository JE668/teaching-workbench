import { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { Card } from '../../components/ui/Card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Snapshot {
  reportId: number;
  statMonth: string;
  centerName: string | null;
  uploadedAt: string;
  overview: {
    baseCount: number | null;
    prepaidCount: number | null;
    renewedCount: number | null;
    prepaidRate: number | null;
    renewRate: number | null;
    incentiveGap: number | null;
  };
  teacherCount: number;
}

interface MultiPeriodComparisonProps {
  snapshots: Snapshot[];
  currentReportId: number;
}

export default function MultiPeriodComparison({ snapshots, currentReportId }: MultiPeriodComparisonProps) {
  const sortedSnapshots = useMemo(() =>
    [...snapshots].sort((a, b) => a.statMonth.localeCompare(b.statMonth)),
    [snapshots]
  );

  const currentSnapshot = sortedSnapshots.find(s => s.reportId === currentReportId);
  const previousSnapshot = sortedSnapshots[sortedSnapshots.findIndex(s => s.reportId === currentReportId) - 1];

  const columns = [
    { key: 'statMonth', label: '统计月份', width: 'w-24' },
    { key: 'teacherCount', label: '教师数', width: 'w-20' },
    { key: 'totalBase', label: '学生基数', width: 'w-24' },
    { key: 'totalPrepaid', label: '总预存', width: 'w-24' },
    { key: 'prepaidRate', label: '预存率', width: 'w-24' },
    { key: 'totalRenewed', label: '已续科', width: 'w-24' },
    { key: 'renewRate', label: '续费率', width: 'w-24' },
    { key: 'incentiveGap', label: '80%差额', width: 'w-24' },
    { key: 'prepaidRateDiff', label: '预存率环比', width: 'w-28' },
    { key: 'renewRateDiff', label: '续费率环比', width: 'w-28' },
  ];

  const rows = useMemo(() => {
    return sortedSnapshots.map((snapshot, index) => {
      const overview = snapshot.overview;
      const baseCount = overview.baseCount ?? 0;
      const prepaidCount = overview.prepaidCount ?? 0;
      const renewedCount = overview.renewedCount ?? 0;
      const prepaidRate = overview.prepaidRate ?? (baseCount > 0 ? (prepaidCount / baseCount) * 100 : 0);
      const renewRate = overview.renewRate ?? (prepaidCount > 0 ? (renewedCount / prepaidCount) * 100 : 0);

      let prepaidRateDiff = null;
      let renewRateDiff = null;

      if (index > 0) {
        const prev = sortedSnapshots[index - 1];
        const prevOverview = prev.overview;
        const prevBaseCount = prevOverview.baseCount ?? 0;
        const prevPrepaidCount = prevOverview.prepaidCount ?? 0;
        const prevRenewedCount = prevOverview.renewedCount ?? 0;
        const prevPrepaidRate = prevOverview.prepaidRate ?? (prevBaseCount > 0 ? (prevPrepaidCount / prevBaseCount) * 100 : 0);
        const prevRenewRate = prevOverview.renewRate ?? (prevPrepaidCount > 0 ? (prevRenewedCount / prevPrepaidCount) * 100 : 0);
        prepaidRateDiff = prepaidRate - prevPrepaidRate;
        renewRateDiff = renewRate - prevRenewRate;
      }

      return {
        ...snapshot,
        prepaidRate,
        renewRate,
        prepaidRateDiff,
        renewRateDiff,
        isCurrent: snapshot.reportId === currentReportId,
      };
    });
  }, [sortedSnapshots, currentReportId]);

  const formatDiff = (diff: number | null) => {
    if (diff === null) return <span className="text-slate-400">—</span>;
    const icon = diff > 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> :
              diff < 0 ? <TrendingDown className="h-3.5 w-3.5 text-rose-600" /> :
              <Minus className="h-3.5 w-3.5 text-slate-400" />;
    const color = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-rose-600' : 'text-slate-400';
    return (
      <span className={cn('flex items-center gap-1 font-medium', color)}>
        {icon}
        {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
      </span>
    );
  };

  const getRateColor = (rate: number) => {
    if (rate >= 80) return 'text-emerald-600';
    if (rate >= 60) return 'text-amber-600';
    return 'text-rose-600';
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">多期数据对比</h3>
        <span className="text-xs text-slate-500">{sortedSnapshots.length} 个统计月份</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              {columns.map(col => (
                <th key={col.key} className={cn('px-3 py-2.5', col.width)}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr
                key={row.reportId}
                className={cn(
                  'transition-colors',
                  row.isCurrent ? 'bg-brand-50' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                )}
              >
                <td className="px-3 py-2.5 font-medium text-slate-800">
                  {row.statMonth}
                  {row.isCurrent && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-700 rounded-full">
                      当前
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{row.teacherCount}</td>
                <td className="px-3 py-2.5 text-slate-600">{(row.overview.baseCount ?? 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-slate-600">{(row.overview.prepaidCount ?? 0).toLocaleString()}</td>
                <td className={cn('px-3 py-2.5 font-medium', getRateColor(row.prepaidRate))}>
                  {row.prepaidRate.toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-slate-600">{(row.overview.renewedCount ?? 0).toLocaleString()}</td>
                <td className={cn('px-3 py-2.5 font-medium', getRateColor(row.renewRate))}>
                  {row.renewRate.toFixed(1)}%
                </td>
                <td className={cn('px-3 py-2.5 font-medium', (row.overview.incentiveGap ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                  {(row.overview.incentiveGap ?? 0) > 0 ? '+' : ''}{row.overview.incentiveGap ?? 0}
                </td>
                <td className="px-3 py-2.5">{formatDiff(row.prepaidRateDiff)}</td>
                <td className="px-3 py-2.5">{formatDiff(row.renewRateDiff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {currentSnapshot && previousSnapshot && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
          <p className="text-xs text-slate-600">
            <strong className="text-slate-800">环比 {previousSnapshot.statMonth}：</strong>{' '}
            预存率 {(currentSnapshot.overview.baseCount ?? 0) > 0
              ? (((currentSnapshot.overview.prepaidCount ?? 0) / (currentSnapshot.overview.baseCount ?? 1)) * 100 -
                 ((previousSnapshot.overview.prepaidCount ?? 0) / (previousSnapshot.overview.baseCount ?? 1)) * 100).toFixed(1)
              : '0.0'
            }%{' '}
            {(currentSnapshot.overview.baseCount ?? 0) > 0 && (previousSnapshot.overview.baseCount ?? 0) > 0
              ? ((currentSnapshot.overview.prepaidCount ?? 0) / (currentSnapshot.overview.baseCount ?? 1)) * 100 >
                ((previousSnapshot.overview.prepaidCount ?? 0) / (previousSnapshot.overview.baseCount ?? 1)) * 100 ? '↑' : '↓'
              : ''}{' '}
            续费率 {(currentSnapshot.overview.prepaidCount ?? 0) > 0
              ? (((currentSnapshot.overview.renewedCount ?? 0) / (currentSnapshot.overview.prepaidCount ?? 1)) * 100 -
                 ((previousSnapshot.overview.renewedCount ?? 0) / (previousSnapshot.overview.prepaidCount ?? 1)) * 100).toFixed(1)
              : '0.0'
            }%{' '}
            {(currentSnapshot.overview.prepaidCount ?? 0) > 0 && (previousSnapshot.overview.prepaidCount ?? 0) > 0
              ? ((currentSnapshot.overview.renewedCount ?? 0) / (currentSnapshot.overview.prepaidCount ?? 1)) * 100 >
                ((previousSnapshot.overview.renewedCount ?? 0) / (previousSnapshot.overview.prepaidCount ?? 1)) * 100 ? '↑' : '↓'
              : ''}
          </p>
        </div>
      )}
    </Card>
  );
}
