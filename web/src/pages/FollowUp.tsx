import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Sparkles,
  ImagePlus,
  X,
  Wand2,
  Save,
  Check,
  Pencil,
  Copy,
  ClipboardList,
  User,
  UploadCloud,
  AlertCircle,
  MessageSquareText,
} from 'lucide-react';
import { api } from '../api/client';
import { Student, GRADES, SUBJECTS, MASTERY_LEVELS } from '../types/index';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { countWords, copyText, cn } from '../lib/utils';

const MASTERY_TONE: Record<string, string> = {
  excellent: 'data-[on=true]:bg-emerald-500 data-[on=true]:ring-emerald-500',
  good: 'data-[on=true]:bg-brand-600 data-[on=true]:ring-brand-600',
  average: 'data-[on=true]:bg-amber-500 data-[on=true]:ring-amber-500',
  needs_improvement: 'data-[on=true]:bg-red-500 data-[on=true]:ring-red-500',
};

export default function FollowUp() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState({
    studentId: null as number | null,
    studentName: '',
    grade: '小学三年级',
    subject: '数学',
    topic: '',
    performance: '',
    mastery: 'good',
  });
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/students').then((r) => setStudents(r.students || [])).catch(() => {});
  }, []);

  // 生成耗时计时：让用户知道请求在跑，而不是卡死
  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  // URL 预选学生
  useEffect(() => {
    const id = searchParams.get('studentId');
    if (!id || students.length === 0) return;
    const s = students.find((x) => x.id === parseInt(id));
    if (s) pickStudent(String(s.id));
  }, [searchParams, students]);

  const pickStudent = (value: string) => {
    if (!value) {
      setForm((f) => ({ ...f, studentId: null }));
      return;
    }
    const s = students.find((x) => x.id === parseInt(value));
    if (s) {
      setForm((f) => ({ ...f, studentId: s.id, studentName: s.name, grade: s.grade, subject: s.subject }));
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    setUploading(true);
    try {
      let added = 0;
      for (const file of list) {
        const fd = new FormData();
        fd.append('images', file);
        const res = await api.upload('/upload', fd);
        if (res.paths?.length) {
          setImages((prev) => [...prev, ...res.paths]);
          added += res.paths.length;
        }
      }
      if (added) toast.success('已上传 ' + added + ' 张图片');
    } catch (err: any) {
      toast.error('图片上传失败：' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((i) => i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      uploadFiles(files);
    }
  };

  const generate = async () => {
    if (!form.studentName.trim() || !form.topic.trim() || !form.performance.trim()) {
      toast.error('请先填写学生姓名、课程主题和课堂表现');
      return;
    }
    setGenerating(true);
    setRegenerating(false);
    setContent('');
    setDraft('');
    setEditing(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await api.streamPost(
        '/followups/generate/stream',
        { ...form, images },
        {
          onDelta: (text) => setContent((prev) => prev + text),
          onRegenerating: () => {
            setRegenerating(true);
            toast.info('字数不达标，正在重新生成…');
          },
          onDone: ({ content: final, regenerated }) => {
            setContent(final);
            setDraft(final);
            toast.success(regenerated ? '已重新生成并调整字数' : 'AI 生成完成，可编辑后保存');
          },
          onError: (msg) => toast.error(msg),
        },
        controller.signal
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        toast.info('已取消生成');
      } else {
        toast.error(err?.message || '生成失败');
      }
    } finally {
      setGenerating(false);
      setRegenerating(false);
      abortRef.current = null;
    }
  };

  const cancelGenerate = () => {
    abortRef.current?.abort();
  };

  const save = async () => {
    const final = editing ? draft : content;
    if (!final.trim()) return;
    setSaving(true);
    try {
      await api.post('/followups', { ...form, images, content: final });
      toast.success('已保存并归档到学生档案');
      if (form.studentId) {
        setTimeout(() => navigate('/students/' + form.studentId), 900);
      } else {
        setContent('');
        setDraft('');
        setEditing(false);
      }
    } catch (err: any) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    const ok = await copyText(editing ? draft : content);
    ok ? toast.success('已复制回访内容，可直接发送给家长') : toast.error('复制失败，请手动选择文本复制');
  };

  const finalContent = editing ? draft : content;
  const words = countWords(finalContent);
  const wordsOk = words >= 150 && words <= 500;
  const canGenerate = !!form.studentName.trim() && !!form.topic.trim() && !!form.performance.trim();

  const gradeOptions = GRADES.map((g) => ({ value: g, label: g }));
  const subjectOptions = SUBJECTS.map((s) => ({ value: s, label: s }));

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">课后回访</h1>
          <p className="mt-1 text-sm text-slate-400">填写课堂信息，AI 生成规范的课后反馈</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs shadow-soft ring-1 ring-slate-100">
          <Sparkles className="h-3.5 w-3.5 text-brand-500" />
          <span className="font-medium text-slate-600">SenseNova 多模态</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== 左侧：信息录入 ===== */}
        <div className="space-y-6">
          {/* 课堂信息 */}
          <Card>
            <CardHeader
              title="课堂信息"
              description="选择学生可自动填充年级与学科"
              icon={<ClipboardList className="h-4 w-4" />}
            />
            <div className="space-y-4 p-5">
              <Select
                label="选择已有学生"
                value={form.studentId ? String(form.studentId) : ''}
                onChange={(e) => pickStudent(e.target.value)}
                options={students.map((s) => ({
                  value: String(s.id),
                  label: s.name + ' · ' + s.grade + ' ' + s.subject,
                }))}
                placeholder="— 手动输入新学生 —"
              />

              <Input
                label="学生姓名"
                required
                value={form.studentName}
                onChange={(e) => setForm({ ...form, studentName: e.target.value, studentId: null })}
                placeholder="请输入学生姓名"
                icon={<User className="h-4 w-4" />}
              />

              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="年级"
                  value={form.grade}
                  onChange={(e) => setForm({ ...form, grade: e.target.value })}
                  options={gradeOptions}
                />
                <Select
                  label="学科"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  options={subjectOptions}
                />
              </div>

              <Input
                label="课程主题"
                required
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="如：分数加减法运算"
              />

              <Textarea
                label="课堂表现"
                required
                rows={4}
                value={form.performance}
                onChange={(e) => setForm({ ...form, performance: e.target.value })}
                placeholder="如：本节课专注度较高，能主动回答问题，但计算速度还需提高…"
              />

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">
                  掌握程度 <span className="text-red-500">*</span>
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {MASTERY_LEVELS.map((m) => {
                    const on = form.mastery === m.value;
                    return (
                      <button
                        key={m.value}
                        data-on={on}
                        onClick={() => setForm({ ...form, mastery: m.value })}
                        className={cn(
                          'rounded-xl py-2.5 text-sm font-medium ring-1 transition-all duration-200',
                          MASTERY_TONE[m.value],
                          'data-[on=false]:bg-slate-50 data-[on=false]:text-slate-500 data-[on=false]:ring-slate-200',
                          'data-[on=true]:text-white data-[on=true]:shadow-soft',
                          'hover:data-[on=false]:bg-slate-100'
                        )}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {/* 课堂图片 */}
          <Card>
            <CardHeader
              title="课堂图片"
              description="支持粘贴截图、拖拽或点击上传"
              icon={<ImagePlus className="h-4 w-4" />}
              action={images.length > 0 ? <Badge tone="brand">{images.length} 张</Badge> : undefined}
            />
            <div className="p-5">
              <div
                onPaste={onPaste}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all duration-200',
                  dragging
                    ? 'border-brand-400 bg-brand-50/60'
                    : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50/60'
                )}
              >
                {uploading ? (
                  <>
                    <UploadCloud className="mb-2 h-7 w-7 animate-pulse text-brand-400" />
                    <p className="text-sm text-slate-500">上传中…</p>
                  </>
                ) : (
                  <>
                    <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50">
                      <ImagePlus className="h-5 w-5 text-brand-500" />
                    </div>
                    <p className="text-sm font-medium text-slate-600">点击上传或粘贴图片</p>
                    <p className="mt-1 text-xs text-slate-400">支持 JPG / PNG / WebP，单张最大 10MB</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) uploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {images.length > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-2.5">
                  {images.map((img, i) => (
                    <div key={i} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-slate-200">
                      <img
                        src={'/uploads/' + img}
                        alt={'图片 ' + (i + 1)}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <button
                        onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ===== 右侧：AI 生成 ===== */}
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="AI 生成回访"
              description="内容生成后可自由编辑"
              icon={<Wand2 className="h-4 w-4" />}
            />
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge tone="brand">{form.subject}</Badge>
                <Badge tone="neutral">{form.grade}</Badge>
                {form.studentName && <Badge tone="violet">{form.studentName}</Badge>}
                {images.length > 0 && <Badge tone="info">{images.length} 张图片</Badge>}
              </div>

              {!canGenerate && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-xs leading-relaxed text-amber-700">
                    请先填写学生姓名、课程主题和课堂表现，然后即可生成回访内容。
                  </p>
                </div>
              )}

              <Button
                variant="gradient"
                size="lg"
                className="w-full"
                loading={generating}
                disabled={!canGenerate}
                onClick={generate}
                icon={!generating ? <Sparkles className="h-4 w-4" /> : undefined}
              >
                {generating
                  ? 'AI 正在生成… ' + elapsed + 's'
                  : content
                  ? '重新生成'
                  : '生成课后回访内容'}
              </Button>

              {generating && (
                <div className="mt-2 flex items-center justify-center gap-3">
                  <button
                    onClick={cancelGenerate}
                    className="text-xs font-medium text-slate-400 underline-offset-2 transition-colors hover:text-slate-600 hover:underline"
                  >
                    取消生成
                  </button>
                  {elapsed >= 20 && (
                    <span className="text-xs text-amber-600">
                      已 {elapsed} 秒，通常 60 秒内返回
                    </span>
                  )}
                </div>
              )}

              {regenerating && (
                <p className="mt-2 text-center text-xs text-brand-600">
                  首轮字数不达标，正在重新生成…
                </p>
              )}
            </div>
          </Card>

          {/* 生成结果 */}
          {content ? (
            <Card className="animate-fade-up">
              <CardHeader
                title="回访内容"
                description="三段式：课堂内容 · 学生收获 · 课后任务"
                icon={<MessageSquareText className="h-4 w-4" />}
                action={
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                        wordsOk
                          ? 'bg-emerald-50 text-emerald-600 ring-emerald-200'
                          : 'bg-amber-50 text-amber-600 ring-amber-200'
                      )}
                    >
                      {words} 字
                    </span>
                    {!generating && (
                    <>
                    <button
                      onClick={handleCopy}
                      title="复制全文"
                      className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      复制
                    </button>
                    <button
                      onClick={() => setEditing((v) => !v)}
                      className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
                    >
                      {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      {editing ? '完成' : '编辑'}
                    </button>
                    </>
                    )}
                  </div>
                }
              />
              <div className="p-5">
                {!wordsOk && !generating && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-100">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <p className="text-xs text-amber-700">
                      当前 {words} 字，要求 150–500 字。可点击「重新生成」或手动编辑。
                    </p>
                  </div>
                )}

                {generating && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-brand-600">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                    正在生成中，文字会实时出现…
                  </div>
                )}

                {editing ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={16}
                    className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
                  />
                ) : (
                  <div
                    data-testid="generated-content"
                    className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3.5 text-sm leading-[1.9] text-slate-700 ring-1 ring-slate-100"
                  >
                    {content}
                  </div>
                )}

                <Button
                  variant={wordsOk ? 'primary' : 'outline'}
                  size="lg"
                  className="mt-4 w-full"
                  loading={saving}
                  onClick={save}
                  icon={!saving ? <Save className="h-4 w-4" /> : undefined}
                >
                  {saving ? '保存中…' : wordsOk ? '保存并归档到学生档案' : '仍要保存（建议先调整字数）'}
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={generating ? <Sparkles className="h-7 w-7 animate-pulse" /> : <Wand2 className="h-7 w-7" />}
                title={generating ? 'AI 正在撰写回访内容… ' + elapsed + 's' : '等待生成'}
                description={
                  generating
                    ? '正在分析课堂信息与图片，请稍候'
                    : '填写左侧课堂信息后，点击上方按钮生成回访内容'
                }
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
