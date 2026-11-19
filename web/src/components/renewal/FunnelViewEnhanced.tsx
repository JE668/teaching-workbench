import React from 'react';
import { Funnel, Users, TrendingUp, AlertTriangle, Target } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { count, NOT_AVAILABLE_YET, pct, type FunnelRow } from '../../lib/renewal';
import FunnelChart from './FunnelChart';
import Sparkline from './Sparkline';
import BarList, { BarListRow } from './BarList';

interface Props {
  stages: { name: string; value: number }[];
  managerRows?: { manager: string; students: number; renewed: number; rate: number }[];
}

export default function FunnelViewEnhanced({ stages, managerRows }: Props) {
  const hasData = stages.length > 0 && stages.some(s => s.value > 0);
  const totalAtTop = stages[0]?.value ?? 0;

  if (!hasData) {
    return (
      <Card className="h-full">
        <CardHeader
          title="续生漏斗"
          description="从在册基数 → 续费意向 → 正式续费 → 到课的转化路径"
          icon={<Funnel className="h-5 w-5" />}
        />
        <CardBody className="py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <Funnel className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">{NOT_AVAILABLE_YET}</h3>
            <p className="text-sm text-slate-400">续生率明细将在下个月录入完成后显示</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  // 转换为 FunnelChart 需要的格式
  const funnelSteps = stages.map((s, i) => ({
    label: s.name,
    count: s.value,
    width: totalAtTop > 0 ? (s.value / totalAtTop) * 100 : 0,
    conversionRate: i === 0 ? 100 : stages[i - 1]?.value ? (s.value / stages[i - 1].value) * 100 : 0,
    dropOff: i === 0 ? 0 : (stages[i - 1]?.value || 0) - s.value,
  }));

  return (
    <Card className="h-full">
      <CardHeader
        title="续生漏斗"
        description="从在册基数 → 续费意向 → 正式续费 → 到课的转化路径"
        icon={<Funnel className="h-5 w-5" />}
      />
      <CardBody className="space-y-6 p-4">
        {/* 主漏斗 */}
        <FunnelChart
          steps={funnelSteps}
          onStepClick={(step, index) => {
            if (step.label.includes('正式续费') && managerRows?.length) {
              // 触发下钻逻辑（未来扩展）
            }
          }}
        />

        {/* 关键转化指标 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {funnelSteps.slice(1).map((s, i) => (
            <div key={s.label} className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide">{s.label} / 上一层</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-brand-600">{pct(s.conversionRate)}</p>
              <p className="mt-1 text-xs text-slate-400">流失 {count(s.dropOff)} 人</p>
            </div>
          ))}
        </div>

        {/* 学管分解（如有数据） */}
        {managerRows && managerRows.length > 0 && (
          <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
              <Users className="h-4 w-4 text-brand-500" />
              学管分解 · 正式续费人数 TOP 10
            </h4>
            <BarList
              rows={managerRows
                .sort((a, b) => b.renewed - a.renewed)
                .slice(0, 10)
                .map((r, i) => ({
                  label: r.manager,
                  value: count(r.renewed),
                  rawValue: r.renewed,
                  ratio: totalAtTop > 0 ? (r.renewed / totalAtTop) * 100 : 0,
                  hint: `学生数 ${count(r.students)} · 续生率 ${pct(r.rate)}`,
                  className: i === 0 ? 'bg-amber-100 text-amber-700' : i < 3 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400',
                }))}
              compact
            />
          </div>
        )}

        {/* 洞察卡片 */}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl bg-brand-50 p-4 border border-brand-100">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-brand-500" />
              <span className="font-medium text-brand-700">整体转化率</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-brand-600 tabular-nums">{pct(funnelSteps[funnelSteps.length - 1]?.conversionRate ?? 0)}</p>
            <p className="mt-1 text-sm text-brand-500">从在册基数到最终到课</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 border border-amber-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <span className="font-medium text-amber-700">最大流失点</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-amber-600 tabular-nums">
              {funnelSteps.slice(1).sort((a, b) => b.dropOff - a.dropOff)[0]?.label || '—'}
            </p>
            <p className="mt-1 text-sm text-amber-500">流失 {funnelSteps.slice(1).sort((a, b) => b.dropOff - a.dropOff)[0]?.dropOff || 0} 人</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-100">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              <span className="font-medium text-emerald-700">最佳转化层级</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-emerald-600 tabular-nums">
              {funnelSteps.slice(1).sort((a, b) => b.conversionRate - a.conversionRate)[0]?.label || '—'}
            </p>
            <p className="mt-1 text-sm text-emerald-500">{pct(funnelSteps.slice(1).sort((a, b) => b.conversionRate - a.conversionRate)[0]?.conversionRate ?? 0)} 通过</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
