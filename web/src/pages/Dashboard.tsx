import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  MessageSquareText,
  BookOpen,
  ArrowRight,
  Plus,
  Sparkles,
  TrendingUp,
  Clock,
  ImageIcon,
} from 'lucide-react';
import { api } from '../api/client';
import { Student, FollowUp } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { PageSkeleton } from '../components/ui/Skeleton';
import { relativeTime, formatDate } from '../lib/utils';

const masteryTone: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  excellent: 'success',
  good: 'info',
  average: 'warning',
  needs_improvement: 'danger',
};
const masteryLabel: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  average: '一般',
  needs_improvement: '需加强',
};

export default function Dashboard() {
  const [students, setStudents] = useState<Student[]>([]);
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const [s, f] = await Promise.all([api.get('/students'), api.get('/followups')]);
      setStudents(s.students || []);
      setFollowups(f.followups || []);
    } catch (err) {
      console.error('加载失败', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <PageSkeleton />;

  const recent = followups.slice(0, 5);
  const totalImages = followups.reduce((sum, f) => sum + (f.images?.length || 0), 0);
  const stats = [
    {
      label: '学生总数',
      value: students.length,
      icon: Users,
      gradient: 'from-brand-500 to-violet-600',
      suffix: '人',
    },
    {
      label: '回访次数',
      value: followups.length,
      icon: MessageSquareText,
      gradient: 'from-emerald-500 to-teal-600',
      suffix: '次',
    },
    {
      label: '覆盖学科',
      value: new Set(students.map((s) => s.subject)).size,
      icon: BookOpen,
      gradient: 'from-amber-500 to-orange-600',
      suffix: '科',
    },
    {
      label: '归档图片',
      value: totalImages,
      icon: ImageIcon,
      gradient: 'from-sky-500 to-cyan-600',
      suffix: '张',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">工作台</h1>
          <p className="mt-1 text-sm text-slate-400">
            今天也是认真教学的一天 · 共 {students.length} 名学生
          </p>
        </div>
        <Link to="/followups">
          <Button variant="gradient" icon={<Plus className="h-4 w-4" />}>
            新建回访
          </Button>
        </Link>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Card
            key={s.label}
            className="animate-fade-up p-5"
            style={{ animationDelay: i * 70 + 'ms' }}
          >
            <div className="flex items-start justify-between">
              <div className={'flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-soft ' + s.gradient}>
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <TrendingUp className="h-4 w-4 text-slate-300" />
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight text-slate-800">
              {s.value}
              <span className="ml-1 text-sm font-medium text-slate-400">{s.suffix}</span>
            </p>
            <p className="mt-0.5 text-sm text-slate-400">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* 近期回访 */}
        <Card className="animate-fade-up lg:col-span-3" style={{ animationDelay: '280ms' }}>
          <CardHeader
            title="近期回访"
            description="最新生成的课后反馈"
            icon={<Clock className="h-4 w-4" />}
            action={
              <Link
                to="/followups/history"
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                全部 <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              icon={<MessageSquareText className="h-7 w-7" />}
              title="还没有回访记录"
              description="创建第一条课后回访，AI 会帮你生成专业反馈"
              action={
                <Link to="/followups">
                  <Button variant="gradient" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />}>
                    开始生成
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {recent.map((f) => (
                <Link
                  key={f.id}
                  to={f.studentId ? '/students/' + f.studentId : '/followups/history'}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50/70"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-50 to-violet-50 text-sm font-semibold text-brand-600 ring-1 ring-brand-100">
                    {f.studentName?.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-700">
                        {f.studentName}
                      </span>
                      <Badge tone={masteryTone[f.mastery] || 'neutral'}>
                        {masteryLabel[f.mastery] || f.mastery}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {f.subject} · {f.topic}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-400">{relativeTime(f.createdAt)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-300">{f.wordCount} 字</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* 学生概览 */}
        <Card className="animate-fade-up lg:col-span-2" style={{ animationDelay: '340ms' }}>
          <CardHeader
            title="学生概览"
            description="最近添加的学生"
            icon={<Users className="h-4 w-4" />}
            action={
              <Link
                to="/students"
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                全部 <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          {students.length === 0 ? (
            <EmptyState
              icon={<Users className="h-7 w-7" />}
              title="还没有学生"
              description="先添加学生，再为他们创建回访"
              action={
                <Link to="/students">
                  <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
                    添加学生
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-1 p-3">
              {students.slice(0, 6).map((s) => (
                <Link
                  key={s.id}
                  to={'/students/' + s.id}
                  className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500">
                    {s.name?.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{s.name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {s.grade} · {s.subject}
                    </p>
                  </div>
                  <Badge tone="neutral">{formatDate(s.createdAt)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
