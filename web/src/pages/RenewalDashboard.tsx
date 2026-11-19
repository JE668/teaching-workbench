import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Upload,
  RefreshCw,
  AlertTriangle,
  Users,
  Target,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import KpiCard from '../components/renewal/KpiCard';
import { cn } from '../lib/utils';
import TeacherViewEnhanced from '../components/renewal/TeacherViewEnhanced';
import GroupViewEnhanced from '../components/renewal/GroupViewEnhanced';
import ManagerViewEnhanced from '../components/renewal/ManagerViewEnhanced';
import FunnelViewEnhanced from '../components/renewal/FunnelViewEnhanced';
import RiskViewEnhanced from '../components/renewal/RiskViewEnhanced';
import ExecutiveSummary from '../components/renewal/ExecutiveSummary';
import {
  clampRatio,
  count,
  gridLegend,
  NOT_AVAILABLE_YET,
  pct,
  type FunnelRow,
  type GroupSummaryRow,
  type ManagerPerfRow,
  type ReportSummary,
  type RiskStudentRow,
  type TeacherStatRow,
} from '../lib/renewal';

/**
 * 续费看板。
 *
 * 数据全部来自用户上传的那一份续费统计表，后端只读不重算。
 * 五个视图对应 Excel 里已经做好的四张表 + 我从明细里能补出来的两张图：
 *   教师统计（激励/学段/学管/课时 4 个 tab，同一页面切换）
 *   科组对比 · 学管业绩 · 续生漏斗 · 风险清单
 */
type View = 'teacher' | 'group' | 'manager' | 'funnel' | 'risk';

const VIEWS: { key: View; label: string }[] = [
  { key: 'teacher', label: '教师统计' },
  { key: 'group', label: '科组对比' },
  { key: 'manager', label: '学管业绩' },
  { key: 'funnel', label: '续生漏斗' },
  { key: 'risk', label: '风险清单' },
];

export default function RenewalDashboard() {
  const toast = useToast();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportId, setReportId] = useState<number | null>(null);
  const [view, setView] = useState<View>('teacher');
  const [tab, setTab] = useState<string>('incentive');
  const [loading, setLoading] = useState(true);
  const [teacherRows, setTeacherRows] = useState<TeacherStatRow[]>([]);
  const [groupRows, setGroupRows] = useState<GroupSummaryRow[]>([]);
  const [managerRows, setManagerRows] = useState<ManagerPerfRow[]>([]);
  const [funnelRows, setFunnelRows] = useState<FunnelRow[]>([]);
  const [riskRows, setRiskRows] = useState<RiskStudentRow[]>([]);
  const [statusRows, setStatusRows] = useState<{ status: string; count: number }[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function loadReports() {
    try {
      const res = await api.get('/renewal/reports') as { reports: ReportSummary[] };
      setReports(res.reports || []);
      // 默认展示最新一份；切换由头部下拉框完成
      setReportId(res.reports && res.reports[0] ? res.reports[0].reportId : null);
    } catch {
      toast.error('加载报表列表失败');
    }
  }

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 教师统计 + 科组对比随 tab 变化；其余不依赖 tab
  useEffect(() => {
    if (!reportId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get('/renewal/dashboard/teacher-stats?tab=' + tab + '&reportId=' + reportId);
        if (!cancelled) setTeacherRows(((res as any).rows as TeacherStatRow[]) || []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '加载教师统计失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        const res = await api.get('/renewal/analytics/group-compare?tab=' + tab + '&reportId=' + reportId);
        if (!cancelled) setGroupRows(((res as any).rows as GroupSummaryRow[]) || []);
      } catch { /* 科组取数失败不影响主表 */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, tab]);

  const loadRest = useCallback(async () => {
    if (!reportId) return;
    const [mgr, funnel, risk, status] = await Promise.all([
      api.get('/renewal/analytics/manager-perf?reportId=' + reportId).catch(() => null),
      api.get('/renewal/analytics/funnel?reportId=' + reportId).catch(() => null),
      api.get('/renewal/analytics/risk-list?limit=500&reportId=' + reportId).catch(() => null),
      api.get('/renewal/analytics/student-status?reportId=' + reportId).catch(() => null),
    ]);
    setManagerRows(((mgr as any)?.rows as ManagerPerfRow[]) || []);
    setFunnelRows(((funnel as any)?.rows as FunnelRow[]) || []);
    setRiskRows(((risk as any)?.rows as RiskStudentRow[]) || []);
    setStatusRows(((status as any)?.rows as { status: string; count: number }[]) || []);
  }, [reportId]);

  useEffect(() => { loadRest(); }, [loadRest]);

  /** 汇总卡：当前 tab 下全体教师的基数/续科/续科率/激励差额 */
  const totals = useMemo(() => {
    if (teacherRows.length === 0) {
      return { base: 0, renewed: 0, prepaid: 0, gap: 0, rate: 0, hasData: false };
    }
    let base = 0, renewed = 0, gap = 0, prepaid = 0;
    for (const r of teacherRows) {
      base += r.baseCount || 0;
      renewed += r.renewedCount || 0;
      prepaid += r.prepaidCount || 0;
      gap += r.incentiveGap || 0;
    }
    return { base, renewed, prepaid, gap, rate: base > 0 ? (renewed / base) * 100 : 0, hasData: true };
  }, [teacherRows]);

  const funnelStages = useMemo(() => {
    if (funnelRows.length === 0) return [];
    const sum = (pick: (r: FunnelRow) => number) => funnelRows.reduce((s, r) => s + (pick(r) || 0), 0);
    const students = sum(r => r.students);
    const last2 = sum(r => r.classedLast2);
    const last1 = sum(r => r.classedLast1);
    const renewed = sum(r => r.renewed);
    return [
      { name: '学生总数', value: students },
      { name: '上2个月有课消', value: last2 },
      { name: '上1个月有课消', value: last1 },
      { name: '本月已续费', value: renewed },
    ];
  }, [funnelRows]);

  // 为 FunnelViewEnhanced 准备学管分解数据
  const funnelManagerRows = useMemo(() => {
    if (funnelRows.length === 0) return [];
    return funnelRows.map(r => ({
      manager: r.managerName,
      students: r.students,
      renewed: r.renewed,
      rate: r.renewRate || 0,
    }));
  }, [funnelRows]);

  // 为 RiskViewEnhanced 转换数据
  const riskStudents = useMemo(() => {
    if (riskRows.length === 0) return [];
    return riskRows.map(r => ({
      ...r,
      teacherName: null,
      subjectGroup: null,
      riskLevel: 'low' as 'low' | 'medium' | 'high',
      riskCount: 1,
      status: 'normal' as 'renewed' | 'prepaid' | 'dropped' | 'graduating' | 'normal',
      prepaid: false,
      renewed: false,
      remainingHours: null,
      riskReasons: r.type ? [r.type] : [],
    }));
  }, [riskRows]);

  function toggleTeacher(name: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!loading && reports.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-800">续费看板</h1>
        <Card>
          <EmptyState
            icon={<TrendingUp className="h-7 w-7" />}
            title="还没有可展示的报表"
            description="上传你做好的续费统计汇总表，看板会自动出图。"
            action={<Link to="/renewal/upload"><Button icon={<Upload className="h-4 w-4" />}>上传统计表</Button></Link>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部：标题 + 报表选择 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">续费看板</h1>
          <p className="mt-1 text-sm text-slate-400">
            数据来自你上传的汇总表，指标直接读取、不做二次换算。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={reportId ?? ''}
            onChange={(e) => setReportId(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none"
            aria-label="选择报表批次"
          >
            {reports.map((r) => (
              <option key={r.reportId} value={r.reportId}>
                {(r.centerName || r.fileName) + ' · ' + (r.statMonth || '未识别月份')}
              </option>
            ))}
          </select>
          <Button variant="outline" size="md" icon={<RefreshCw className="h-4 w-4" />} onClick={async () => { await loadReports(); loadRest(); }}>刷新</Button>
        </div>
      </div>

      {/* 执行摘要 */}
      {teacherRows.length > 0 && managerRows.length > 0 && (
        <ExecutiveSummary
          teacherRows={teacherRows}
          managerRows={managerRows}
          reportId={reportId}
          reports={reports}
          currentTab={tab}
        />
      )}

      {/* 汇总卡 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="学生基数"
          value={totals.hasData ? count(totals.base) : NOT_AVAILABLE_YET}
          tone="brand"
          icon={<Users className="h-4 w-4" />}
          hint={totals.hasData ? '当前 tab 合计' : '数据下月开启'}
        />
        <KpiCard
          label="已续科"
          value={totals.hasData ? count(totals.renewed) : NOT_AVAILABLE_YET}
          tone="emerald"
          icon={<TrendingUp className="h-4 w-4" />}
          progress={totals.hasData ? clampRatio(totals.renewed, totals.base) : undefined}
          hint={totals.hasData ? pct(totals.rate) + ' 续科率' : '数据下月开启'}
        />
        <KpiCard
          label="已预存"
          value={totals.hasData ? count(totals.prepaid) : NOT_AVAILABLE_YET}
          tone="violet"
          icon={<Target className="h-4 w-4" />}
          progress={totals.hasData ? clampRatio(totals.prepaid, totals.base) : undefined}
          hint={totals.hasData ? pct(totals.base > 0 ? (totals.prepaid / totals.base) * 100 : 0) + ' 预存率' : '数据下月开启'}
        />
        <KpiCard
          label="激励差额合计"
          value={totals.hasData ? count(totals.gap) : NOT_AVAILABLE_YET}
          tone="amber"
          icon={<AlertTriangle className="h-4 w-4" />}
          hint={totals.hasData ? '正值 = 还差' : '数据下月开启'}
        />
      </div>

      {/* 视图切换 */}
      <div role="tablist" aria-label="看板视图" className="flex flex-wrap gap-1.5">
        {VIEWS.map(v => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium transition-colors',
              view === v.key ? 'bg-brand-600 text-white shadow-soft' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* 图例：颜色与 Excel 条件格式一致 */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-medium">学生色块</span>
        {gridLegend().map(g => (
          <span key={g.status} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: g.hex }} />
            {g.label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
      ) : view === 'teacher' ? <TeacherViewEnhanced rows={teacherRows} tab={tab} setTab={setTab} expanded={expanded} toggleTeacher={toggleTeacher} />
        : view === 'group' ? <GroupViewEnhanced rows={groupRows} tab={tab} setTab={setTab} />
        : view === 'manager' ? <ManagerViewEnhanced rows={managerRows} />
        : view === 'funnel' ? <FunnelViewEnhanced stages={funnelStages} managerRows={funnelManagerRows} />
        : <RiskViewEnhanced students={riskStudents} />}
    </div>
  );
}
