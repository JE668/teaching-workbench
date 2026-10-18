import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, Users, CalendarDays, Target, PartyPopper } from 'lucide-react';
import { api } from '../api/client';
import { TeacherStat, Teacher, CoverageData } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import { Select } from '../components/ui/Field';
import { FilterBar } from '../components/ui/FilterBar';
import { ListSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { formatDate, relativeTime } from '../lib/utils';
import { rangeFromDays, toQueryString, type RangeKey } from '../lib/dateRange';

/** 覆盖率时间窗选项（与看板筛选的 RANGE_OPTIONS 分开：覆盖率没有"全部时间"这一说） */
const COVERAGE_RANGES = [30, 90, 180, 365];

const GRADE_CHIPS: { key: keyof TeacherStat['grades']; label: string; dot: string }[] = [
  { key: 'excellent', label: '优', dot: 'bg-emerald-500' },
  { key: 'good', label: '良', dot: 'bg-sky-500' },
  { key: 'pass', label: '合格', dot: 'bg-amber-500' },
  { key: 'needs_work', label: '待提高', dot: 'bg-rose-500' },
  { key: 'ungraded', label: '未评', dot: 'bg-slate-300' },
];

export default function ObservationStats() {
  const [rows, setRows] = useState<TeacherStat[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [teacherId, setTeacherId] = useState('');
  const [range, setRange] = useState<RangeKey>('');
  const toast = useToast();

  // 听课覆盖率：与上方老师筛选互相独立 —— 覆盖率关心的正是"谁没被听过"，
  // 所以不能被"只看某一位老师"的筛选条件收窄掉
  const [cov, setCov] = useState<CoverageData | null>(null);
  const [covLoading, setCovLoading] = useState(true);
  const [covDays, setCovDays] = useState(90);

  useEffect(() => {
    // 老师列表仅用于筛选下拉，加载失败不影响主流程
    api
      .get('/teachers')
      .then((r: any) => setTeachers(r.teachers || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCovLoading(true);
    api
      .get('/observations/coverage?days=' + covDays)
      .then((r: any) => {
        if (!cancelled) setCov(r);
      })
      .catch((err: any) => toast.error('加载听课覆盖率失败：' + err.message))
      .finally(() => {
        if (!cancelled) setCovLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [covDays]);

  useEffect(() => {
    let cancelled = false;
    const qs = toQueryString({ teacherId, ...rangeFromDays(range) });
    setLoading(true);
    api
      .get('/observations/teacher-stats' + qs)
      .then((r: any) => {
        if (!cancelled) setRows(r.teachers || []);
      })
      .catch((err: any) => toast.error('加载统计失败：' + err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId, range]);

  const filtered = teacherId !== '' || range !== '';

  const totalObs = rows.reduce((s, r) => s + r.obsCount, 0);
  const latest =
    rows
      .map((r) => r.lastObservedAt)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center gap-3">
        <Link to="/observations" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">老师统计</h1>
          <p className="mt-0.5 text-sm text-slate-400">按被听课老师看听课次数与评价等级分布</p>
        </div>
      </div>

      <FilterBar
        teachers={teachers}
        teacherId={teacherId}
        onTeacherChange={setTeacherId}
        range={range}
        onRangeChange={setRange}
      />

      {/* 概览 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3 p-5">
            <div className="rounded-xl bg-brand-50 p-3 text-brand-600">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{rows.length}</p>
              <p className="text-xs text-slate-400">被听课老师</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 p-5">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{totalObs}</p>
              <p className="text-xs text-slate-400">听评课次数</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 p-5">
            <div className="rounded-xl bg-amber-50 p-3 text-amber-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">
                {latest ? formatDate(latest) : '—'}
              </p>
              <p className="text-xs text-slate-400">最近一次听课</p>
            </div>
          </div>
        </Card>
      </div>

      {/* 听课覆盖率：谁最近没被听过 */}
      <Card data-testid="coverage-card">
        <CardHeader
          title="听课覆盖率"
          description="近一段时间内，有多少老师的课被你听过"
          icon={<Target className="h-4 w-4" />}
          action={
            <Select
              value={String(covDays)}
              onChange={(e) => setCovDays(Number(e.target.value))}
              options={COVERAGE_RANGES.map((d) => ({ value: String(d), label: '近 ' + d + ' 天' }))}
              className="h-9 w-28 text-xs"
              aria-label="覆盖率时间窗"
            />
          }
        />
        {covLoading ? (
          <div className="p-5">
            <ListSkeleton rows={3} />
          </div>
        ) : !cov || cov.totalTeachers === 0 ? (
          <EmptyState
            icon={<Target className="h-7 w-7" />}
            title="还没有老师"
            description="新建老师后，这里会告诉你哪些老师的课还没听过"
          />
        ) : (
          <div className="space-y-5 p-5">
            <div>
              <div className="mb-2 flex items-end justify-between">
                <p className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tracking-tight text-slate-800">
                    {Math.round(cov.coverage * 100)}%
                  </span>
                  <span className="text-xs text-slate-400">
                    近 {covDays} 天内 {cov.observedCount}/{cov.totalTeachers} 位老师被听过
                  </span>
                </p>
                {cov.unobservedCount > 0 ? (
                  <p className="text-xs font-medium text-amber-600">还有 {cov.unobservedCount} 位没听过</p>
                ) : null}
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={Math.round(cov.coverage * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="听课覆盖率"
              >
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-500"
                  style={{ width: Math.round(cov.coverage * 100) + '%' }}
                />
              </div>
            </div>

            {cov.unobserved.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                <PartyPopper className="h-4 w-4 shrink-0" />
                所有老师最近 {covDays} 天都被听过课了
              </p>
            ) : (
              <div data-testid="coverage-unobserved">
                <p className="mb-2 text-sm font-medium text-slate-700">
                  这些老师近 {covDays} 天还没被听过
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {cov.unobserved.map((t) => (
                    <div
                      key={t.teacherId}
                      data-testid={'coverage-teacher-' + t.teacherId}
                      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-100"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-700">{t.teacherName}</p>
                        <p className="truncate text-xs text-slate-400">
                          {t.subject
                            ? t.subject + ' · '
                            : ''
                          }
                          {t.lastObservedAt ? relativeTime(t.lastObservedAt) + ' 听过' : '从未听过'}
                        </p>
                      </div>
                      {t.daysSince !== null ? (
                        <span
                          className={
                            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ' +
                            (t.daysSince >= covDays * 2
                              ? 'bg-rose-50 text-rose-600'
                              : 'bg-amber-50 text-amber-600')
                          }
                        >
                          {t.daysSince} 天
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                          从未
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="按老师" description="各老师的听课次数与总体评价等级分布" icon={<Users className="h-4 w-4" />} />
        {loading ? (
          <div className="p-5">
            <ListSkeleton rows={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={filtered ? '该条件下暂无统计' : '还没有被听课老师'}
            description={
              filtered
                ? '换一位老师，或把时间范围调大再试试'
                : '新建听课记录并关联老师后，这里会按老师汇总统计'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">老师</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">科目</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">听课次数</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">等级分布</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">最近听课</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.teacherId} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-700">{r.teacherName}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{r.subject || '—'}</td>
                    <td className="px-6 py-4 text-right text-sm font-semibold text-slate-700">{r.obsCount}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {GRADE_CHIPS.map((c) => {
                          const n = r.grades[c.key];
                          return (
                            <span
                              key={c.key}
                              className={
                                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ' +
                                (n > 0 ? 'bg-white text-slate-600 ring-slate-200' : 'bg-slate-50 text-slate-300 ring-slate-100')
                              }
                            >
                              <span className={'h-1.5 w-1.5 rounded-full ' + c.dot} />
                              {c.label} {n}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-500">
                      {r.lastObservedAt ? relativeTime(r.lastObservedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
