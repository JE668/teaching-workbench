import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, Users, CalendarDays } from 'lucide-react';
import { api } from '../api/client';
import { TeacherStat } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import { ListSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { formatDate, relativeTime } from '../lib/utils';

const GRADE_CHIPS: { key: keyof TeacherStat['grades']; label: string; dot: string }[] = [
  { key: 'excellent', label: '优', dot: 'bg-emerald-500' },
  { key: 'good', label: '良', dot: 'bg-sky-500' },
  { key: 'pass', label: '合格', dot: 'bg-amber-500' },
  { key: 'needs_work', label: '待提高', dot: 'bg-rose-500' },
  { key: 'ungraded', label: '未评', dot: 'bg-slate-300' },
];

export default function ObservationStats() {
  const [rows, setRows] = useState<TeacherStat[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api
      .get('/observations/teacher-stats')
      .then((r: any) => setRows(r.teachers || []))
      .catch((err: any) => toast.error('加载统计失败：' + err.message))
      .finally(() => setLoading(false));
  }, []);

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

      <Card>
        <CardHeader title="按老师" description="各老师的听课次数与总体评价等级分布" icon={<Users className="h-4 w-4" />} />
        {loading ? (
          <div className="p-5">
            <ListSkeleton rows={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="还没有被听课老师"
            description="新建听课记录并关联老师后，这里会按老师汇总统计"
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
