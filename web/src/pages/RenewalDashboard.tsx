import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarRange, Download, RefreshCw, TrendingUp, Upload } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import TeacherViewEnhanced from '../components/renewal/TeacherViewEnhanced';
import GroupViewEnhanced from '../components/renewal/GroupViewEnhanced';
import ManagerViewEnhanced from '../components/renewal/ManagerViewEnhanced';
import FunnelViewEnhanced from '../components/renewal/FunnelViewEnhanced';
import RiskViewEnhanced from '../components/renewal/RiskViewEnhanced';
import RenewalOverviewKpis from '../components/renewal/RenewalOverviewKpis';
import RenewalComparison from '../components/renewal/RenewalComparison';
import { downloadCsv } from '../lib/exportCsv';
import { cn } from '../lib/utils';
import {
  buildRenewalOverview,
  gridLegend,
  type FunnelRow,
  type GroupGradeMatrix,
  type GroupSummaryRow,
  type ManagerPerfRow,
  type MentorMatrix,
  type RateOverview,
  type ReportSummary,
  type RiskStudentRow,
  type TeacherGradeMatrix,
  type TeacherStatRow,
} from '../lib/renewal';

type View = 'teacher' | 'group' | 'manager' | 'funnel' | 'risk';
type Section = 'teacher' | 'group' | 'manager' | 'funnel' | 'risk' | 'status' | 'matrices';

const VIEWS: { key: View; label: string }[] = [
  { key: 'teacher', label: '教师统计' },
  { key: 'group', label: '科组对比' },
  { key: 'manager', label: '学管业绩' },
  { key: 'funnel', label: '课消与续费' },
  { key: 'risk', label: '待关注学生' },
];
const SECTION_LABEL: Record<Section, string> = {
  teacher: '教师统计',
  group: '科组对比',
  manager: '学管业绩',
  funnel: '课消与续费',
  risk: '风险清单',
  status: '学生状态汇总',
  matrices: '学管与年级矩阵',
};
const ALL_SECTIONS = Object.keys(SECTION_LABEL) as Section[];
const VIEW_SECTION: Record<View, Section> = {
  teacher: 'teacher',
  group: 'group',
  manager: 'manager',
  funnel: 'funnel',
  risk: 'risk',
};

function responseRows<T>(response: unknown): T[] {
  const rows = (response as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) throw new Error('接口响应缺少 rows 数组');
  return rows as T[];
}

function messageOf(error: unknown, label: string): string {
  return error instanceof Error && error.message ? error.message : `${label}加载失败`;
}

function SectionFailure({ label, message, onRetry }: { label: string; message: string; onRetry: () => void }) {
  return (
    <Card className="p-8 text-center" role="alert">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
      <h2 className="text-base font-semibold text-slate-700">{label}加载失败</h2>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <p className="mt-1 text-xs text-slate-400">空响应与请求失败分开处理；可单独重试本模块</p>
      <Button className="mt-4" variant="outline" onClick={onRetry}>重试{label}</Button>
    </Card>
  );
}

export default function RenewalDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportId, setReportId] = useState<number | null>(null);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>('teacher');
  const [tab, setTab] = useState('stage');
  const [showComparison, setShowComparison] = useState(false);

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [loadedSections, setLoadedSections] = useState<Set<Section>>(new Set());
  const [pendingSections, setPendingSections] = useState<Set<Section>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});
  const requestRefs = useRef<Record<Section, number>>({ teacher: 0, group: 0, manager: 0, funnel: 0, risk: 0, status: 0, matrices: 0 });
  const reportsRequestRef = useRef(0);
  const reportIdRef = useRef<number | null>(null);
  const tabRef = useRef(tab);

  const replaceReportParam = useCallback((id: number | null) => {
    const next = new URLSearchParams(searchParamsRef.current);
    if (id === null) next.delete('reportId');
    else next.set('reportId', String(id));
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);

  const resetReportData = useCallback(() => {
    for (const section of ALL_SECTIONS) requestRefs.current[section] += 1;
    setTeacherRows([]);
    setGroupRows([]);
    setManagerRows([]);
    setFunnelRows([]);
    setRiskRows([]);
    setStatusRows([]);
    setMentorMatrix(null);
    setTeacherGradeMatrix(null);
    setGroupGradeMatrix(null);
    setRateOverview(null);
    setExpanded(new Set());
    setLoadedSections(new Set());
    setPendingSections(new Set());
    setErrors({});
  }, []);

  const loadReports = useCallback(async (): Promise<number | null> => {
    const requestId = ++reportsRequestRef.current;
    setReportsLoading(true);
    setReportsError(null);
    try {
      const response = await api.get('/renewal/reports') as { reports?: unknown };
      if (!Array.isArray(response.reports)) throw new Error('接口响应缺少 reports 数组');
      const available = (response.reports as ReportSummary[]).filter(
        report => report.status === 'committed' || report.status === 'committed_with_warnings',
      );
      if (requestId !== reportsRequestRef.current) return reportIdRef.current;

      const requestedRaw = searchParamsRef.current.get('reportId');
      const requestedId = requestedRaw === null ? null : Number(requestedRaw);
      const requestedIsValid = requestedId !== null
        && Number.isInteger(requestedId)
        && requestedId > 0
        && available.some(report => report.reportId === requestedId);
      const current = reportIdRef.current;
      const selected = current !== null && available.some(report => report.reportId === current)
        ? current
        : requestedIsValid
          ? requestedId
          : available[0]?.reportId ?? null;

      if (selected !== current) resetReportData();
      setReports(available);
      setReportsLoaded(true);
      reportIdRef.current = selected;
      setReportId(selected);
      if (requestedRaw !== null && !requestedIsValid && current === null) replaceReportParam(selected);
      return selected;
    } catch (error) {
      if (requestId === reportsRequestRef.current) setReportsError(messageOf(error, '报表列表'));
      return reportIdRef.current;
    } finally {
      if (requestId === reportsRequestRef.current) setReportsLoading(false);
    }
  }, [replaceReportParam, resetReportData]);

  const loadSection = useCallback(async (section: Section, id: number, currentTab: string) => {
    const requestId = ++requestRefs.current[section];
    setPendingSections(previous => new Set(previous).add(section));
    setErrors(previous => {
      const next = { ...previous };
      delete next[section];
      return next;
    });
    const isCurrent = () => requestId === requestRefs.current[section]
      && reportIdRef.current === id
      && (!(section === 'teacher' || section === 'group' || section === 'matrices') || tabRef.current === currentTab);

    try {
      if (section === 'matrices') {
        const [mentor, teacherGrade, groupGrade, rate] = await Promise.all([
          api.get(`/renewal/analytics/mentor-matrix?reportId=${id}`),
          api.get(`/renewal/analytics/teacher-grade-matrix?reportId=${id}`),
          api.get(`/renewal/analytics/group-grade-matrix?reportId=${id}`),
          api.get(`/renewal/analytics/rate-overview?reportId=${id}`),
        ]);
        if (!isCurrent()) return;
        setMentorMatrix((mentor as { matrix?: MentorMatrix | null }).matrix ?? null);
        setTeacherGradeMatrix((teacherGrade as { matrix?: TeacherGradeMatrix | null }).matrix ?? null);
        setGroupGradeMatrix((groupGrade as { matrix?: GroupGradeMatrix | null }).matrix ?? null);
        setRateOverview((rate as { overview?: RateOverview | null }).overview ?? null);
      } else {
        let response: unknown;
        if (section === 'teacher') response = await api.get(`/renewal/dashboard/teacher-stats?tab=${currentTab}&reportId=${id}`);
        else if (section === 'group') response = await api.get(`/renewal/analytics/group-compare?tab=${currentTab}&reportId=${id}`);
        else if (section === 'manager') response = await api.get(`/renewal/analytics/manager-perf?reportId=${id}`);
        else if (section === 'funnel') response = await api.get(`/renewal/analytics/funnel?reportId=${id}`);
        else if (section === 'risk') {
          const first = await api.get(`/renewal/analytics/risk-list?page=1&pageSize=200&reportId=${id}`) as { rows?: RiskStudentRow[]; total?: number; totalPages?: number };
          const allRows = [...(first.rows || [])];
          const totalPages = Math.max(1, first.totalPages ?? 1);
          for (let page = 2; page <= totalPages; page += 1) {
            if (!isCurrent()) return;
            const next = await api.get(`/renewal/analytics/risk-list?page=${page}&pageSize=200&reportId=${id}`) as { rows?: RiskStudentRow[] };
            allRows.push(...(next.rows || []));
          }
          if (first.total !== undefined && allRows.length !== first.total) {
            throw new Error(`待关注学生加载不完整：应有 ${first.total} 条，实际 ${allRows.length} 条`);
          }
          response = { ...first, rows: allRows };
        } else response = await api.get(`/renewal/analytics/student-status?reportId=${id}`);
        const rows = responseRows<unknown>(response);
        if (!isCurrent()) return;
        if (section === 'teacher') setTeacherRows(rows as TeacherStatRow[]);
        else if (section === 'group') setGroupRows(rows as GroupSummaryRow[]);
        else if (section === 'manager') setManagerRows(rows as ManagerPerfRow[]);
        else if (section === 'funnel') setFunnelRows(rows as FunnelRow[]);
        else if (section === 'risk') setRiskRows(rows as RiskStudentRow[]);
        else setStatusRows(rows as { status: string; count: number }[]);
      }
      setLoadedSections(previous => new Set(previous).add(section));
    } catch (error) {
      if (isCurrent()) setErrors(previous => ({ ...previous, [section]: messageOf(error, SECTION_LABEL[section]) }));
    } finally {
      if (requestId === requestRefs.current[section]) {
        setPendingSections(previous => {
          const next = new Set(previous);
          next.delete(section);
          return next;
        });
      }
    }
  }, []);

  const loadAll = useCallback(async (id: number, currentTab: string) => {
    const sections: Section[] = ['teacher', 'group', 'manager', 'funnel', 'status'];
    if (currentTab === 'mentor') sections.push('matrices');
    await Promise.all(sections.map(section => loadSection(section, id, currentTab)));
  }, [loadSection]);

  useEffect(() => {
    void loadReports();
    return () => { reportsRequestRef.current += 1; };
  }, [loadReports]);

  useEffect(() => {
    if (reportId === null) return;
    void loadAll(reportId, tab);
    return () => {
      for (const section of ALL_SECTIONS) requestRefs.current[section] += 1;
    };
  }, [loadAll, reportId, tab]);

  useEffect(() => {
    if (reportId === null || view !== 'risk') return;
    if (loadedSections.has('risk') || pendingSections.has('risk') || errors.risk) return;
    void loadSection('risk', reportId, tabRef.current);
  }, [errors.risk, loadSection, loadedSections, pendingSections, reportId, view]);

  const selectReport = (id: number) => {
    resetReportData();
    reportIdRef.current = id;
    setReportId(id);
    replaceReportParam(id);
  };

  const selectTab = (nextTab: string) => {
    tabRef.current = nextTab;
    setTab(nextTab);
  };

  const refresh = async () => {
    setRefreshing(true);
    const selected = await loadReports();
    const target = selected ?? reportIdRef.current;
    if (target !== null) {
      const requests = [loadAll(target, tabRef.current)];
      if (view === 'risk') requests.push(loadSection('risk', target, tabRef.current));
      await Promise.all(requests);
    }
    setRefreshing(false);
  };

  const retry = (section: Section) => {
    const id = reportIdRef.current;
    if (id !== null) void loadSection(section, id, tabRef.current);
  };

  const toggleTeacher = (name: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const overview = useMemo(() => buildRenewalOverview(teacherRows), [teacherRows]);
  const currentReport = reports.find(report => report.reportId === reportId);
  const currentSection = VIEW_SECTION[view];
  const currentLoaded = loadedSections.has(currentSection);
  const currentError = errors[currentSection];
  const currentPending = pendingSections.has(currentSection);
  const backgroundErrors = (Object.entries(errors) as [Section, string][]).filter(
    ([section]) => section !== currentSection || currentLoaded,
  );

  const exportCurrentView = () => {
    if (!currentReport) return;
    const prefix = `续费-${currentReport.centerName || '学习中心'}-${currentReport.statMonth || '未识别月份'}-${VIEWS.find(item => item.key === view)?.label}`;
    if (view === 'teacher') {
      downloadCsv(`${prefix}-${tab}`, [
        { label: '教师', value: row => row.teacherName }, { label: '工号', value: row => row.teacherNo },
        { label: '科组', value: row => row.subjectGroup }, { label: '学生基数', value: row => row.baseCount },
        { label: '总预存', value: row => row.prepaidCount }, { label: '非毕业班预存', value: row => row.extra?.prepaid_nongrad },
        { label: '已续科', value: row => row.renewedCount }, { label: '80%目标差额', value: row => row.incentiveGap },
        { label: '学生网格人数', value: row => row.studentCount },
      ], teacherRows);
    } else if (view === 'group') {
      downloadCsv(prefix, [
        { label: '科组', value: row => row.subjectGroup }, { label: '教师数', value: row => row.teacherCount },
        { label: '学生基数', value: row => row.baseCount }, { label: '总预存', value: row => row.prepaidCount },
        { label: '预存率（%）', value: row => row.prepaidRate }, { label: '已续科', value: row => row.renewedCount },
        { label: '续科率（%）', value: row => row.renewRate }, { label: '80%目标差额', value: row => row.incentiveGap },
      ], groupRows);
    } else if (view === 'manager') {
      downloadCsv(prefix, [
        { label: '学管', value: row => row.managerName },
        { label: '续费-一对一', value: row => row.renew.one2one },
        { label: '续费-一对多', value: row => row.renew.one2many },
        { label: '续费-小班', value: row => row.renew.small },
        { label: '续费-其他', value: row => row.renew.other },
        { label: '续费合计', value: row => row.renew.total },
        { label: '新签-一对一', value: row => row.newsign.one2one },
        { label: '新签-一对多', value: row => row.newsign.one2many },
        { label: '新签-小班', value: row => row.newsign.small },
        { label: '新签-其他', value: row => row.newsign.other },
        { label: '新签合计', value: row => row.newsign.total },
        { label: '现金流-一对一', value: row => row.productCashflow?.one2one },
        { label: '现金流-一对多', value: row => row.productCashflow?.one2many },
        { label: '现金流-小班', value: row => row.productCashflow?.small },
        { label: '现金流-其他', value: row => row.productCashflow?.other },
        { label: '现金流目标-一对一', value: row => row.productTargets?.one2one },
        { label: '现金流目标-一对多', value: row => row.productTargets?.one2many },
        { label: '现金流目标-小班', value: row => row.productTargets?.small },
        { label: '现金流目标-其他', value: row => row.productTargets?.other },
        { label: 'Excel任务金额', value: row => row.importedTaskAmount ?? row.taskAmount },
        { label: '有效任务金额', value: row => row.taskAmount },
        { label: '现金流合计', value: row => row.cashflowTotal },
        { label: '完成率（%）', value: row => row.completionRate },
        { label: '实际带生数', value: row => row.actualStudents },
        { label: '已续科人数', value: row => row.renewedCount },
      ], managerRows);
    } else if (view === 'funnel') {
      downloadCsv(prefix, [
        { label: '学管', value: row => row.managerName }, { label: '学生数', value: row => row.students },
        { label: '上2个月有课消', value: row => row.classedLast2 }, { label: '上1个月有课消', value: row => row.classedLast1 },
        { label: '本月已续费', value: row => row.renewed }, { label: '续费率（%）', value: row => row.renewRate },
      ], funnelRows);
    } else {
      downloadCsv(prefix, [
        { label: '学生ID', value: row => row.studentId }, { label: '学生', value: row => row.studentName },
        { label: '学管', value: row => row.managerName }, { label: '年级', value: row => row.grade },
        { label: '课程', value: row => row.courseProduct }, { label: '在读天数', value: row => row.enrollDays },
        { label: '上2个月课消', value: row => row.classLast2 }, { label: '上1个月课消', value: row => row.classLast1 },
      ], riskRows);
    }
  };

  if (reportsLoaded && reports.length === 0 && !reportsError) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-800">续费看板</h1>
        <Card>
          <EmptyState
            icon={<TrendingUp className="h-7 w-7" />}
            title="还没有可展示的报表"
            description="上传续费统计汇总表后，已提交批次会显示在这里。"
            action={<Link to="/renewal/upload"><Button icon={<Upload className="h-4 w-4" />}>上传统计表</Button></Link>}
          />
        </Card>
      </div>
    );
  }

  const renderCurrentView = () => {
    if (currentError && !currentLoaded) {
      return <SectionFailure label={SECTION_LABEL[currentSection]} message={currentError} onRetry={() => retry(currentSection)} />;
    }
    if (!currentLoaded) {
      return <div className="py-16 text-center text-sm text-slate-400">{currentPending ? '加载中…' : '等待报表数据…'}</div>;
    }
    if (view === 'teacher') {
      return <TeacherViewEnhanced
        rows={teacherRows}
        tab={tab}
        setTab={selectTab}
        expanded={expanded}
        toggleTeacher={toggleTeacher}
        mentorMatrix={mentorMatrix ?? undefined}
        teacherGradeMatrix={teacherGradeMatrix ?? undefined}
        groupGradeMatrix={groupGradeMatrix ?? undefined}
        rateOverview={rateOverview ?? undefined}
        matrixLoading={pendingSections.has('matrices')}
      />;
    }
    if (view === 'group') return <GroupViewEnhanced rows={groupRows} tab={tab} setTab={selectTab} />;
    if (view === 'manager') return reportId === null ? null : <ManagerViewEnhanced
      rows={managerRows}
      reportId={reportId}
      onSaved={(rows: ManagerPerfRow[]) => setManagerRows(rows)}
    />;
    if (view === 'funnel') return <FunnelViewEnhanced rows={funnelRows} />;
    return reportId === null ? null : <RiskViewEnhanced key={reportId} rows={riskRows} reportId={reportId} />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">续费看板</h1>
          <p className="mt-1 text-sm text-slate-500">默认学段口径；总览、榜单与明细使用同一统计表数据</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={reportId ?? ''}
            onChange={event => selectReport(Number(event.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none"
            aria-label="选择报表批次"
          >
            {reportId === null && <option value="">请选择报表</option>}
            {reports.map(report => (
              <option key={report.reportId} value={report.reportId}>
                {(report.centerName || report.fileName) + ' · ' + (report.statMonth || '未识别月份')}
              </option>
            ))}
          </select>
          {(view === 'teacher' || view === 'group') && <Button variant={showComparison ? 'secondary' : 'outline'} size="md" icon={<CalendarRange className="h-4 w-4" />} onClick={() => setShowComparison(value => !value)}>多期对比</Button>}
          <Button variant="outline" size="md" disabled={!currentLoaded || !currentReport} icon={<Download className="h-4 w-4" />} onClick={exportCurrentView}>导出当前视图</Button>
          <Button variant="outline" size="md" disabled={refreshing} icon={<RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />} onClick={() => void refresh()}>刷新</Button>
        </div>
      </div>

      {currentReport?.status === 'committed_with_warnings' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          本批次已提交，但包含警告；看板展示已提交数据。
        </div>
      )}
      {reportsError && (
        <SectionFailure label="报表列表" message={reportsError} onRetry={() => void loadReports()} />
      )}
      {reportId === null && !reportsError && (
        <div className="py-16 text-center text-sm text-slate-400">{reportsLoading ? '加载报表列表…' : '暂无可展示批次'}</div>
      )}

      {reportId !== null && (
        <>
          {(view === 'teacher' || view === 'group') && loadedSections.has('teacher') && (
            <RenewalOverviewKpis tab={tab} overview={overview} />
          )}
          {showComparison && (view === 'teacher' || view === 'group') && (
            <RenewalComparison reports={reports} currentReportId={reportId} tab={tab} />
          )}

          <div role="tablist" aria-label="看板视图" className="flex flex-wrap gap-1.5">
            {VIEWS.map(item => (
              <button
                key={item.key}
                role="tab"
                aria-selected={view === item.key}
                onClick={() => setView(item.key)}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                  view === item.key ? 'bg-brand-600 text-white shadow-soft' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500" role="group" aria-label="学生状态图例">
            {gridLegend().map(item => (
              <span key={item.status} className="group flex items-center gap-1.5" title={item.label}>
                <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-slate-200" style={{ backgroundColor: item.hex }} aria-hidden="true" />
                <span>{item.label}</span>
              </span>
            ))}
          </div>

          {backgroundErrors.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
              <p className="text-sm font-medium text-amber-800">部分数据更新失败，页面保留各模块上次成功数据</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {backgroundErrors.map(([section, message]) => (
                  <Button key={section} size="sm" variant="outline" onClick={() => retry(section)} title={message}>
                    重试{SECTION_LABEL[section]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {currentLoaded && currentPending && <p className="text-xs text-slate-400" role="status">正在刷新，当前显示上次成功数据…</p>}
          {renderCurrentView()}
        </>
      )}
    </div>
  );
}
