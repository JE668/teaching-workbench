import React from 'react';
import { TrendingUp, Target, Users, AlertTriangle, Calendar, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { count, pct, money, clampRatio, NOT_AVAILABLE_YET, type TeacherStatRow, type ManagerPerfRow } from '../../lib/renewal';
import KpiCard from './KpiCard';

interface ExecutiveSummaryProps {
  teacherRows: TeacherStatRow[];
  managerRows: ManagerPerfRow[];
  reportId: number | null;
  reports: { reportId: number; statMonth: string | null; centerName: string | null; fileName: string }[];
  currentTab: string;
  onCompareClick?: () => void;
}


export default function ExecutiveSummary({
  teacherRows,
  managerRows,
  reportId,
  reports,
  currentTab,
  onCompareClick,
}: ExecutiveSummaryProps) {
  const hasTeacherData = teacherRows.length > 0;
  const hasManagerData = managerRows.length > 0;

  // 汇总计算
  const totals = hasTeacherData
    ? teacherRows.reduce(
        (acc, r) => {
          acc.base += r.baseCount || 0;
          acc.renewed += r.renewedCount || 0;
          acc.prepaid += r.prepaidCount || 0;
          acc.gap += r.incentiveGap || 0;
          return acc;
        },
        { base: 0, renewed: 0, prepaid: 0, gap: 0 }
      )
    : null;

  const renewRate = totals && totals.base > 0 ? (totals.renewed / totals.base) * 100 : 0;
  const prepaidRate = totals && totals.base > 0 ? (totals.prepaid / totals.base) * 100 : 0;

  // 学管业绩汇总
  const managerTotals = hasManagerData
    ? managerRows.reduce(
        (acc, r) => {
          acc.cashflow += r.cashflowTotal || 0;
          acc.task += r.taskAmount || 0;
          acc.renewed += r.renewedCount || 0;
          acc.tutored += r.tutoredCount || 0;
          return acc;
        },
        { cashflow: 0, task: 0, renewed: 0, tutored: 0 }
      )
    : null;

  const completionRate = managerTotals && managerTotals.task > 0 ? (managerTotals.cashflow / managerTotals.task) * 100 : 0;

  // 生成洞察
  const insights = React.useMemo(() => {
    const items: { icon: React.ReactNode; text: string; tone: 'brand' | 'emerald' | 'amber' | 'red' }[] = [];

    if (!hasTeacherData && !hasManagerData) {
      items.push({
        icon: <Calendar className="h-4 w-4" />,
        text: '当前报表数据尚未录入，请上传本月续费统计表',
        tone: 'amber',
      });
      return items;
    }

    if (hasTeacherData) {
      // 续科率洞察
      if (renewRate >= 90) {
        items.push({
          icon: <TrendingUp className="h-4 w-4" />,
          text: `整体续科率 ${pct(renewRate)}，表现优秀，已接近满额`,
          tone: 'emerald',
        });
      } else if (renewRate >= 70) {
        items.push({
          icon: <TrendingUp className="h-4 w-4" />,
          text: `整体续科率 ${pct(renewRate)}，有提升空间，建议关注差额前三的老师`,
          tone: 'brand',
        });
      } else if (renewRate > 0) {
        items.push({
          icon: <AlertTriangle className="h-4 w-4" />,
          text: `整体续科率仅 ${pct(renewRate)}，低于预警线，需立即干预`,
          tone: 'red',
        });
      }

      // 激励差额洞察
      if (totals && totals.gap > 0) {
        const gapTeachers = teacherRows.filter(r => (r.incentiveGap || 0) > 0).length;
        items.push({
          icon: <Target className="h-4 w-4" />,
          text: `激励差额合计 ${count(totals.gap)} 人，涉及 ${gapTeachers} 位老师，建议逐人落实跟进`,
          tone: 'amber',
        });
      } else if (totals && totals.gap <= 0) {
        items.push({
          icon: <Target className="h-4 w-4" />,
          text: '全员已达成激励目标，差额为 0 或负值（超额完成）',
          tone: 'emerald',
        });
      }

      // 预存洞察
      if (prepaidRate > 0) {
        items.push({
          icon: <Users className="h-4 w-4" />,
          text: `预存率 ${pct(prepaidRate)} (${count(totals?.prepaid || 0)}/${count(totals?.base || 0)})，${prepaidRate >= 80 ? '预存基础扎实' : '预存有待加强'}`,
          tone: prepaidRate >= 80 ? 'emerald' : 'brand',
        });
      }
    }

    if (hasManagerData && managerTotals) {
      if (completionRate >= 100) {
        items.push({
          icon: <TrendingUp className="h-4 w-4" />,
          text: `学管团队现金流 ${money(managerTotals.cashflow)}，完成率 ${pct(completionRate)}，超额达标`,
          tone: 'emerald',
        });
      } else if (completionRate > 0) {
        items.push({
          icon: <Target className="h-4 w-4" />,
          text: `学管团队现金流 ${money(managerTotals.cashflow)}，完成率 ${pct(completionRate)}，距目标尚差 ${money(managerTotals.task - managerTotals.cashflow)}`,
          tone: completionRate >= 80 ? 'brand' : 'amber',
        });
      }
    }

    return items.slice(0, 4); // 最多显示 4 条洞察
  }, [hasTeacherData, hasManagerData, renewRate, prepaidRate, totals, managerTotals, completionRate, teacherRows]);

  const currentReport = reports.find(r => r.reportId === reportId);

  return (
    <div className="space-y-6">
      {/* 报表上下文 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {currentReport?.centerName || currentReport?.fileName || '续费看板'}
            </h2>
            <p className="text-sm text-slate-500">
              {currentReport?.statMonth ? `统计月份：${currentReport.statMonth}` : '月份未识别'}
              {reportId && reports.length > 1 && ` · 共 ${reports.length} 份报表`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reports.length > 1 && onCompareClick && (
            <button
              onClick={onCompareClick}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 transition-colors"
            >
              <ArrowRight className="h-4 w-4" />
              多期对比
            </button>
          )}
        </div>
      </div>

      {/* 核心 KPI 卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="学生基数"
          value={hasTeacherData ? count(totals!.base) : NOT_AVAILABLE_YET}
          hint={hasTeacherData ? `当前 ${currentTab === 'incentive' ? '激励' : currentTab === 'stage' ? '学段' : currentTab === 'mentor' ? '学管' : '课时'} 表合计` : '数据下月开启'}
          icon={<Users className="h-4 w-4" />}
          tone="brand"
        />
        <KpiCard
          label="已续科"
          value={hasTeacherData ? count(totals!.renewed) : NOT_AVAILABLE_YET}
          hint={hasTeacherData ? `续科率 ${pct(renewRate)}` : '数据下月开启'}
          icon={<TrendingUp className="h-4 w-4" />}
          progress={hasTeacherData ? clampRatio(totals!.renewed, totals!.base) : undefined}
          tone="emerald"
        />
        <KpiCard
          label="已预存"
          value={hasTeacherData ? count(totals!.prepaid) : NOT_AVAILABLE_YET}
          hint={hasTeacherData ? `预存率 ${pct(prepaidRate)}` : '数据下月开启'}
          icon={<Target className="h-4 w-4" />}
          progress={hasTeacherData ? clampRatio(totals!.prepaid, totals!.base) : undefined}
          tone="violet"
        />
        <KpiCard
          label="激励差额"
          value={hasTeacherData ? count(totals!.gap) : NOT_AVAILABLE_YET}
          hint={hasTeacherData ? (totals!.gap > 0 ? `尚差 ${count(totals!.gap)} 人达标` : '全员达标 ✓') : '数据下月开启'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={hasTeacherData && totals && totals.gap > 0 ? 'amber' : 'emerald'}
        />
      </div>

      {/* 关键洞察 */}
      {insights.length > 0 && (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
            <TrendingUp className="h-4 w-4 text-brand-600" />
            关键洞察
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {insights.map((insight, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-xl p-3.5 border transition-colors',
                  insight.tone === 'emerald' && 'bg-emerald-50 border-emerald-100',
                  insight.tone === 'brand' && 'bg-brand-50 border-brand-100',
                  insight.tone === 'amber' && 'bg-amber-50 border-amber-100',
                  insight.tone === 'red' && 'bg-red-50 border-red-100',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className={cn('flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg', {
                    'bg-emerald-100 text-emerald-600': insight.tone === 'emerald',
                    'bg-brand-100 text-brand-600': insight.tone === 'brand',
                    'bg-amber-100 text-amber-600': insight.tone === 'amber',
                    'bg-red-100 text-red-600': insight.tone === 'red',
                  })}>
                    {insight.icon}
                  </span>
                  <p className={cn('text-sm text-slate-700 leading-relaxed', {
                    'text-emerald-800': insight.tone === 'emerald',
                    'text-brand-800': insight.tone === 'brand',
                    'text-amber-800': insight.tone === 'amber',
                    'text-red-800': insight.tone === 'red',
                  })}>
                    {insight.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
