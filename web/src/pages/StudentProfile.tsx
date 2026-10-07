import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  MessageSquareText,
  ImageIcon,
  FileText,
  Clock,
  ChevronDown,
  StickyNote,
  Phone,
  FolderOpen,
} from 'lucide-react';
import { api } from '../api/client';
import { MASTERY_LEVELS } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { PageSkeleton } from '../components/ui/Skeleton';
import { formatDate, relativeTime, cn } from '../lib/utils';

interface FollowUpRecord {
  id: number;
  studentId: number | null;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  images: string[];
  content: string;
  wordCount: number;
  createdAt: string;
}

interface ProfileData {
  student: {
    id: number;
    name: string;
    grade: string;
    subject: string;
    phone?: string;
    notes?: string;
    createdAt: string;
  };
  followups: FollowUpRecord[];
  stats: {
    totalFollowups: number;
    totalWords: number;
    totalImages: number;
    subjects: string[];
    grades: string[];
    lastFollowUpAt: string | null;
  };
}

const masteryTone = (v: string) =>
  v === 'excellent' ? 'success' : v === 'good' ? 'info' : v === 'average' ? 'warning' : 'danger';
const masteryLabel = (v: string) => MASTERY_LEVELS.find((m) => m.value === v)?.label || v;

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get('/students/' + id + '/profile')
      .then(setData)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSkeleton />;

  if (!data) {
    return (
      <Card>
        <EmptyState
          icon={<FolderOpen className="h-7 w-7" />}
          title="学生档案不存在"
          description="该学生可能已被删除"
          action={
            <Link to="/students">
              <Button variant="outline">返回学生列表</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const { student, followups, stats } = data;

  const statCards = [
    { label: '回访次数', value: stats.totalFollowups, icon: MessageSquareText, color: 'text-brand-600 bg-brand-50' },
    { label: '归档图片', value: stats.totalImages, icon: ImageIcon, color: 'text-violet-600 bg-violet-50' },
    { label: '累计字数', value: stats.totalWords, icon: FileText, color: 'text-emerald-600 bg-emerald-50' },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/students')}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-soft ring-1 ring-slate-100 transition-colors hover:text-slate-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3.5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-xl font-bold text-white shadow-lift">
              {student.name?.charAt(0)}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-800">{student.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                <span>{student.grade}</span>
                <span className="text-slate-300">·</span>
                <span>{student.subject}</span>
                {student.phone && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {student.phone}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <Link to={'/followups?studentId=' + student.id}>
          <Button variant="gradient" icon={<Plus className="h-4 w-4" />}>
            新建回访
          </Button>
        </Link>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-4">
        {statCards.map((s) => (
          <Card key={s.label} className="flex items-center gap-4 p-5">
            <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', s.color)}>
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight text-slate-800">{s.value}</p>
              <p className="text-xs text-slate-400">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* 备注 */}
      {student.notes && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-5 py-4 ring-1 ring-amber-100">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-xs font-semibold text-amber-700">学生备注</p>
            <p className="mt-0.5 text-sm leading-relaxed text-amber-800">{student.notes}</p>
          </div>
        </div>
      )}

      {/* 档案时间线 */}
      <Card>
        <CardHeader
          title="回访档案"
          description={
            stats.lastFollowUpAt
              ? '最近回访于 ' + relativeTime(stats.lastFollowUpAt) + ' · 图片与 AI 内容自动归档'
              : '每次回访的图片与 AI 内容自动归档到此处'
          }
          icon={<Clock className="h-4 w-4" />}
          action={followups.length > 0 ? <Badge tone="brand">{followups.length} 条记录</Badge> : undefined}
        />

        {followups.length === 0 ? (
          <EmptyState
            icon={<MessageSquareText className="h-7 w-7" />}
            title="暂无回访记录"
            description="创建第一条回访，记录学生的学习成长"
            action={
              <Link to={'/followups?studentId=' + student.id}>
                <Button variant="gradient" icon={<Plus className="h-4 w-4" />}>
                  创建回访
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="p-5">
            <div className="relative space-y-4 pl-6">
              {/* 竖线 */}
              <div className="absolute bottom-3 left-[7px] top-3 w-px bg-gradient-to-b from-brand-200 via-slate-200 to-transparent" />

              {followups.map((f, idx) => {
                const open = expanded === f.id;
                return (
                  <div key={f.id} className="relative">
                    {/* 节点 */}
                    <span
                      className={cn(
                        'absolute -left-6 top-5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-white',
                        idx === 0 ? 'bg-gradient-to-br from-brand-500 to-violet-600' : 'bg-slate-300'
                      )}
                    />

                    <Card className="overflow-hidden transition-shadow hover:shadow-lift">
                      <div className="p-5">
                        {/* 标题行 */}
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-800">{f.topic}</h3>
                            <Badge tone={masteryTone(f.mastery)}>{masteryLabel(f.mastery)}</Badge>
                            <Badge tone="brand">{f.subject}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>{formatDate(f.createdAt)}</span>
                            <span className="text-slate-300">·</span>
                            <span>{f.wordCount} 字</span>
                          </div>
                        </div>

                        {/* 课堂表现 */}
                        <p className="mt-3 text-sm leading-relaxed text-slate-500">
                          <span className="font-medium text-slate-400">课堂表现：</span>
                          {f.performance}
                        </p>

                        {/* 图片 */}
                        {f.images.length > 0 && (
                          <div className="mt-3.5 flex flex-wrap gap-2">
                            {f.images.map((img, i) => (
                              <img
                                key={i}
                                src={'/uploads/' + img}
                                alt={'图片 ' + (i + 1)}
                                className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200 transition-all hover:scale-[1.04] hover:ring-brand-300"
                              />
                            ))}
                          </div>
                        )}

                        {/* AI 内容 */}
                        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3.5 ring-1 ring-slate-100">
                          <p
                            className={cn(
                              'whitespace-pre-wrap text-sm leading-[1.9] text-slate-700',
                              !open && 'line-clamp-3'
                            )}
                          >
                            {f.content}
                          </p>
                          <button
                            onClick={() => setExpanded(open ? null : f.id)}
                            className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 transition-colors hover:text-brand-700"
                          >
                            <ChevronDown
                              className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
                            />
                            {open ? '收起' : '展开全文'}
                          </button>
                        </div>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
