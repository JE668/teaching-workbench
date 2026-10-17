import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Inbox, Send, MessageSquareText, Clock } from 'lucide-react';
import { api } from '../api/client';
import { Observation, overallGradeLabel, Teacher } from '../types/index';
import { Card } from '../components/ui/Card';
import { FilterBar } from '../components/ui/FilterBar';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { relativeTime } from '../lib/utils';
import { rangeFromDays, toQueryString, type RangeKey } from '../lib/dateRange';

type Bucket = { key: string; title: string; icon: React.ReactNode; hint: string; tone: string };

const BUCKETS: Bucket[] = [
  { key: 'pending', title: '待反馈', icon: <Clock className="h-4 w-4" />, hint: '评课已生成，还没发给老师', tone: 'text-slate-400' },
  { key: 'awaiting', title: '已反馈 · 老师未回', icon: <Send className="h-4 w-4" />, hint: '已发给老师，正在等回应', tone: 'text-amber-500' },
  { key: 'replied', title: '老师已回', icon: <MessageSquareText className="h-4 w-4" />, hint: '老师已回应，闭环完成', tone: 'text-emerald-500' },
];

export default function ObservationReplyBoard() {
  const [obs, setObs] = useState<Observation[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [teacherId, setTeacherId] = useState('');
  const [range, setRange] = useState<RangeKey>('');
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    // 老师列表仅用于筛选下拉，加载失败不影响主流程
    api
      .get('/teachers')
      .then((r: any) => setTeachers(r.teachers || []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const qs = toQueryString({ teacherId, ...rangeFromDays(range) });
    setLoading(true);
    api
      .get('/observations' + qs)
      .then((r: any) => {
        if (!cancelled) setObs(r.observations || []);
      })
      .catch((err: any) => toast.error('加载失败：' + err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId, range]);

  const filtered = teacherId !== '' || range !== '';

  const replied = obs.filter((o) => o.teacherReply && o.teacherReply.trim());
  const pending = obs.filter((o) => !(o.teacherReply && o.teacherReply.trim()) && o.status === 'draft');
  const awaiting = obs.filter((o) => !(o.teacherReply && o.teacherReply.trim()) && o.status !== 'draft');

  const markSent = async (id: number) => {
    try {
      await api.put('/observations/' + id, { status: 'sent' });
      setObs((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'sent' } : o)));
      toast.success('已标记为「已反馈」');
    } catch (err: any) {
      toast.error('操作失败：' + err.message);
    }
  };

  const buckets: Record<string, Observation[]> = { pending, awaiting, replied };

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center gap-3">
        <Link to="/observations" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">老师回复闭环</h1>
          <p className="mt-0.5 text-sm text-slate-400">跟踪评课反馈：待反馈 → 已反馈等回应 → 老师已回</p>
        </div>
      </div>

      <FilterBar
        teachers={teachers}
        teacherId={teacherId}
        onTeacherChange={setTeacherId}
        range={range}
        onRangeChange={setRange}
      />

      {loading ? (
        <Card>
          <div className="p-5">
            <ListSkeleton rows={3} />
          </div>
        </Card>
      ) : obs.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          title={filtered ? '该条件下暂无记录' : '还没有听评课记录'}
          description={
            filtered
              ? '换一位老师，或把时间范围调大再试试'
              : '新建听课记录并生成评课报告后，就能在这里跟踪反馈闭环'
          }
          action={
            <Button variant="gradient" onClick={() => navigate('/observations/new')}>
              去新建
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {BUCKETS.map((b) => {
            const items = buckets[b.key] || [];
            return (
              <Card key={b.key}>
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className={b.tone}>{b.icon}</span>
                    <span className="text-sm font-semibold text-slate-700">{b.title}</span>
                  </div>
                  <Badge tone={b.key === 'replied' ? 'success' : b.key === 'awaiting' ? 'warning' : 'neutral'}>
                    {items.length}
                  </Badge>
                </div>
                <p className="px-5 pt-3 text-xs text-slate-400">{b.hint}</p>
                <div className="space-y-3 p-5">
                  {items.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-300">（空）</p>
                  ) : (
                    items.map((o) => (
                      <div key={o.id} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            to={'/observations/' + o.id}
                            className="text-sm font-medium text-slate-700 hover:text-brand-600"
                          >
                            {o.teacherName} · {o.topic}
                          </Link>
                          {o.overallGrade ? <Badge tone="brand">{overallGradeLabel(o.overallGrade)}</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {o.updatedAt ? relativeTime(o.updatedAt) : ''}
                        </p>
                        {b.key === 'replied' && o.teacherReply ? (
                          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-slate-600 ring-1 ring-slate-100">
                            {o.teacherReply}
                          </p>
                        ) : null}
                        {b.key === 'pending' ? (
                          <div className="mt-2 flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => markSent(o.id)}>
                              标记已反馈
                            </Button>
                          </div>
                        ) : null}
                        {b.key === 'awaiting' ? (
                          <Link to={'/observations/' + o.id} className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
                            记录老师回应 →
                          </Link>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
