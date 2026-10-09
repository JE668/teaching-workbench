import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Users,
  Pencil,
  Trash2,
  FolderOpen,
  Phone,
  StickyNote,
  UserPlus,
} from 'lucide-react';
import { api } from '../api/client';
import { Student, GRADES, SUBJECTS } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Input, Select, Textarea } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { formatDate, cn } from '../lib/utils';

const emptyForm = { name: '', grade: '小学一年级', subject: '数学', phone: '', notes: '' };

export default function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    load();
  }, []);

  // 搜索防抖。
  // 注意：必须跳过首轮执行 —— 否则挂载 300ms 后会再拉一次列表，
  // 既产生一次多余请求，又会把期间的新增/编辑结果覆盖掉。
  const skipInitialSearch = useRef(true);
  useEffect(() => {
    if (skipInitialSearch.current) {
      skipInitialSearch.current = false;
      return;
    }

    const t = setTimeout(() => {
      if (keyword.trim()) search(keyword.trim());
      else load();
    }, 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const load = async () => {
    try {
      const res = await api.get('/students');
      setStudents(res.students || []);
    } catch (err: any) {
      toast.error('加载学生失败：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const search = async (kw: string) => {
    try {
      const res = await api.get('/students/search?keyword=' + encodeURIComponent(kw));
      setStudents(res.students || []);
    } catch (err: any) {
      toast.error('搜索失败：' + err.message);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    setForm({
      name: s.name,
      grade: s.grade,
      subject: s.subject,
      phone: s.phone || '',
      notes: s.notes || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('请填写学生姓名');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await api.put('/students/' + editing.id, form);
        setStudents((prev) => prev.map((s) => (s.id === res.student.id ? res.student : s)));
        toast.success('学生信息已更新');
        // 改名后也可能归位历史回访（老师一开始名字打错了）
        if (res.linkedFollowUps > 0) {
          toast.info('已把 ' + res.linkedFollowUps + ' 条同名历史回访归入该学生档案');
        }
      } else {
        const res = await api.post('/students', form);
        setStudents((prev) => [res.student, ...prev]);
        toast.success('学生添加成功');

        // 老师可能"先写回访、后建档案"：建档时同名历史回访会被自动归位
        if (res.linkedFollowUps > 0) {
          toast.info('已把 ' + res.linkedFollowUps + ' 条同名历史回访归入该学生档案');
        }
        if (res.skippedAmbiguous > 0) {
          toast.info('有同名学生的历史回访无法确定归属，未自动关联');
        }
      }
      setModalOpen(false);
    } catch (err: any) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete('/students/' + deleteTarget.id);
      setStudents((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      toast.success('已删除学生「' + deleteTarget.name + '」');
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error('删除失败：' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const gradeOptions = GRADES.map((g) => ({ value: g, label: g }));
  const subjectOptions = SUBJECTS.map((s) => ({ value: s, label: s }));

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">学生管理</h1>
          <p className="mt-1 text-sm text-slate-400">共 {students.length} 名学生</p>
        </div>
        <Button variant="gradient" icon={<UserPlus className="h-4 w-4" />} onClick={openCreate}>
          添加学生
        </Button>
      </div>

      <Card>
        <CardHeader
          title="学生列表"
          description="点击姓名查看完整档案与回访记录"
          icon={<Users className="h-4 w-4" />}
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索姓名 / 学科 / 年级"
                className="h-9 w-60 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
              />
            </div>
          }
        />

        {loading ? (
          <div className="p-5">
            <ListSkeleton rows={5} />
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={keyword ? '没有找到匹配的学生' : '还没有学生'}
            description={keyword ? '试试其他关键词' : '添加第一位学生，开始记录学习成长'}
            action={
              !keyword && (
                <Button variant="gradient" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  添加学生
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">学生</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">学科</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">联系方式</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">备注</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">建档</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {students.map((s) => (
                  <tr key={s.id} className="group transition-colors hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <Link to={'/students/' + s.id} className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-50 to-violet-50 text-sm font-semibold text-brand-600 ring-1 ring-brand-100">
                          {s.name?.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-700 transition-colors group-hover:text-brand-600">
                            {s.name}
                          </p>
                          <p className="text-[11px] text-slate-400">{s.grade}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone="brand">{s.subject}</Badge>
                    </td>
                    <td className="px-6 py-4">
                      {s.phone ? (
                        <span className="flex items-center gap-1.5 text-sm text-slate-600">
                          <Phone className="h-3.5 w-3.5 text-slate-300" />
                          {s.phone}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="max-w-[200px] px-6 py-4">
                      {s.notes ? (
                        <span className="flex items-center gap-1.5 text-sm text-slate-500">
                          <StickyNote className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                          <span className="truncate">{s.notes}</span>
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{formatDate(s.createdAt)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                        <Link
                          to={'/students/' + s.id}
                          title="查看档案"
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => openEdit(s)}
                          title="编辑"
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(s)}
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

      {/* 添加 / 编辑 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑学生' : '添加学生'}
        description={editing ? '修改学生基本信息' : '填写学生的基本信息'}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              {editing ? '保存修改' : '添加'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="姓名"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="请输入学生姓名"
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="年级"
              required
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              options={gradeOptions}
            />
            <Select
              label="学科"
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              options={subjectOptions}
            />
          </div>
          <Input
            label="联系电话"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="选填，便于家长沟通"
          />
          <Textarea
            label="备注"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="学习特点、薄弱环节等"
          />
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={'删除学生「' + (deleteTarget?.name || '') + '」？'}
        description="删除后该学生信息将无法恢复，已归档的回访记录会保留。"
        confirmText="删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
