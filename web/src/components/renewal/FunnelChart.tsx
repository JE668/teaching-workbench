import { useMemo } from 'react';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { cn } from '../../lib/utils';
import { TrendingUp, Target, Users, AlertTriangle } from 'lucide-react';
import { count, pct, type FunnelRow } from '../../lib/renewal';

/** 漏斗图数据点 */
interface FunnelDataPoint {
  label: string;
  value: number;
  percentage: number; // 相对于第一阶段的百分比
  conversionRate: number | null; // 相对于上一阶段的转化率
  color: string;
}

const FUNNEL_STAGES: { key: keyof FunnelRow; label: string; color: string }[] = [
  { key: 'students', label: '学员总数', color: '#4F7CFF' },
  { key: 'classedLast2', label: '上2月有课消', color: '#8B5CF6' },
  { key: 'classedLast1', label: '上1月有课消', color: '#0EA5E9' },
  { key: 'renewed', label: '本月已续费', color: '#10B981' },
];

interface FunnelChartProps {
  rows: FunnelRow[];
  /** 是否按学管分组显示 */
  grouped?: boolean;
  /** 高度 */
  height?: number;
  /** 显示转化率标注 */
  showConversion?: boolean;
  /** 自定义标题 */
  title?: string;
}

function sumKnown(rows: FunnelRow[], key: keyof FunnelRow): number {
  return rows.reduce((sum, row) => {
    const value = row[key];
    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
}

function computeFunnelData(rows: FunnelRow[]): FunnelDataPoint[] {
  const totals = FUNNEL_STAGES.map(stage => ({
    ...stage,
    value: sumKnown(rows, stage.key),
  }));

  const firstValue = totals[0].value || 1;
  return totals.map((stage, i) => ({
    label: stage.label,
    value: stage.value,
    percentage: (stage.value / firstValue) * 100,
    conversionRate: i > 0 && totals[i - 1].value > 0
      ? (stage.value / totals[i - 1].value) * 100
      : null,
    color: stage.color,
  }));
}

function computeGroupedFunnelData(rows: FunnelRow[]) {
  const byManager = new Map<string, FunnelRow[]>();
  for (const row of rows) {
    const key = row.managerName || '未分配';
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key)!.push(row);
  }
  return Array.from(byManager.entries()).map(([managerName, managerRows]) => ({
    managerName,
    data: computeFunnelData(managerRows),
    totalStudents: sumKnown(managerRows, 'students'),
  }));
}

export default function FunnelChart({
  rows,
  grouped = false,
  height = 320,
  showConversion = true,
  title,
}: FunnelChartProps) {
  const funnelData = useMemo(() =>
    grouped ? computeGroupedFunnelData(rows) : [{ managerName: '全部', data: computeFunnelData(rows), totalStudents: sumKnown(rows, 'students') }],
  [rows, grouped]);

  const overallData = useMemo(() => computeFunnelData(rows), [rows]);
  const maxPercentage = Math.max(...overallData.map(d => d.percentage), 100);

  if (rows.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title={title || '续生漏斗'} icon={<Users className="h-5 w-5" />} />
        <CardBody className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-medium text-slate-600 mb-1">暂无漏斗数据</h3>
          <p className="text-sm text-slate-400">当前报表无学管漏斗明细</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader title={title || '续生漏斗'} icon={<Users className="h-5 w-5" />} />
      <CardBody className="space-y-6">
        {/* 总览漏斗 */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Target className="h-4 w-4 text-brand-600" />
            整体转化漏斗
          </h4>
          <div className="flex flex-col items-center gap-2" style={{ height }}>
            {overallData.map((stage, i) => {
              const widthPct = (stage.percentage / maxPercentage) * 100;
              const prevStage = overallData[i - 1];
              return (
                <div key={stage.label} className="w-full flex items-center gap-3" style={{ minWidth: 280 }}>
                  <div className="w-36 text-right text-sm font-medium text-slate-700 flex-shrink-0">{stage.label}</div>
                  <div className="flex-1 relative h-12" role="img" aria-label={`${stage.label}: ${count(stage.value)} 人, 占首阶段 ${stage.percentage.toFixed(1)}%`}>
                    <div
                      className="absolute inset-0 rounded-lg bg-slate-100"
                      style={{ width: '100%' }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500 flex items-center justify-between px-3"
                      style={{
                        width: widthPct + '%',
                        backgroundColor: stage.color,
                        minWidth: stage.value > 0 ? '24px' : '0',
                      }}
                    >
                      <span className="text-xs font-semibold text-white truncate pr-2">
                        {count(stage.value)} 人
                      </span>
                      {showConversion && stage.conversionRate !== null && (
                        <span className="text-xs font-medium text-white/90 bg-black/10 px-1.5 py-0.5 rounded mr-2 whitespace-nowrap">
                          转化 {stage.conversionRate.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-24 text-left text-sm text-slate-500 flex-shrink-0">
                    {stage.percentage.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 分组漏斗 */}
        {grouped && funnelData.length > 1 && (
          <div className="border-t border-slate-200 pt-6 space-y-4">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              学管分组漏斗（仅显示学员数 &gt;
            </h4>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {funnelData
                .filter(g => g.totalStudents > 0)
                .sort((a, b) => b.totalStudents - a.totalStudents)
                .map(group => (
                  <div key={group.managerName} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <h5 className="font-medium text-slate-800 mb-3 flex items-center justify-between">
                      <span>{group.managerName}</span>
                      <span className="text-xs text-slate-500">{count(group.totalStudents)} 人</span>
                    </h5>
                    <div className="space-y-2" style={{ height: 180 }}>
                      {group.data.map((stage, i) => {
                        const widthPct = group.data[0].value > 0
                          ? (stage.value / group.data[0].value) * 100
                          : 0;
                        return (
                          <div key={stage.label} className="flex items-center gap-2">
                            <div className="w-20 text-xs text-slate-600 truncate">{stage.label}</div>
                            <div className="flex-1 relative h-6 bg-slate-200 rounded">
                              <div
                                className="absolute inset-y-0 left-0 rounded h-full transition-all duration-300 flex items-center justify-start px-1.5"
                                style={{
                                  width: widthPct + '%',
                                  backgroundColor: stage.color,
                                  minWidth: stage.value > 0 ? '20px' : '0',
                                }}
                              >
                                <span className="text-[10px] font-semibold text-white truncate">
                                  {count(stage.value)}
                                </span>
                              </div>
                            </div>
                            <div className="w-16 text-right text-xs text-slate-500">{widthPct.toFixed(1)}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 关键指标卡片 */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 border-t border-slate-200 pt-4">
          {overallData.slice(1).map((stage, i) => (
            <div key={stage.label} className="rounded-lg bg-white border border-slate-100 p-3">
              <p className="text-xs text-slate-500">{stage.label}</p>
              <p className="text-xl font-bold text-slate-800 tabular-nums">{count(stage.value)}</p>
              <p className="text-xs text-slate-400">
                {stage.conversionRate !== null
                  ? `转化率 ${stage.conversionRate.toFixed(1)}%`
                  : `占比 ${stage.percentage.toFixed(1)}%`}
              </p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
