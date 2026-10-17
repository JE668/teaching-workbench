import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Plus, Sparkles, Trash2, ClipboardCheck } from 'lucide-react';
import { api } from '../api/client';
import {
  Observation,
  LESSON_TYPES,
  OBSERVATION_STATUS,
  lessonTypeLabel,
  overallGradeLabel,
} from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Select } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { formatDate } from '../lib/utils';

const statusTone: Record<string, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  sent: 'success',
  archived: 'warning',
};

export default function Observations() {
  const [items, setItems] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lessonTypeFilter, setLessonTypeFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Observation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    load(lessonTypeFilter || undefined);
  }, [lessonTypeFilter]);

  const load = async (lessonType?: string) => {
    try {
      const qs = lessonType ? '?lessonType=' + encodeURIComponent(lessonType) : '';
      const res = await api.get('/observations' + qs);
      setItems(res.observations || []);
    } catch (err: any) {
      toast.error('加载听评课失败：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete('/observations/' + deleteTarget.id);
      setItems((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      toast.success('已删除该听评课记录');
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error('删除失败：' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">听评课</h1>
          <p className="mt-1 text-sm text-slate-400">
            旁听 1对1 课堂 · 记录实录 · AI 生成评课报告 · 复制进「听评课表」
          </p>
        </div>
        <Button variant="gradient" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/observations/new')}>
          新建听课记录
        </Button>
      </div>

      <Card>
        <CardHeader
          title="听评课列表"
          description="点击一条进入详情、生成或编辑评课报告"
          icon={<Eye className="h-4 w-4" />}
          action={
            <Select
              value={lessonTypeFilter}
              onChange={(e) => setLessonTypeFilter(e.target.value)}
              placeholder="全部课型"
              options={LESSON_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              className="w-40"
            />
          }
        />

        {loading ? (
          <div className="p-5">
            <ListSkeleton rows={5} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<EyeOff className="h-7 w-7" />}
            title="还没有听评课记录"
            description="新建一条听课记录，AI 帮你把评课报告写好"
            action={
              <Button variant="gradient" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/observations/new')}>
                新建听课记录
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">被听课老师</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">课题</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">课型</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">听课时间</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">等级</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">状态</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((o) => (
                  <tr key={o.id} className="group transition-colors hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-slate-700">{o.teacherName}</p>
                    </td>
                    <td className="px-6 py-4">
                      <Link to={'/observations/' + o.id} className="text-sm font-medium text-slate-700 hover:text-brand-600">
                        {o.topic}
                      </Link>
                      {o.report ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-brand-500">
                          <Sparkles className="h-3 w-3" /> 已生成评课
                        </span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone="violet">{lessonTypeLabel(o.lessonType)}</Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{o.observedAt ? formatDate(o.observedAt) : '—'}</td>
                    <td className="px-6 py-4">
                      {o.overallGrade ? (
                        <Badge tone="brand">{overallGradeLabel(o.overallGrade)}</Badge>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone={statusTone[o.status] ?? 'neutral'}>
                        {OBSERVATION_STATUS.find((s) => s.value === o.status)?.label ?? o.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                        <Link
                          to={'/observations/' + o.id}
                          title="查看 / 编辑"
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
                        >
                          <ClipboardCheck className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => setDeleteTarget(o)}
                          title="删除"
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={'删除「' + (deleteTarget?.teacherName || '') + ' · ' + (deleteTarget?.topic || '') + '」？'}
        description="删除后该听评课记录与已生成的评课报告将一并移除，无法恢复。"
        confirmText="删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
