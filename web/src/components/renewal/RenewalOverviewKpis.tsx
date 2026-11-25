import { AlertTriangle, Target, TrendingUp, Users } from 'lucide-react';
import KpiCard from './KpiCard';
import { cn } from '../../lib/utils';
import {
  TAB_LABELS,
  clampRatio,
  count,
  pct,
  type RenewalOverview,
} from '../../lib/renewal';

interface Props {
  tab: string;
  overview: RenewalOverview;
}

/** 总览只在这里渲染；所有数值由当前 tab 的同一份教师明细计算。 */
export default function RenewalOverviewKpis({ tab, overview }: Props) {
  const source = `${TAB_LABELS[tab] || tab}表 · ${overview.sourceRows} 位教师明细合计`;
  const hasBase = overview.baseCount !== null && overview.baseCount > 0;
  const cards = [
    <KpiCard
      key="base"
      label="学生基数"
      value={count(overview.baseCount)}
      tone="brand"
      icon={<Users className="h-4 w-4" />}
      hint={source}
    />,
  ];

  if (tab === 'stage') {
    cards.push(
      <KpiCard
        key="prepaid"
        label="已预存（总）"
        value={count(overview.prepaidCount)}
        tone="violet"
        icon={<Target className="h-4 w-4" />}
        progress={hasBase && overview.prepaidCount !== null ? clampRatio(overview.prepaidCount, overview.baseCount) : undefined}
        hint={overview.prepaidCount === null ? '当前学段表未提供总预存列' : source}
      />,
      <KpiCard
        key="prepaid-rate"
        label="总预存率"
        value={pct(overview.prepaidRate)}
        tone="violet"
        icon={<TrendingUp className="h-4 w-4" />}
        hint={overview.prepaidRate === null ? '总预存或有效学生基数缺失' : `${count(overview.prepaidCount)} / ${count(overview.baseCount)} · 分子分母同源`}
      />,
      <KpiCard
        key="nongrad"
        label="非毕业班预存"
        value={count(overview.nonGradPrepaidCount)}
        tone="emerald"
        icon={<Target className="h-4 w-4" />}
        hint={overview.nonGradPrepaidCount === null ? '当前学段表未提供该列' : '不含初三、高三 · 学段表明细合计'}
      />,
    );
  } else {
    cards.push(
      <KpiCard
        key="prepaid"
        label="已预存"
        value={count(overview.prepaidCount)}
        tone="violet"
        icon={<Target className="h-4 w-4" />}
        progress={hasBase && overview.prepaidCount !== null ? clampRatio(overview.prepaidCount, overview.baseCount) : undefined}
        hint={overview.prepaidRate === null ? '预存率 —' : `预存率 ${pct(overview.prepaidRate)} · 分子分母同源`}
      />,
      <KpiCard
        key="renewed"
        label="已续科"
        value={count(overview.renewedCount)}
        tone="emerald"
        icon={<TrendingUp className="h-4 w-4" />}
        progress={hasBase && overview.renewedCount !== null ? clampRatio(overview.renewedCount, overview.baseCount) : undefined}
        hint={overview.renewRate === null ? '续科率 —' : `续科率 ${pct(overview.renewRate)} · ${count(overview.renewedCount)} / ${count(overview.baseCount)}`}
      />,
    );
    if (tab === 'incentive') {
      cards.push(
        <KpiCard
          key="gap"
          label="激励差额"
          value={count(overview.incentiveGap)}
          tone="amber"
          icon={<AlertTriangle className="h-4 w-4" />}
          hint={overview.incentiveGap === null ? '当前激励表未提供该列' : '正值 = 距目标还差人数 · 同表合计'}
        />,
      );
    }
  }

  return <div className={cn('grid grid-cols-2 gap-4', cards.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>{cards}</div>;
}
