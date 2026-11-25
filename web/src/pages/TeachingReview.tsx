import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  Eye,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { api } from '../api/client';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { endpointPresentation } from '../lib/aiEndpoints';

interface Workload {
  followups: number;
  reports: number;
  observations: number;
  lessonPlans: number;
  lessonPlansConfirmed: number;
  students: number;
  total: number;
}

interface EndpointQuality {
  endpoint: string;
  calls: number;
  successRate: number;
  retryCount: number;
  retryRate: number;
  avgLatencyMs: number | null;
}

interface Quality {
  aiCalls: number;
  aiSuccessRate: number | null;
  aiErrorCount: number;
  aiRetryCount: number;
  aiRetryRate: number | null;
  retryAttempts: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  wordTarget: { measured: number; inRange: number; rate: number | null };
  funnel: Array<{ key: string; label: string; value: number }>;
  latencyWordCount: Array<{ endpoint: string; latencyMs: number; wordCount: number }>;
  byEndpoint: EndpointQuality[];
}

interface MasterySlice {
  key: string;
  label: string;
  count: number;
  percent: number;
}

interface GrowthRow {
  category: string;
  total: number;
  solid: number;
  weak: number;
  avgMastery: number;
}

interface AttendanceStat {
  sessions: number;
  present: number;
  leave?: number;
  makeup?: number;
  unclassified?: number;
  rate: number | null;
  semantics?: string;
}

interface DailyActivity {
  day: string;
  n: number;
}

interface MonthlyKnowledgeDelta {
  category: string;
  delta: number;
  evidenceCount: number;
  semantics: string;
}

interface FollowupQuality {
  total: number;
  avgWordCount: number | null;
  structured: number;
  structuredRate: number | null;
  withImages: number;
  imageRecordRate: number | null;
  referenced: number;
  historicalReferenceRate: number | null;
  parentShared: number;
  parentRead: number;
  parentReadRate: number | null;
}

interface GroupComparison {
  groupId: number;
  groupName: string;
  studentCount: number;
  masteryStudentCount: number;
  deltaStudentCount: number;
  avgMastery: number | null;
  avgMasteryDelta: number | null;
  deltaEvidenceCount?: number;
  followupCovered: number;
  followupCoverageRate: number | null;
}

interface StudentCoverage {
  studentId: number;
  studentName: string;
  grade: string;
  subject: string;
  followups: number;
  lastFollowupAt: string | null;
  cold: boolean;
}

interface ReviewSummary {
  month: string;
  workload: Workload;
  quality: Quality;
  masteryDistribution: MasterySlice[];
  dailyActivity: DailyActivity[];
  growth: GrowthRow[];
  growthSemantics: string;
  monthlyKnowledgeDelta: MonthlyKnowledgeDelta[];
  followupQuality: FollowupQuality;
  groupComparisons: GroupComparison[];
  attendance: AttendanceStat;
  limitations: string[];
}


interface TeamTeacher {
  teacherId: number;
  username: string;
  students: number;
  followups: number;
  reports: number;
  observations: number;
  lessonPlans: number;
  aiCalls: number;
  aiSuccessRate: number | null;
}

interface TrendPoint {
  month: string;
  followups: number;
  reports: number;
  observations: number;
  aiCalls: number;
  aiSuccessRate: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  concept: '概念理解',
  skill: '技能熟练',
  method: '方法迁移',
  habit: '学习习惯',
};

type SuccessTone = 'success' | 'warning' | 'danger' | 'neutral';

function successStatus(rate: number | null): { label: string; tone: SuccessTone } {
  if (rate == null) return { label: '暂无数据', tone: 'neutral' };
  if (rate >= 95) return { label: '运行稳定', tone: 'success' };
  if (rate >= 80) return { label: '需要关注', tone: 'warning' };
  return { label: '优先排查', tone: 'danger' };
}

function formatLatency(value: number | null): string {
  return value == null ? '—' : value + ' 毫秒';
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year + '-' + month;
}

function monthTitle(month: string): string {
  const parts = month.split('-');
  if (parts.length !== 2) return month;
  return parts[0] + ' 年 ' + Number(parts[1]) + ' 月';
}

/** 横向占比条：只读展示，不需要图表库 */
function ShareBar({ percent, tone, label }: { percent: number; tone: string; label?: string }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role={label ? 'img' : undefined} aria-label={label}>
      <div className="h-full rounded-full transition-all" style={{ width: width + '%', background: tone }} />
    </div>
  );
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : value + '%';
}

/** 成功率按 0–100% 绘制；无记录的月份显示空缺，绝不当作 0%。 */
function SuccessRateTrend({ points }: { points: TrendPoint[] }) {
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  let comparison = '暂无上月数据，未计算环比';
  if (latest?.aiSuccessRate == null) {
    comparison = '本月暂无成功率数据';
  } else if (previous?.aiSuccessRate == null) {
    comparison = '上月暂无成功率数据，未计算环比';
  } else {
    const delta = Math.round((latest.aiSuccessRate - previous.aiSuccessRate) * 100) / 100;
    comparison = '较上月 ' + (delta > 0 ? '+' : '') + delta + ' 个百分点';
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">近 6 个月 AI 调用成功率趋势</p>
        <p className="text-[11px] text-slate-500">{comparison}</p>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">柱高统一按 0–100%；“—”表示该月没有可计算的成功率。</p>
      {points.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">暂无月度 AI 调用趋势</p>
      ) : (
        <div className="mt-3 grid grid-cols-6 gap-2" role="img" aria-label="近 6 个月 AI 调用成功率趋势图">
          {points.map((point) => (
            <div key={point.month} className="min-w-0 text-center" title={point.month + '：' + formatPercent(point.aiSuccessRate)}>
              <p className="h-4 text-[10px] text-slate-500">{formatPercent(point.aiSuccessRate)}</p>
              <div className="mx-auto flex h-16 w-full max-w-8 items-end rounded bg-white">
                {point.aiSuccessRate == null ? null : (
                  <div
                    className="w-full rounded bg-brand-400"
                    style={{ height: Math.max(0, Math.min(100, point.aiSuccessRate)) + '%' }}
                  />
                )}
              </div>
              <p className="mt-1 truncate text-[10px] text-slate-400">{point.month.slice(5)} 月</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 调用级延迟 × 字数散点：只画数据库里实际存在的成功调用。 */
function LatencyScatter({ points }: { points: Quality['latencyWordCount'] }) {
  if (!points.length) {
    return <p className="py-4 text-center text-sm text-slate-400">暂无可绘制的成功调用与字数记录</p>;
  }
  const width = 560;
  const height = 230;
  const left = 42;
  const right = 14;
  const top = 14;
  const bottom = 36;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxLatency = Math.max(1, ...points.map((point) => Number(point.latencyMs) || 0));
  const maxWords = Math.max(1, ...points.map((point) => Number(point.wordCount) || 0));
  return (
    <div>
      <svg viewBox={'0 0 ' + width + ' ' + height} className="h-auto w-full" role="img" aria-label="AI 调用响应耗时与字数散点图">
        <line x1={left} y1={top + chartHeight} x2={left + chartWidth} y2={top + chartHeight} stroke="#cbd5e1" />
        <line x1={left} y1={top} x2={left} y2={top + chartHeight} stroke="#cbd5e1" />
        <text x={left} y={height - 8} fontSize="11" fill="#64748b">响应耗时（毫秒）→</text>
        <text x="8" y={top + 8} fontSize="11" fill="#64748b">字数</text>
        <text x={left + chartWidth - 35} y={top + chartHeight + 18} fontSize="10" fill="#94a3b8">{maxLatency}</text>
        <text x="12" y={top + 12} fontSize="10" fill="#94a3b8">{maxWords}</text>
        {points.map((point, index) => {
          const x = left + ((Number(point.latencyMs) || 0) / maxLatency) * chartWidth;
          const y = top + chartHeight - ((Number(point.wordCount) || 0) / maxWords) * chartHeight;
          const title = endpointPresentation(point.endpoint).label + '：' + point.latencyMs + ' 毫秒，' + point.wordCount + ' 字';
          return (
            <circle key={point.endpoint + '-' + index} cx={x} cy={y} r="4" fill="#6366f1" fillOpacity="0.72">
              <title>{title}</title>
            </circle>
          );
        })}
      </svg>
      <p className="text-[11px] text-slate-400">每个点是一条成功调用；只包含有字数记录的记录，最多展示最近 200 条。</p>
    </div>
  );
}

/** 指标卡：一个数字配一个口径说明，避免读者自己猜 */
function MetricCard({
  label,
  value,
  unit,
  hint,
  icon,
}: {
  label: string;
  value: number | string;
  unit?: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="text-brand-500">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span> : null}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{hint}</p>
    </div>
  );
}

export default function TeachingReview() {
  const navigate = useNavigate();
  const { error } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [coverage, setCoverage] = useState<{ totalStudents: number; coveredStudents: number; coldCount: number; returnedCount: number; students: StudentCoverage[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [team, setTeam] = useState<TeamTeacher[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<number | null>(null);


  useEffect(() => {
    let alive = true;
    api.request<{ canViewTeam: boolean }>('/teaching-review/access')
      .then((access) => { if (alive) setIsSupervisor(access?.canViewTeam === true); })
      .catch(() => { if (alive) setIsSupervisor(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isSupervisor) return;
    let alive = true;
    setTeamError(null);
    api.request<{ teachers: TeamTeacher[] }>('/teaching-review/team?month=' + encodeURIComponent(month))
      .then((result) => { if (alive) setTeam(Array.isArray(result.teachers) ? result.teachers : []); })
      .catch((e: any) => { if (alive) { setTeam([]); setTeamError(e?.message || '全组数据加载失败'); } });
    return () => { alive = false; };
  }, [isSupervisor, month, reloadToken]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    // 月份一切换就移除旧数据，失败时也不能把上一月内容放在新月份标题下。
    setSummary(null);
    setTrend([]);
    setCoverage(null);
    (async () => {
      try {
        const encodedMonth = encodeURIComponent(month);
        const teacherQuery = selectedTeacherId ? '&teacherId=' + selectedTeacherId : '';
        const [sum, tr, students] = await Promise.all([
          api.request<ReviewSummary>('/teaching-review/summary?month=' + encodedMonth + teacherQuery),
          api.request<{ months: number; points: TrendPoint[] }>('/teaching-review/trend?months=6&endMonth=' + encodedMonth + teacherQuery),
          api.request<{ totalStudents: number; coveredStudents: number; coldCount: number; returnedCount: number; students: StudentCoverage[] }>('/teaching-review/students?month=' + encodedMonth + '&limit=20' + teacherQuery),
        ]);
        if (!alive) return;
        setSummary(sum);
        setTrend(Array.isArray(tr.points) ? tr.points : []);
        setCoverage({ ...students, students: Array.isArray(students.students) ? students.students : [] });
      } catch (e: any) {
        if (!alive) return;
        const message = e?.message || '加载教学复盘失败';
        setLoadError(message);
        error(message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, reloadToken, selectedTeacherId]);

  const maxTrend = useMemo(
    () => Math.max(1, ...trend.map((p) => Math.max(p.followups, p.reports, p.observations))),
    [trend]
  );

  const aiStatus = successStatus(summary?.quality.aiSuccessRate ?? null);
  const maxDailyActivity = Math.max(1, ...(summary?.dailyActivity || []).map((item) => item.n));
  const maxFunnel = Math.max(1, ...(summary?.quality.funnel || []).map((item) => item.value));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">教学复盘</h2>
          <p className="mt-0.5 text-sm text-slate-400">按月份回看：工作量、内容质量与有记录的知识变化</p>
        </div>
        <div className="flex items-center gap-2">
          {isSupervisor ? (
            <select
              aria-label="复盘教师"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
              value={selectedTeacherId ?? ''}
              onChange={(event) => setSelectedTeacherId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">我的复盘</option>
              {team.map((teacher) => <option key={teacher.teacherId} value={teacher.teacherId}>{teacher.username}</option>)}
            </select>
          ) : null}
          <Input type="month" value={month} onChange={(e: any) => setMonth(e.target.value)} className="w-40" />
          <Button variant="secondary" onClick={() => setMonth(currentMonth())} aria-label="回到本月">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>


      {isSupervisor ? (
        <Card>
          <CardHeader title="全组教学与 AI 调用概况" description="白名单主管可见；只列原始工作量与 AI 调用成功率，不合成主观健康分" icon={<Users className="h-5 w-5" />} />
          <CardBody>
            {teamError ? <p role="alert" className="text-sm text-red-600">{teamError}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-2">教师</th><th>学生（人）</th><th>回访（篇）</th><th>月报（份）</th><th>听评课（节）</th><th>备课（份）</th><th>AI 调用成功率</th><th>操作</th></tr></thead>
                  <tbody>{team.map((teacher) => (
                    <tr key={teacher.teacherId} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 font-medium text-slate-700">{teacher.username}</td><td>{teacher.students}</td><td>{teacher.followups}</td><td>{teacher.reports}</td><td>{teacher.observations}</td><td>{teacher.lessonPlans}</td><td><div className="flex items-center gap-2"><span>{formatPercent(teacher.aiSuccessRate)}</span><Badge tone={successStatus(teacher.aiSuccessRate).tone}>{successStatus(teacher.aiSuccessRate).label}</Badge></div></td>
                      <td><Button size="sm" variant="ghost" onClick={() => setSelectedTeacherId(teacher.teacherId)}>查看 {teacher.username}</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
                {team.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">暂无教师账户数据</p> : null}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {loading ? (
        <ListSkeleton rows={6} />
      ) : loadError || !summary ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <TriangleAlert className="h-6 w-6 text-amber-500" />
            <div role="alert">
              <p className="font-medium text-slate-700">教学复盘加载失败</p>
              <p className="mt-1 text-sm text-slate-400">{loadError || '接口未返回复盘数据，请重试'}</p>
            </div>
            <Button variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>重新加载</Button>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="回访"
              value={summary.workload.followups}
              unit="篇"
              hint="本月新写的课后回访"
              icon={<ClipboardList className="h-4 w-4" />}
            />
            <MetricCard
              label="月报"
              value={summary.workload.reports}
              unit="份"
              hint="本月已建立的月度报告"
              icon={<BookOpenCheck className="h-4 w-4" />}
            />
            <MetricCard
              label="听评课"
              value={summary.workload.observations}
              unit="节"
              hint="按听课日期统计全部听评课记录，草稿、已反馈和已归档均计入"
              icon={<Eye className="h-4 w-4" />}
            />
            <MetricCard
              label="备课"
              value={summary.workload.lessonPlans}
              unit="份"
              hint={'本月教案，其中 ' + summary.workload.lessonPlansConfirmed + ' 份已确认'}
              icon={<Sparkles className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="教学产出趋势"
                description="近 6 个月数量对比；三类数据条使用同一数量刻度"
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <CardBody>
                {trend.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">暂无月度教学产出数据</p>
                ) : (
                  <div className="space-y-4" role="img" aria-label="近 6 个月教学产出趋势图">
                    {trend.map((p) => (
                      <section key={p.month} aria-label={p.month + ' 教学产出'}>
                        <p className="mb-2 text-xs font-medium text-slate-500">{p.month}</p>
                        <div className="grid grid-cols-3 gap-3">
                          {([
                            { label: '课后回访', value: p.followups, unit: '篇', color: '#6366f1' },
                            { label: '月报', value: p.reports, unit: '份', color: '#a78bfa' },
                            { label: '听评课', value: p.observations, unit: '节', color: '#34d399' },
                          ]).map((item) => (
                            <div key={item.label}>
                              <div className="flex items-baseline justify-between gap-1 text-[11px]">
                                <span className="text-slate-400">{item.label}</span>
                                <span className="shrink-0 font-medium text-slate-600">{item.value} {item.unit}</span>
                              </div>
                              <div className="mt-1.5"><ShareBar percent={(item.value / maxTrend) * 100} tone={item.color} /></div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="掌握程度分布"
                description={monthTitle(month) + ' 的回访结论（枚举，不是分数）'}
                icon={<Activity className="h-4 w-4" />}
              />
              <CardBody>
                {summary.masteryDistribution.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">本月还没有填写掌握程度的回访</p>
                ) : (
                  <div className="space-y-3">
                    {summary.masteryDistribution.map((s) => (
                      <div key={s.key}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-600">{s.label}</span>
                          <span className="text-slate-400">{s.count} 篇 · {s.percent}%</span>
                        </div>
                        <div className="mt-1.5">
                          <ShareBar percent={s.percent} tone={s.key === 'excellent' ? '#10b981' : s.key === 'good' ? '#0ea5e9' : s.key === 'average' ? '#f59e0b' : '#ef4444'} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="AI 生成服务概览"
                description={monthTitle(month) + ' 的真实调用结果、响应耗时与业务分布'}
                icon={<BarChart3 className="h-4 w-4" />}
                action={<Badge tone={aiStatus.tone}>整体{aiStatus.label} · {formatPercent(summary.quality.aiSuccessRate)}</Badge>}
              />
              <CardBody>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-50 px-2 py-3">
                    <p className="text-lg font-bold text-slate-800">{summary.quality.aiCalls}<span className="ml-1 text-xs font-normal text-slate-400">次</span></p>
                    <p className="text-[11px] text-slate-400">AI 调用总量</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2 py-3">
                    <p className="text-lg font-bold text-slate-800">{summary.quality.aiErrorCount}<span className="ml-1 text-xs font-normal text-slate-400">次</span></p>
                    <p className="text-[11px] text-slate-400">失败调用</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2 py-3">
                    <p className="text-lg font-bold text-slate-800">{summary.quality.avgLatencyMs ?? '—'}{summary.quality.avgLatencyMs == null ? null : <span className="ml-1 text-xs font-normal text-slate-400">毫秒</span>}</p>
                    <p className="text-[11px] text-slate-400">平均响应耗时</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">整体成功率 = 成功状态的调用 ÷ 全部调用；平均耗时只统计有耗时值的调用。状态提示沿用页面既有阈值：≥95% 运行稳定，80% 至不足 95% 需要关注，低于 80% 优先排查。</p>
                <div className="mt-3"><SuccessRateTrend points={trend} /></div>
                {summary.quality.aiSuccessRate != null && summary.quality.aiSuccessRate < 80 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>整体成功率低于 80%，建议优先查看失败记录与模型服务日志；状态标签只反映调用结果，不代表教学质量。</span>
                  </div>
                )}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-slate-600">按教学业务查看</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">逐段与整篇生成分别统计，单位均为调用次数与毫秒</p>
                  </div>
                  <div className="space-y-3">
                    {summary.quality.byEndpoint.slice(0, 6).map((e) => {
                      const presentation = endpointPresentation(e.endpoint);
                      const status = successStatus(e.successRate);
                      return (
                        <section key={e.endpoint} className="rounded-xl border border-slate-100 p-3" aria-label={presentation.label}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-slate-700">{presentation.label}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">{presentation.description}</p>
                            </div>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                            <div className="rounded-lg bg-slate-50 p-2"><p className="text-xs font-semibold text-slate-700">{e.calls} 次</p><p className="mt-0.5 text-[10px] text-slate-400">调用总量</p></div>
                            <div className="rounded-lg bg-slate-50 p-2"><p className="text-xs font-semibold text-slate-700">{formatPercent(e.successRate)}</p><p className="mt-0.5 text-[10px] text-slate-400">生成成功率</p></div>
                            <div className="rounded-lg bg-slate-50 p-2"><p className="text-xs font-semibold text-slate-700">{e.retryCount} 次</p><p className="mt-0.5 text-[10px] text-slate-400">含重试 · {formatPercent(e.retryRate)}</p></div>
                            <div className="rounded-lg bg-slate-50 p-2"><p className="text-xs font-semibold text-slate-700">{formatLatency(e.avgLatencyMs)}</p><p className="mt-0.5 text-[10px] text-slate-400">平均响应耗时</p></div>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  {summary.quality.byEndpoint.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-400">本月暂无 AI 调用记录</p>
                  )}
                  {summary.quality.byEndpoint.length > 6 && (
                    <p className="mt-2 text-center text-[11px] text-slate-400">按调用量仅展示前 6 类业务</p>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="学生成长与出勤"
                description="掌握度为当前知识点快照；学生内先平均，再跨学生等权汇总，不代表本月提升幅度"
                icon={<Users className="h-4 w-4" />}
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-50 py-3">
                    <p className="text-lg font-bold text-slate-800">{summary.workload.students}</p>
                    <p className="text-[11px] text-slate-400">学生</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-3">
                    <p className="text-lg font-bold text-slate-800">{formatPercent(summary.attendance.rate)}</p>
                    <p className="text-[11px] text-slate-400">出勤率（含补课）</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-3">
                    <p className="text-lg font-bold text-slate-800">{summary.attendance.sessions}</p>
                    <p className="text-[11px] text-slate-400">课次</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">正常/补课 {summary.attendance.present} 次 · 请假 {summary.attendance.leave ?? 0} 次{summary.attendance.unclassified ? ' · 未分类 ' + summary.attendance.unclassified + ' 次' : ''}</p>
                {summary.growth.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">当前还没有知识点记录；可在月报中关联知识点后回看</p>
                ) : (
                  <div className="space-y-3">
                    {summary.growth.map((g) => (
                      <div key={g.category}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-600">{CATEGORY_LABELS[g.category] || '其他知识类别'}</span>
                          <span className="text-slate-500">平均掌握 {Math.round(g.avgMastery * 100)}%</span>
                        </div>
                        <div className="mt-1.5">
                          <ShareBar percent={Math.round(g.avgMastery * 100)} tone="#6366f1" label={(CATEGORY_LABELS[g.category] || '其他知识类别') + '平均掌握度 ' + Math.round(g.avgMastery * 100) + '%'} />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">记录 {g.total} 个知识点 · 稳固 {g.solid} 个 · 薄弱 {g.weak} 个</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="本月工作节奏" description="按回访创建日期统计，不把它等同于上课日期" icon={<Activity className="h-4 w-4" />} />
              <CardBody>
                {summary.dailyActivity.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">本月还没有回访记录</p>
                ) : (
                  <div className="space-y-2">
                    {summary.dailyActivity.map((item) => (
                      <div key={item.day} className="flex items-center gap-3 text-xs">
                        <span className="w-20 shrink-0 text-slate-500">{item.day.slice(5)}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: (item.n / maxDailyActivity) * 100 + '%' }} />
                        </div>
                        <span className="w-8 text-right text-slate-500">{item.n} 篇</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="回访内容质量" description="结构化、图片和引用是当前记录的可核验属性" icon={<ClipboardList className="h-4 w-4" />} />
              <CardBody>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{summary.followupQuality.total}<span className="ml-1 text-xs font-normal text-slate-400">篇</span></p><p className="text-[11px] text-slate-400">回访总数</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{summary.followupQuality.avgWordCount ?? '—'}{summary.followupQuality.avgWordCount == null ? null : <span className="ml-1 text-xs font-normal text-slate-400">字</span>}</p><p className="text-[11px] text-slate-400">平均字数</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{formatPercent(summary.followupQuality.structuredRate)}</p><p className="text-[11px] text-slate-400">五板块完整</p><p className="mt-1 text-[10px] text-slate-400">{summary.followupQuality.structured}/{summary.followupQuality.total} 篇</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{formatPercent(summary.followupQuality.imageRecordRate)}</p><p className="text-[11px] text-slate-400">含图片路径</p><p className="mt-1 text-[10px] text-slate-400">{summary.followupQuality.withImages}/{summary.followupQuality.total} 篇</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{formatPercent(summary.followupQuality.historicalReferenceRate)}</p><p className="text-[11px] text-slate-400">有内容引用</p><p className="mt-1 text-[10px] text-slate-400">{summary.followupQuality.referenced}/{summary.followupQuality.total} 篇</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{formatPercent(summary.followupQuality.parentReadRate)}</p><p className="text-[11px] text-slate-400">家长链接已读</p><p className="mt-1 text-[10px] text-slate-400">已读 {summary.followupQuality.parentRead} · 已分享 {summary.followupQuality.parentShared}</p></div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">图片率不代表图片仍可访问或识别成功；家长阅读率按当前分享链接的 read_at 计算。</p>
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="AI 生成质量漏斗" description="这是调用质量漏斗，不是教师采纳或保存漏斗" icon={<BarChart3 className="h-4 w-4" />} />
              <CardBody>
                <div className="space-y-3">
                  {summary.quality.funnel.map((item) => (
                    <div key={item.key}>
                      <div className="flex items-center justify-between text-xs"><span className="text-slate-600">{item.label}</span><span className="text-slate-500">{item.value} 次</span></div>
                      <div className="mt-1"><ShareBar percent={(item.value / maxFunnel) * 100} tone="#0ea5e9" /></div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 p-2"><p className="font-semibold text-slate-700">{formatPercent(summary.quality.aiRetryRate)}</p><p className="text-slate-400">含重试调用占比</p></div>
                  <div className="rounded-lg bg-slate-50 p-2"><p className="font-semibold text-slate-700">{summary.quality.retryAttempts} 次</p><p className="text-slate-400">累计重试次数</p></div>
                  <div className="rounded-lg bg-slate-50 p-2"><p className="font-semibold text-slate-700">{summary.quality.totalTokens.toLocaleString('zh-CN')}<span className="ml-1 text-[10px] font-normal text-slate-400">tokens</span></p><p className="text-slate-400">模型 Token 总量</p></div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">含重试调用 = 调用状态标记为重试，或记录的重试次数大于 0；不是教师主动重新生成率。累计重试次数为各调用已记录重试次数之和；Token 总量为已记录模型用量之和。</p>
                <p className="mt-3 text-xs text-slate-500">字数达标：{summary.quality.wordTarget.inRange}/{summary.quality.wordTarget.measured} 次（{formatPercent(summary.quality.wordTarget.rate)}），分母仅包含有字数目标的成功调用。</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="响应耗时与生成字数" description="成功调用的原始记录，最多最近 200 条" icon={<TrendingUp className="h-4 w-4" />} />
              <CardBody><LatencyScatter points={summary.quality.latencyWordCount} /></CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="学生覆盖" description="冷启动名单按本月是否有回访计算，显示全部学生的统计总数" icon={<Users className="h-4 w-4" />} />
              <CardBody>
                {!coverage ? <p className="py-4 text-center text-sm text-slate-400">正在加载学生覆盖数据</p> : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{coverage.totalStudents}</p><p className="text-[11px] text-slate-400">学生总数</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold text-slate-800">{coverage.coveredStudents}</p><p className="text-[11px] text-slate-400">本月已回访</p></div>
                      <div className="rounded-lg bg-amber-50 p-3"><p className="text-lg font-bold text-amber-700">{coverage.coldCount}</p><p className="text-[11px] text-amber-600">本月未回访</p></div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {coverage.students.filter((student) => student.cold).slice(0, 8).map((student) => (
                        <button key={student.studentId} type="button" onClick={() => navigate('/students/' + student.studentId)} className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-xs hover:border-brand-200 hover:bg-brand-50">
                          <span className="font-medium text-slate-600">{student.studentName}<span className="ml-2 font-normal text-slate-400">{student.grade} · {student.subject}</span></span>
                          <span className="text-amber-600">待回访</span>
                        </button>
                      ))}
                      {coverage.coldCount === 0 && <p className="py-3 text-center text-sm text-emerald-600">本月所有学生都有回访记录</p>}
                      {coverage.coldCount > 8 && <p className="text-center text-[11px] text-slate-400">仅展示前 8 位未回访学生，完整名单请进入学生页查看</p>}
                    </div>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="本人小组对比" description="掌握度与月报知识变化分别只在有记录的学生内等权平均；不包含其他教师数据" icon={<Users className="h-4 w-4" />} />
              <CardBody>
                {summary.groupComparisons.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">还没有本人创建的小组</p> : (
                  <div className="space-y-3">
                    {summary.groupComparisons.map((group) => (
                      <div key={group.groupId} className="rounded-lg border border-slate-100 p-3">
                        <div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-700">{group.groupName}</span><span className="text-xs text-slate-400">{group.studentCount} 名学生</span></div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                          <div><p className="font-semibold text-slate-700">{group.avgMastery == null ? '—' : Math.round(group.avgMastery * 100) + '%'}</p><p className="text-slate-400">当前掌握 · {group.masteryStudentCount}/{group.studentCount} 人</p></div>
                          <div><p className="font-semibold text-slate-700">{group.avgMasteryDelta == null ? '—' : (group.avgMasteryDelta >= 0 ? '+' : '') + group.avgMasteryDelta}</p><p className="text-slate-400">月报知识变化 · {group.deltaStudentCount}/{group.studentCount} 人</p></div>
                          <div><p className="font-semibold text-slate-700">{formatPercent(group.followupCoverageRate)}</p><p className="text-slate-400">回访覆盖</p></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="本月知识变化（月报记录值）" description="按类别汇总月报关联知识点的原始变化值；不是百分比，也不是历史掌握度曲线" icon={<TrendingUp className="h-4 w-4" />} />
            <CardBody>
              {summary.monthlyKnowledgeDelta.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">本月没有月报知识点变化记录</p> : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {summary.monthlyKnowledgeDelta.map((item) => <div key={item.category} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{CATEGORY_LABELS[item.category] || '其他知识类别'}</p><p className={'mt-1 text-xl font-bold ' + (item.delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{item.delta >= 0 ? '+' : ''}{item.delta}</p><p className="text-[11px] text-slate-400">原始变化值 · {item.evidenceCount} 条月报证据</p></div>)}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="数据边界与未采集指标" description="这些限制是产品当前真实状态，不用估算值填充" icon={<TriangleAlert className="h-4 w-4" />} />
            <CardBody>
              <ul className="space-y-2 text-xs leading-relaxed text-slate-500">
                {summary.limitations.map((limitation) => <li key={limitation} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />{limitation}</li>)}
              </ul>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
