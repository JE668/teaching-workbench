import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { api } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';

interface MonthlyReport {
  month: string | null;
  xuke: { total_base: number; total_renewed: number; overall_rate: number; teacher_count: number };
  xusheng: { total_base: number; total_renewed: number; overall_rate: number; mentor_count: number };
  presale: { total_vouchers: number; total_students: number; total_amount: number; learning_center_count: number };
  incentive: { entries: number; total_gap: number };
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

/**
 * 主看板顶部的「本月 BI 概览」卡片。
 * 数据来自 /api/bi/metrics/report，接口失败时静默降级（不阻塞日常教学看板）。
 * 设计目的：让老师/学管打开首页就能看到本月续科率/续生率/预存/激励四项核心指标，
 * 不必主动跳到 BI 看板页（M9）。
 */
export default function BiOverviewCard() {
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get('/bi/metrics/report')
      .then((r: MonthlyReport) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        // BI 未上传或后端异常时降级为不渲染，不打扰主看板
        if (alive) setHidden(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (hidden || !report) return null;

  const cells: { label: string; value: string; hint?: string; to: string }[] = [
    {
      label: '续科率',
      value: pct(report.xuke.overall_rate),
      hint: report.xuke.total_renewed + '/' + report.xuke.total_base,
      to: '/bi-dashboard',
    },
    {
      label: '续生率',
      value: pct(report.xusheng.overall_rate),
      hint: report.xusheng.total_renewed + '/' + report.xusheng.total_base,
      to: '/bi-dashboard',
    },
    {
      label: '预存',
      value: String(report.presale.total_students),
      hint: report.presale.total_vouchers + ' 张有效券',
      to: '/bi-reconciliation',
    },
    {
      label: '激励差额',
      value: String(report.incentive.total_gap),
      hint: report.incentive.entries + ' 条目标',
      to: '/bi-dashboard',
    },
  ];

  return (
    <Card className="animate-fade-up">
      <CardHeader
        title={'本月 BI 概览' + (report.month ? '（' + report.month + '）' : '')}
        description="续科率 / 续生率 / 预存 / 激励差额"
        icon={<BarChart3 className="h-4 w-4" />}
        action={
          <Link to="/bi-dashboard" className="text-sm text-brand-600 underline">
            查看完整看板
          </Link>
        }
      />
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cells.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-lg border border-slate-100 bg-slate-50/60 p-4 transition hover:border-brand-200 hover:bg-brand-50/40"
          >
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-slate-800">{c.value}</p>
            {c.hint && <p className="mt-0.5 text-xs text-slate-400">{c.hint}</p>}
          </Link>
        ))}
      </div>
    </Card>
  );
}
