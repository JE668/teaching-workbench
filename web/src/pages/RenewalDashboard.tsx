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
  type MentorMatrix,
  type ReportSummary,
  type RiskStudentRow,
  type TeacherStatRow,
  type TeacherGradeMatrix,
  type GroupGradeMatrix,
  type RateOverview,
} from '../lib/renewal';


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
  const [, setStatusRows] = useState<{ status: string; count: number }[]>([]);
  const [mentorMatrix, setMentorMatrix] = useState<MentorMatrix | null>(null);
  const [teacherGradeMatrix, setTeacherGradeMatrix] = useState<TeacherGradeMatrix | null>(null);
  const [groupGradeMatrix, setGroupGradeMatrix] = useState<GroupGradeMatrix | null>(null);
  const [rateOverview, setRateOverview] = useState<RateOverview | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
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
      // 学管矩阵 + 年级矩阵 + 科组年级矩阵 + Rate Overview（仅 mentor tab）
      if (tab === 'mentor') {
        setMatrixLoading(true);
        setMentorMatrix(null);
        setTeacherGradeMatrix(null);
        setGroupGradeMatrix(null);
        setRateOverview(null);
        const fetchWithError = async (url: string, label: string) => {
          try {
            return await api.get(url);
          } catch (err) {
            if (!cancelled) toast.error(err instanceof Error ? err.message : label + ' 加载失败');
            return null;
          }
        };
        const [mentorRes, gradeRes, groupRes, rateRes] = await Promise.all([
          fetchWithError('/renewal/analytics/mentor-matrix?reportId=' + reportId, '学管矩阵'),
          fetchWithError('/renewal/analytics/teacher-grade-matrix?reportId=' + reportId, '教师年级矩阵'),
          fetchWithError('/renewal/analytics/group-grade-matrix?reportId=' + reportId, '科组年级矩阵'),
          fetchWithError('/renewal/analytics/rate-overview?reportId=' + reportId, '续费概览'),
        ]);
        if (!cancelled) {
          setMatrixLoading(false);
          if (mentorRes) setMentorMatrix((mentorRes as any).matrix as MentorMatrix);
          if (gradeRes) setTeacherGradeMatrix((gradeRes as any).matrix as TeacherGradeMatrix);
          if (groupRes) setGroupGradeMatrix((groupRes as any).matrix as GroupGradeMatrix);
          if (rateRes) setRateOverview((rateRes as any).overview as RateOverview);
        }
      } else if (!cancelled) {
        setMatrixLoading(false);
        setMentorMatrix(null);
        setTeacherGradeMatrix(null);
        setGroupGradeMatrix(null);
        setRateOverview(null);
      }
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

  const fetchMentorMatrix = useCallback(async (id: number): Promise<MentorMatrix> => {
    const res = await api.get('/renewal/analytics/mentor-matrix?reportId=' + id);
    const matrix = (res as any)?.matrix as MentorMatrix;
    setMentorMatrix(matrix);
    return matrix;
  }, []);

  const fetchTeacherGradeMatrix = useCallback(async (id: number): Promise<TeacherGradeMatrix> => {
    const res = await api.get('/renewal/analytics/teacher-grade-matrix?reportId=' + id);
    const matrix = (res as any)?.matrix as TeacherGradeMatrix;
    setTeacherGradeMatrix(matrix);
    return matrix;
  }, []);

  const fetchGroupGradeMatrix = useCallback(async (id: number): Promise<GroupGradeMatrix> => {
    const res = await api.get('/renewal/analytics/group-grade-matrix?reportId=' + id);
    const matrix = (res as any)?.matrix as GroupGradeMatrix;
    setGroupGradeMatrix(matrix);
    return matrix;
  }, []);

  const fetchRateOverview = useCallback(async (id: number): Promise<RateOverview> => {
    const res = await api.get('/renewal/analytics/rate-overview?reportId=' + id);
    const overview = (res as any)?.overview as RateOverview;
    setRateOverview(overview);
    return overview;
  }, []);

  useEffect(() => { loadRest(); }, [loadRest]);

  /** 仅汇总教师明细；保留“无此列”和真实 0 的区别。 */
  const totals = useMemo(() => {
    let base = 0, renewed = 0, gap = 0, prepaid = 0;
    let hasBase = false, hasRenewed = false, hasGap = false, hasPrepaid = false;
    for (const r of teacherRows) {
      if (typeof r.baseCount === 'number') { base += r.baseCount; hasBase = true; }
      if (typeof r.renewedCount === 'number') { renewed += r.renewedCount; hasRenewed = true; }
      if (typeof r.prepaidCount === 'number') { prepaid += r.prepaidCount; hasPrepaid = true; }
      if (typeof r.incentiveGap === 'number') { gap += r.incentiveGap; hasGap = true; }
    }
    return {
      base, renewed, prepaid, gap,
      rate: base > 0 ? (renewed / base) * 100 : 0,
      hasBase, hasRenewed, hasGap, hasPrepaid,
      hasData: hasBase || hasRenewed || hasGap || hasPrepaid,
    };
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">续费看板</h1>
          <p className="mt-1 text-sm text-slate-500">续费进度、学管匹配与学生状态，统一按 Excel 教师明细口径呈现</p>
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

      {teacherRows.length > 0 && managerRows.length > 0 && (
        <ExecutiveSummary
          teacherRows={teacherRows}
          managerRows={managerRows}
          reportId={reportId}
          reports={reports}
          currentTab={tab}
        />
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="学生基数"
          value={totals.hasBase ? count(totals.base) : NOT_AVAILABLE_YET}
          tone="brand"
          icon={<Users className="h-4 w-4" />}
          hint={totals.hasBase ? teacherRows.length + ' 位教师明细合计' : '当前表未提供该列'}
        />
        <KpiCard
          label="已续科"
          value={totals.hasRenewed ? count(totals.renewed) : '—'}
          tone="emerald"
          icon={<TrendingUp className="h-4 w-4" />}
          progress={totals.hasRenewed && totals.base > 0 ? clampRatio(totals.renewed, totals.base) : undefined}
          hint={totals.hasRenewed ? pct(totals.rate) + ' 整体续科率' : '当前表未提供该列'}
        />
        <KpiCard
          label="已预存（总）"
          value={totals.hasPrepaid ? count(totals.prepaid) : '—'}
          tone="violet"
          icon={<Target className="h-4 w-4" />}
          progress={totals.hasPrepaid && totals.base > 0 ? clampRatio(totals.prepaid, totals.base) : undefined}
          hint={totals.hasPrepaid ? '含全部学段，不是单项预存' : '当前表未提供该列'}
        />
        <KpiCard
          label="距80%目标差额"
          value={totals.hasGap ? count(totals.gap) : '—'}
          tone="amber"
          icon={<AlertTriangle className="h-4 w-4" />}
          hint={totals.hasGap ? '正值 = 距目标还差人数' : '当前表未提供该列'}
        />
      </div>

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

      <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500" role="group" aria-label="学生状态图例" style={{ '--legend-gap': '8px' } as React.CSSProperties}>
        {gridLegend().map(g => (
          <span key={g.status} className="flex items-center gap-1.5 group" title={g.label}>
            <span className="w-2.5 h-2.5 rounded-sm ring-1 ring-slate-200 transition-transform group-hover:scale-110" style={{ backgroundColor: g.hex }} aria-hidden="true" />
            <span>{g.label}</span>
          </span>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
      ) : view === 'teacher' ? <TeacherViewEnhanced
          rows={teacherRows}
          tab={tab}
          setTab={setTab}
          expanded={expanded}
          toggleTeacher={toggleTeacher}
          mentorMatrix={mentorMatrix ?? undefined}
          teacherGradeMatrix={teacherGradeMatrix ?? undefined}
          groupGradeMatrix={groupGradeMatrix ?? undefined}
          rateOverview={rateOverview ?? undefined}
          reportId={reportId ?? undefined}
          fetchMentorMatrix={fetchMentorMatrix}
          fetchTeacherGradeMatrix={fetchTeacherGradeMatrix}
          fetchGroupGradeMatrix={fetchGroupGradeMatrix}
          fetchRateOverview={fetchRateOverview}
          matrixLoading={matrixLoading}
        />
        : view === 'group' ? <GroupViewEnhanced rows={groupRows} tab={tab} setTab={setTab} />
        : view === 'manager' ? <ManagerViewEnhanced rows={managerRows} />
        : view === 'funnel' ? <FunnelViewEnhanced stages={funnelStages} managerRows={funnelManagerRows} />
        : <RiskViewEnhanced students={riskStudents} />}
    </div>
  );
}
