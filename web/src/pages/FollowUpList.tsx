import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  History,
  Plus,
  Filter,
  Trash2,
  Eye,
  ImageIcon,
  Clock,
  FolderOpen,
  User,
} from 'lucide-react';
import { api } from '../api/client';
import { FollowUp, GRADES, SUBJECTS, MASTERY_LEVELS } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { formatDate, relativeTime, cn } from '../lib/utils';

const masteryTone = (v: string) =>
  v === 'excellent' ? 'success' : v === 'good' ? 'info' : v === 'average' ? 'warning' : 'danger';
const masteryLabel = (v: string) => MASTERY_LEVELS.find((m) => m.value === v)?.label || v;

export default function FollowUpList() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [detail, setDetail] = useState<FollowUp | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FollowUp | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    load();
  }, [subject, grade]);

  const load = async () => {
    setLoading(true);
    try {
      const params: string[] = [];
      if (subject) params.push('subject=' + encodeURIComponent(subject));
      if (grade) params.push('grade=' + encodeURIComponent(grade));
      const res = await api.get('/followups' + (params.length ? '?' + params.join('&') : ''));
      setItems(res.followups || []);
    } catch (err: any) {
      toast.error('加载失败：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete('/followups/' + deleteTarget.id);
      setItems((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      toast.success('已删除该条回访记录');
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error('删除失败：' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const selectClass =
    'h-9 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none transition-all hover:border-slate-300 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10';

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">回访历史</h1>
          <p className="mt-1 text-sm text-slate-400">共 {items.length} 条回访记录</p>
        </div>
        <Link to="/followups">
          <Button variant="gradient" icon={<Plus className="h-4 w-4" />}>
            新建回访
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader
          title="全部记录"
          description="点击查看完整回访内容"
          icon={<History className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-300" />
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className={selectClass}>
                <option value="">全部学科</option>
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select value={grade} onChange={(e) => setGrade(e.target.value)} className={selectClass}>
                <option value="">全部年级</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        {loading ? (
          <div className="p-5">
            <ListSkeleton rows={4} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<History className="h-7 w-7" />}
            title={subject || grade ? '没有符合条件的记录' : '暂无回访记录'}
            description={subject || grade ? '试试调整筛选条件' : '创建第一条回访，AI 会帮你生成专业反馈'}
            action={
              !subject && !grade && (
                <Link to="/followups">
                  <Button variant="gradient" icon={<Plus className="h-4 w-4" />}>
                    新建回访
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((f) => (
              <div key={f.id} className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-50/70">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-50 to-violet-50 text-sm font-semibold text-brand-600 ring-1 ring-brand-100">
                  {f.studentName?.charAt(0) || '?'}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{f.studentName}</span>
                    <Badge tone={masteryTone(f.mastery)}>{masteryLabel(f.mastery)}</Badge>
                    <Badge tone="brand">{f.subject}</Badge>
                    <span className="text-xs text-slate-400">{f.grade}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{f.topic}</p>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-400">{f.content}</p>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {relativeTime(f.createdAt)}
                    </span>
                    {f.images?.length > 0 && (
                      <span className="flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        {f.images.length} 张图片
                      </span>
                    )}
                    <span>{f.wordCount} 字</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                  {f.studentId && (
                    <Link
                      to={'/students/' + f.studentId}
                      title="查看学生档案"
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Link>
                  )}
                  <button
                    onClick={() => setDetail(f)}
                    title="查看详情"
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(f)}
                    title="删除"
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 详情弹窗 */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title="回访详情"
        description={detail ? detail.studentName + ' · ' + formatDate(detail.createdAt) : ''}
      >
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: '学生', value: detail.studentName },
                { label: '年级', value: detail.grade },
                { label: '学科', value: detail.subject },
                { label: '掌握程度', value: masteryLabel(detail.mastery) },
              ].map((x) => (
                <div key={x.label} className="rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-100">
                  <p className="text-[11px] text-slate-400">{x.label}</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-700">{x.value}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-400">课程主题</p>
              <p className="text-sm font-medium text-slate-700">{detail.topic}</p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-400">课堂表现</p>
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-100">
                {detail.performance}
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-400">
                回访内容 <span className="ml-1 font-normal text-slate-300">{detail.wordCount} 字</span>
              </p>
              <div className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3.5 text-sm leading-[1.9] text-slate-700 ring-1 ring-slate-100">
                {detail.content}
              </div>
            </div>

            {detail.images?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-400">课堂图片</p>
                <div className="grid grid-cols-4 gap-2.5">
                  {detail.images.map((img, i) => (
                    <img
                      key={i}
                      src={'/uploads/' + img}
                      alt={'图片 ' + (i + 1)}
                      className="aspect-square w-full rounded-xl object-cover ring-1 ring-slate-200"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-400">创建于 {detail.createdAt}</p>
              {detail.studentId && (
                <Link to={'/students/' + detail.studentId} onClick={() => setDetail(null)}>
                  <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}>
                    查看学生档案
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title="删除该条回访记录？"
        description={'将删除「' + (deleteTarget?.studentName || '') + '」的这条回访内容，操作不可恢复。'}
        confirmText="删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
