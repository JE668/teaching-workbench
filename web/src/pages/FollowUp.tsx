import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Share2,
  Camera,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../api/client';
import {
  Student,
  GRADES,
  SUBJECTS,
  MASTERY_LEVELS,
  SESSION_COUNTS,
  COURSE_TYPES,
  CourseType,
} from '../types/index';
import { deriveNickname } from '../lib/nickname';
import {
  loadDraft,
  saveDraft,
  clearDraft,
  PERFORMANCE_PHRASES,
  appendPhrase,
} from '../lib/draft';
import { useDraftSync, DraftPayload } from '../hooks/useDraftSync';
import { usePreferences } from '../hooks/usePreferences';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { countWords, copyText, cn } from '../lib/utils';
import { extractDroppedImages } from '../lib/dropFiles';

const MASTERY_TONE: Record<string, string> = {
  excellent: 'data-[on=true]:bg-emerald-500 data-[on=true]:ring-emerald-500',
  good: 'data-[on=true]:bg-brand-600 data-[on=true]:ring-brand-600',
  average: 'data-[on=true]:bg-amber-500 data-[on=true]:ring-amber-500',
  needs_improvement: 'data-[on=true]:bg-red-500 data-[on=true]:ring-red-500',
};

/** 表单默认值。单独抽出来是为了让状态有明确类型（否则草稿的 `any` 会污染整个 form） */
const DEFAULT_FORM = {
  studentId: null as number | null,
  studentName: '',
  /** 亲切称呼；留空则由姓名自动推导 */
  nickname: '',
  courseType: 'one_on_one' as CourseType,
  grade: '小学三年级',
  subject: '数学',
  topic: '',
  performance: '',
  mastery: 'good',
  sessionCount: 1,
};

type FormState = typeof DEFAULT_FORM;

export default function FollowUp() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // 从本地草稿恢复（切到微信再回来不会白填一场）
  const restored = useMemo(() => loadDraft(), []);

  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState<FormState>(() => ({
    ...DEFAULT_FORM,
    ...((restored?.form || {}) as Partial<FormState>),
  }));
  /** 小组课选中的学生 id */
  const [selectedIds, setSelectedIds] = useState<number[]>(() => restored?.selectedIds || []);
  /** 从自己历史里学到的常用主题与短语 */
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [historyPhrases, setHistoryPhrases] = useState<string[]>([]);
  /** 保存后不跳转，继续写下一个 */
  const [keepGoing, setKeepGoing] = useState(false);
  /** 小组课分组预设 */
  const [groups, setGroups] = useState<{ id: number; name: string; studentIds: number[]; memberCount: number }[]>([]);
  const [showGroupSave, setShowGroupSave] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [images, setImages] = useState<string[]>(() => restored?.images || []);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [content, setContent] = useState(() => restored?.content || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => restored?.draft || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/students').then((r) => setStudents(r.students || [])).catch(() => {});
  }, []);

  // 分组预设（小组课用）
  useEffect(() => {
    api
      .get('/groups')
      .then((r) => setGroups(r.groups || []))
      .catch(() => {
        /* 分组只是便利功能，失败静默 */
      });
  }, []);

  // 历史联想：选中的学生有历史就用它的，否则用全局（新学生也有词可用）
  useEffect(() => {
    const q = form.studentId ? '?studentId=' + form.studentId : '';
    api
      .get('/followups/suggestions' + q)
      .then((r) => {
        setSuggestedTopics((r.topics || []).map((t: any) => t.text));
        setHistoryPhrases((r.phrases || []).map((p: any) => p.text));
      })
      .catch(() => {
        /* 建议只是锦上添花，失败静默 */
      });
  }, [form.studentId]);

  // ===== 跨设备实时同步 =====
  // 电脑写文案 / 手机拍图上传来图，两边无需刷新即可看到
  const applyRemote = useCallback(
    (remote: DraftPayload, skipFields: string[]) => {
      if (remote.form) {
        setForm((prev) => {
          const next: FormState = { ...prev };
          for (const [key, value] of Object.entries(remote.form)) {
            // 正在输入 / 刚改过的字段不覆盖，避免打断
            if (skipFields.includes(key)) continue;
            (next as any)[key] = value;
          }
          return next;
        });
      }
      if (Array.isArray(remote.images) && !skipFields.includes('images')) setImages(remote.images);
      if (Array.isArray(remote.selectedIds) && !skipFields.includes('selectedIds')) {
        setSelectedIds(remote.selectedIds);
      }
      if (typeof remote.content === 'string' && !skipFields.includes('content')) setContent(remote.content);
      if (typeof remote.draft === 'string' && !skipFields.includes('draft')) setDraft(remote.draft);
    },
    []
  );

  const onRemoteCleared = useCallback(() => {
    toast.info('另一台设备已归档，草稿已清空');
  }, [toast]);

  // 快捷短语模式（服务端偏好，两端一致）
  const { preferences, update: updatePreferences } = usePreferences();

  const draftPayload: DraftPayload = { form, images, selectedIds, content, draft };

  const { connected, peerCount, markLocalEdit, clearRemote } = useDraftSync({
    state: draftPayload,
    applyRemote,
    onRemoteCleared,
  });

  // 草稿持久化：切到微信再回来（甚至标签页被重载）都能续上
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft({ form, images, selectedIds, content, draft });
    }, 300); // 防抖，避免每次按键都写
    return () => clearTimeout(timer);
  }, [form, images, selectedIds, content, draft]);

  // 恢复过草稿就告诉用户一声，避免"我明明没填怎么有内容"的困惑
  const restoredNotified = useRef(false);
  useEffect(() => {
    if (restoredNotified.current) return;
    restoredNotified.current = true;

    const hasSomething =
      !!restored?.content || !!restored?.form?.topic || !!restored?.form?.studentName;
    if (hasSomething) {
      toast.info('已恢复上次未保存的内容');
    }
  }, [restored]);

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

  /** 切换课程类型：两种模式的学生选择互不干扰，切换时清空避免脏数据 */
  const switchCourseType = (courseType: CourseType) => {
    if (courseType === form.courseType) return;
    setForm((prev) => ({ ...prev, courseType, studentId: null, studentName: '' }));
    setSelectedIds([]);
  };

  /** 应用分组：默认全选，老师再手动取消请假的 */
  const applyGroup = (g: { studentIds: number[] }) => {
    setSelectedIds(g.studentIds);
  };

  const saveGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error('请填写分组名称');
      return;
    }
    if (selectedIds.length === 0) {
      toast.error('请先选择学生，再存为分组');
      return;
    }

    try {
      const r = await api.post('/groups', { name, studentIds: selectedIds });
      setGroups((prev) => [r.group, ...prev]);
      setNewGroupName('');
      setShowGroupSave(false);
      toast.success('已保存分组「' + name + '」');
    } catch (err: any) {
      toast.error('保存分组失败：' + err.message);
    }
  };

  const deleteGroup = async (id: number, name: string) => {
    try {
      await api.delete('/groups/' + id);
      setGroups((prev) => prev.filter((x) => x.id !== id));
      toast.success('已删除分组「' + name + '」');
    } catch (err: any) {
      toast.error('删除分组失败：' + err.message);
    }
  };

  const toggleStudent = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const uploadFiles = async (files: FileList | File[], source: 'drop' | 'paste' | 'picker' = 'picker') => {
    const list = Array.from(files);

    if (list.length === 0) {
      // 关键：不能静默失败。用户拖了图却什么都没发生，会以为是坏了。
      toast.error(
        source === 'drop'
          ? '没有从拖拽中识别到图片，请改用「点击上传」或直接粘贴（Ctrl/⌘+V）'
          : '没有识别到图片'
      );
      return;
    }

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
    const items = Array.from(e.clipboardData?.items || []);

    // 先走标准路径（截图粘贴）
    const files = items
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);

    if (files.length) {
      e.preventDefault();
      uploadFiles(files, 'paste');
      return;
    }

    // 兜底：某些应用粘贴的是含 data: 图片的 HTML
    const dt = e.clipboardData as unknown as DataTransfer | undefined;
    if (dt) {
      const { files: fromHtml } = extractDroppedImages(dt);
      if (fromHtml.length) {
        e.preventDefault();
        uploadFiles(fromHtml, 'paste');
      }
    }
  };

  const isGroup = form.courseType === 'group';

  const generate = async () => {
    if (!form.topic.trim() || !form.performance.trim()) {
      toast.error('请先填写课程主题和课堂表现');
      return;
    }
    // 1对1 需要学生；小组课需要至少选一名学生
    if (!isGroup && !form.studentName.trim()) {
      toast.error('请填写学生姓名');
      return;
    }
    if (isGroup && selectedIds.length === 0) {
      toast.error('小组课请至少选择一名学生');
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
        { ...form, nickname: form.nickname || deriveNickname(form.studentName), images },
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
      const payload: any = {
        ...form,
        nickname: form.nickname || deriveNickname(form.studentName),
        images,
        content: final,
      };

      // 小组课：把选中学生一并提交，服务端为每人各存一条
      if (isGroup) {
        payload.studentIds = selectedIds;
        payload.studentName = '';
        payload.studentId = null;
      }

      const res = await api.post('/followups', payload);

      // 已归档，草稿使命结束（本地 + 服务端，后者会通知另一台设备）
      clearDraft();
      clearRemote();

      if (isGroup) {
        toast.success('已为 ' + selectedIds.length + ' 位学生各归档一条回访');
      } else {
        toast.success('已保存并归档到学生档案');
      }

      // 自动建档 / 历史归位的告知
      if (res?.createdStudent) {
        toast.info('学生库中没有「' + form.studentName + '」，已自动为其建立档案');
      }
      if (res?.backfilled > 0) {
        toast.info('已把 ' + res.backfilled + ' 条同名历史回访归入该学生档案');
      }

      // 清掉刚提交的内容，为"继续下一个"或跳转做准备
      setContent('');
      setDraft('');
      setEditing(false);
      setImages([]);

      if (keepGoing) {
        // 留在本页继续写：保留年级/学科/课程类型/课次，清掉学生与内容
        setForm((prev) => ({
          ...prev,
          studentId: null,
          studentName: '',
          nickname: '',
          topic: '',
          performance: '',
        }));
        setSelectedIds([]);
        toast.info('已归档，可以继续填下一个学生');
        return;
      }

      // 跳转：小组课去第一个学生档案，1对1 去对应学生档案
      const targetId = isGroup ? selectedIds[0] : form.studentId || res?.followup?.studentId;
      if (targetId) {
        setTimeout(() => navigate('/students/' + targetId), 1200);
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

  /** 手机上直接拉起系统分享面板 → 微信，省掉"复制→切微信→找会话" */
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleShare = async () => {
    const text = editing ? draft : content;
    if (!text.trim()) return;
    try {
      await navigator.share({ title: '课后回访', text });
    } catch (err: any) {
      // 用户取消（AbortError）不算失败，不打扰
      if (err?.name !== 'AbortError') {
        toast.error('分享失败，可改用复制');
      }
    }
  };

  /**
   * 快捷短语：历史学到的用词优先，内置通用词按用户偏好决定是否参与。
   * 放在渲染前算好——内联 IIFE 会让作用域和 JSX 结构都变乱。
   */
  const mergedPhrases = (() => {
    const seen = new Set<string>();
    const list: { text: string; tone: 'good' | 'warn' }[] = [];

    for (const t of historyPhrases) {
      if (seen.has(t)) continue;
      seen.add(t);
      list.push({ text: t, tone: 'good' });
    }

    if (preferences.phraseMode === 'mixed') {
      for (const p of PERFORMANCE_PHRASES) {
        if (seen.has(p.text)) continue;
        seen.add(p.text);
        list.push(p);
      }
    }

    return list.slice(0, 18);
  })();

  /** 触屏设备：拖拽和快捷键粘贴都不适用，改用拍照/相册入口 */
  const isTouch =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

  const finalContent = editing ? draft : content;
  const words = countWords(finalContent);
  const wordsOk = words >= 150 && words <= 500;
  const canGenerate =
    !!form.topic.trim() &&
    !!form.performance.trim() &&
    (isGroup ? selectedIds.length > 0 : !!form.studentName.trim());

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
        <div className="flex flex-wrap items-center gap-2">
          {/* 跨设备同步状态：让用户知道"手机上传的图会不会自动出现" */}
          <div
            data-testid="sync-status"
            title={
              peerCount > 0
                ? '另一台设备也在编辑，改动会实时同步'
                : '已连接，在手机上打开同一地址即可实时联动'
            }
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs shadow-soft ring-1',
              !connected
                ? 'bg-slate-50 text-slate-400 ring-slate-100'
                : peerCount > 0
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-white text-slate-500 ring-slate-100'
            )}
          >
            {connected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            <span className="font-medium">
              {!connected
                ? '同步已断开'
                : peerCount > 0
                ? '已连接 ' + peerCount + ' 台设备'
                : '跨设备同步中'}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs shadow-soft ring-1 ring-slate-100">
            <Sparkles className="h-3.5 w-3.5 text-brand-500" />
            <span className="font-medium text-slate-600">SenseNova 多模态</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== 左侧：信息录入 ===== */}
        <div className="space-y-6">
          {/* 课堂信息 */}
          <Card>
            <CardHeader
              title="课堂信息"
              description={
                isGroup
                  ? '小组课文案不含学生姓名，可一次归档给多名学生'
                  : '选择学生可自动填充年级与学科'
              }
              icon={<ClipboardList className="h-4 w-4" />}
            />
            <div className="space-y-4 p-5">
              {/* 课程类型 */}
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">课程类型</p>
                <div className="grid grid-cols-2 gap-2">
                  {COURSE_TYPES.map((c) => {
                    const on = form.courseType === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => switchCourseType(c.value)}
                        className={cn(
                          'rounded-xl py-2.5 text-sm font-medium ring-1 transition-all duration-200',
                          on
                            ? 'bg-brand-600 text-white ring-brand-600 shadow-soft'
                            : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100'
                        )}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {COURSE_TYPES.find((c) => c.value === form.courseType)?.hint}
                </p>
              </div>

              {isGroup ? (
                /* ===== 小组课：多选学生 ===== */
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">
                      选择学生 <span className="text-red-500">*</span>
                    </p>
                    <span data-testid="selected-count" className="text-xs text-slate-400">
                      已选 <span className="font-semibold text-brand-600">{selectedIds.length}</span> 人
                    </span>
                  </div>

                  {/* 分组预设：一键全选，再手动取消请假的 */}
                  {students.length > 0 && (
                    <div className="mb-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {groups.map((g) => (
                          <span
                            key={g.id}
                            className="group inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200"
                          >
                            <button
                              type="button"
                              onClick={() => applyGroup(g)}
                              title={'全选「' + g.name + '」的 ' + g.memberCount + ' 人'}
                            >
                              {g.name}
                              <span className="ml-1 text-brand-500">{g.memberCount} 人</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteGroup(g.id, g.name)}
                              title="删除该分组"
                              className="rounded-full p-0.5 text-brand-400 transition-colors hover:bg-brand-200 hover:text-brand-800"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}

                        {!showGroupSave && (
                          <button
                            type="button"
                            onClick={() => setShowGroupSave(true)}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200"
                          >
                            ＋ 存为分组
                          </button>
                        )}
                      </div>

                      {showGroupSave && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            autoFocus
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveGroup();
                              if (e.key === 'Escape') setShowGroupSave(false);
                            }}
                            placeholder="如：周六上午三年级班"
                            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
                          />
                          <button
                            type="button"
                            onClick={saveGroup}
                            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                          >
                            保存（{selectedIds.length} 人）
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowGroupSave(false);
                              setNewGroupName('');
                            }}
                            className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600"
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {students.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-400">
                      还没有学生，请先到「学生管理」添加
                    </p>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                      {students.map((s) => {
                        const on = selectedIds.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleStudent(s.id)}
                            aria-pressed={on}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                              on ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-white'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                                on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                              )}
                            >
                              {on && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-700">{s.name}</span>
                              <span className="block truncate text-[11px] text-slate-400">
                                {s.grade} · {s.subject}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    小组课文案不含任何学生姓名，保存时会为每位选中的学生各归档一条相同内容。
                    有分组时点一下即全选，再取消请假的同学即可。
                  </p>
                </div>
              ) : (
                /* ===== 1对1：单个学生 ===== */
                <>
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
                    data-sync-field="studentName"
                    value={form.studentName}
                    onChange={(e) => {
                      markLocalEdit('studentName');
                      setForm({ ...form, studentName: e.target.value, studentId: null });
                    }}
                    placeholder="请输入学生姓名（库中没有会自动建立档案）"
                    icon={<User className="h-4 w-4" />}
                  />

                  <Input
                    label="亲切称呼"
                    data-sync-field="nickname"
                    value={form.nickname}
                    onChange={(e) => {
                      markLocalEdit('nickname');
                      setForm({ ...form, nickname: e.target.value });
                    }}
                    placeholder={
                      form.studentName.trim()
                        ? deriveNickname(form.studentName) || '请输入称呼'
                        : '填了姓名后自动生成，如「一一」'
                    }
                    hint="文案里会这样称呼学生，留空则自动取名字后两字"
                  />
                </>
              )}

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

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">本次回访涵盖</p>
                <div className="grid grid-cols-3 gap-2">
                  {SESSION_COUNTS.map((n) => {
                    const on = form.sessionCount === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setForm({ ...form, sessionCount: n })}
                        className={cn(
                          'rounded-xl py-2.5 text-sm font-medium ring-1 transition-all duration-200',
                          on
                            ? 'bg-brand-600 text-white ring-brand-600 shadow-soft'
                            : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100'
                        )}
                      >
                        {n} 次课
                      </button>
                    );
                  })}
                </div>
                {form.sessionCount > 1 && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    将把最近 {form.sessionCount} 次课作为一个阶段整体反馈。
                    课程内容可填这几次课的主题合集（如「分数加减法、分数乘法」）。
                  </p>
                )}
              </div>

              <Input
                label={form.sessionCount > 1 ? '课程内容（这几次课）' : '课程主题'}
                required
                data-sync-field="topic"
                list="topic-suggestions"
                value={form.topic}
                onChange={(e) => {
                  markLocalEdit('topic');
                  setForm({ ...form, topic: e.target.value });
                }}
                placeholder={
                  form.sessionCount > 1 ? '如：分数加减法、分数乘法' : '如：分数加减法运算'
                }
              />

              {/* 历史主题联想：一个学期就那些主题，不用重复打 */}
              <datalist id="topic-suggestions">
                {suggestedTopics.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>

              <div>
                <Textarea
                  label="课堂表现"
                  required
                  rows={4}
                  data-sync-field="performance"
                  value={form.performance}
                  onChange={(e) => {
                    markLocalEdit('performance');
                    setForm({ ...form, performance: e.target.value });
                  }}
                  placeholder="如：本节课专注度较高，能主动回答问题，但计算速度还需提高…"
                />

                {/* 手机上敲中文很慢，常用描述点一下即可插入 */}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    常用短语{historyPhrases.length > 0 ? '（含你历史里的用词）' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updatePreferences({
                        phraseMode: preferences.phraseMode === 'mixed' ? 'history_only' : 'mixed',
                      })
                    }
                    title={
                      preferences.phraseMode === 'mixed'
                        ? '当前：历史用词 + 内置通用词。点击改为只用历史'
                        : '当前：只用你的历史用词。点击恢复内置通用词'
                    }
                    className="text-xs text-slate-400 underline-offset-2 transition-colors hover:text-brand-600 hover:underline"
                  >
                    {preferences.phraseMode === 'mixed' ? '含内置通用词' : '仅用我的历史'}
                  </button>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {mergedPhrases.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      还没有历史记录 —— 写过几条回访后，会自动学会你的常用用词
                    </p>
                  ) : (
                    mergedPhrases.map((p) => {
                      const active = form.performance.includes(p.text);
                      return (
                        <button
                          key={p.text}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setForm({ ...form, performance: appendPhrase(form.performance, p.text) })
                          }
                          className={cn(
                            'rounded-full px-2.5 py-1 text-xs ring-1 transition-colors',
                            active
                              ? p.tone === 'good'
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                : 'bg-amber-50 text-amber-700 ring-amber-200'
                              : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                          )}
                        >
                          {p.text}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

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
                data-testid="dropzone"
                onPaste={onPaste}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);

                  // 必须在事件内同步提取：事件结束后 dataTransfer 会被清空
                  const { files, debug } = extractDroppedImages(e.dataTransfer);

                  if (import.meta.env.DEV) {
                    console.debug('[drop]', debug);
                  }

                  uploadFiles(files, 'drop');
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
                    <p className="text-sm font-medium text-slate-600">
                      {isTouch ? '拍照或从相册选择' : '点击上传或粘贴图片'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">支持 JPG / PNG / WebP，单张最大 10MB</p>
                  </>
                )}

                {/* 手机端：直接调起相机拍作业，省掉"先拍照再选图" */}
                {isTouch && (
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cameraRef.current?.click();
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      拍照
                    </button>
                  </div>
                )}

                <input
                  ref={fileRef}
                  data-testid="file-input"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) uploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                {/* capture=environment 让手机直接开后置摄像头 */}
                <input
                  ref={cameraRef}
                  data-testid="camera-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) uploadFiles(e.target.files, 'picker');
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
                    {/* 手机：直接拉起系统分享 → 微信，省掉找会话的步骤与贴错人的风险 */}
                    {canShare && (
                      <button
                        onClick={handleShare}
                        title="分享到微信等应用"
                        className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 transition-colors hover:bg-brand-100"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        分享
                      </button>
                    )}
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

                {/* 一天补写多份时，省掉"跳转→返回"的往返 */}
                <label className="mt-2.5 flex cursor-pointer items-center justify-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={keepGoing}
                    onChange={(e) => setKeepGoing(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  保存后继续填下一个学生（不跳转）
                </label>
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
