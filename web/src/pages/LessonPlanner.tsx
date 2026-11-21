import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CopyPlus,
  Layers,
  Lightbulb,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { Input, Select, Textarea } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';

/**
 * AI 备课助手。
 *
 * 一节课的教案不是凭空写出来的：上月的规划说了要讲什么，学生画像说明了谁会卡在哪，
 * 教材目录给出章节和重难点，翻翻这个学生同章节的历史教案才知道上次讲到哪儿。
 * 这里把这些材料喂给模型，产出按周拆好的结构化教案，老师逐周改完再确认。
 */

interface StudentOption { id: number; name: string; grade: string; subject: string }

interface CourseOption { id: number; term: string; grade: string; subject: string; content: string; section: string }

interface LessonActivity {
  name: string;
  duration_minutes: number;
  teacher_activity: string;
  student_activity: string;
}

interface LessonExercise { question: string; answer: string; difficulty: string }

interface LayeredHomework { basic: string[]; advanced: string[]; challenge: string[] }

interface PresetQuestion { question: string; expected_answer: string; follow_up: string }

interface EvaluationRubric {
  criterion: string;
  excellent: string;
  meets_expectations: string;
  needs_improvement: string;
}

interface WeeklyLessonPlan {
  week: number;
  title: string;
  objectives: string[];
  key_points: string[];
  difficult_points: string[];
  materials: string[];
  activities: LessonActivity[];
  exercises: LessonExercise[];
  layered_homework: LayeredHomework;
  preset_questions: PresetQuestion[];
  blackboard_design: string[];
  evaluation_rubric: EvaluationRubric[];
  reflection_prompts: string[];
}

interface LessonPlanDocument { month: string; weekly_lesson_plans: WeeklyLessonPlan[] }

interface LessonPlanRecord {
  id: number;
  userId: number;
  /** 组内列表由服务端标注；生成、详情和克隆结果均属于当前用户。 */
  isMine?: boolean;
  studentId: number | null;
  courseId: number | null;
  studentName: string | null;
  courseTitle: string | null;
  title: string;
  month: string;
  durationMinutes: number;
  weekCount: number;
  requirements: string;
  status: 'draft' | 'confirmed';
  confirmedAt: string | null;
  plan: LessonPlanDocument;
  provider: string;
  model: string;
  modelMetadata: {
    provider?: string;
    model?: string;
    promptVersion?: string;
    usedFallback?: boolean;
    latencyMs?: number;
    fallbackReason?: string;
  };
  createdAt: string;
  updatedAt: string;
}

const LAYER_LABELS: Array<{ key: keyof LayeredHomework; label: string; tone: string }> = [
  { key: 'basic', label: '基础层', tone: 'text-emerald-600' },
  { key: 'advanced', label: '提高层', tone: 'text-sky-600' },
  { key: 'challenge', label: '挑战层', tone: 'text-violet-600' },
];

function currentMonth(): string {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function formatTime(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
  return String(raw).slice(0, 16);
}

function floorMinutes(n: number): number {
  return Math.max(1, Math.floor(Number(n) || 0));
}

/**
 * 计划时长与活动时长之和的偏差。
 * 「45 分钟的课写了 70 分钟活动」意味着课上不全，反过来留白又太多，两个方向都得提示。
 */
function activityMinutes(activities: LessonActivity[]): number {
  return activities.reduce((sum, a) => sum + (Number(a.duration_minutes) || 0), 0);
}
function CardListEditor({
  label,
  items,
  onChange,
  icon,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  icon?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        {icon}
        {label}
      </p>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <span className="mt-2.5 w-4 shrink-0 text-right text-[11px] text-slate-300">{index + 1}</span>
            <textarea
              className="min-h-[34px] w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
              rows={Math.max(1, Math.ceil(item.length / 42))}
              value={item}
              placeholder={placeholder}
              onChange={(event) => {
                const next = items.slice();
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              className="mt-1.5 shrink-0 text-slate-300 hover:text-red-500"
              aria-label={'删除' + label}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-1.5 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
        onClick={() => onChange([...items, ''])}
      >
        <Plus className="h-3.5 w-3.5" />
        添加
      </button>
    </div>
  );
}

/** 折行显示一行周摘要 */
function WeekSummaryRow({
  week,
  planMinutes,
  open,
  onToggle,
}: {
  week: WeeklyLessonPlan;
  planMinutes: number;
  open: boolean;
  onToggle: () => void;
}) {
  const minutes = activityMinutes(week.activities);
  const diff = minutes - planMinutes;
  const homeworks = week.layered_homework;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition',
        open ? 'bg-brand-50/60' : 'bg-white hover:bg-slate-50/70'
      )}
    >
      <Target className="h-4 w-4 shrink-0 text-brand-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800">
          第 {week.week} 周 · {week.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
          <span>{week.objectives.length} 个目标</span>
          <span>{week.activities.length} 个活动</span>
          <span>{homeworks.basic.length + homeworks.advanced.length + homeworks.challenge.length} 道作业</span>
          <span>{week.preset_questions.length} 个预设提问</span>
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
          diff === 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
        )}
      >
        {minutes}/{planMinutes} 分
        {diff !== 0 && (diff > 0 ? ' 超' : ' 差') + Math.abs(diff)}
      </span>
      <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
    </button>
  );
}

export default function LessonPlanner() {
  const { success, error: showError } = useToast();

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [plans, setPlans] = useState<LessonPlanRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [studentId, setStudentId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [durationMinutes, setDurationMinutes] = useState('45');
  const [weekCount, setWeekCount] = useState('4');
  const [requirements, setRequirements] = useState('');

  const [searchParams] = useSearchParams();
  const requestedPlanId = Number(searchParams.get('planId')) || null;
  const autoOpenedPlan = useRef(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<LessonPlanRecord | null>(null);
  const [openWeek, setOpenWeek] = useState<number | null>(1);
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [saving, setSaving] = useState(false);
  const [listScope, setListScope] = useState<'mine' | 'group'>('mine');
  const [cloneStudentId, setCloneStudentId] = useState('');
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [studentRes, courseRes] = await Promise.all([
          api.request<{ students?: StudentOption[] }>('/students'),
          api.request<{ courses?: CourseOption[] }>('/catalog/courses'),
        ]);
        if (cancelled) return;
        setStudents(studentRes.students || []);
        setCourses(courseRes.courses || []);
      } catch (error: any) {
        if (!cancelled) showError('加载学生/教材目录失败：' + error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showError]);

  const loadPlans = useCallback(async () => {
    setListLoading(true);
    try {
      const scopeQuery = listScope === 'group' ? '&scope=group' : '';
      const res = await api.request<{ plans: LessonPlanRecord[]; total: number }>('/lesson-plans?limit=50' + scopeQuery);
      setPlans(res.plans || []);
    } catch (error: any) {
      showError('加载教案失败：' + error.message);
    } finally {
      setListLoading(false);
    }
  }, [showError, listScope]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (autoOpenedPlan.current || !requestedPlanId) return;
    const requested = plans.find((plan) => plan.id === requestedPlanId);
    if (!requested) return;
    autoOpenedPlan.current = true;
    setSelectedId(requested.id);
    setDraft(requested);
    setOpenWeek(requested.plan.weekly_lesson_plans[0]?.week ?? 1);
  }, [plans, requestedPlanId]);

  const studentOptions = useMemo(
    () => students.map((s) => ({ value: String(s.id), label: s.name + '（' + s.grade + s.subject + '）' })),
    [students]
  );
  const courseOptions = useMemo(
    () => courses.map((c) => ({ value: String(c.id), label: c.term + ' ' + c.content })),
    [courses]
  );

  const generate = async () => {
    setGenerating(true);
    try {
      const response = await api.request<{ plan: LessonPlanRecord }>('/lesson-plans/generate', {
        method: 'POST',
        body: JSON.stringify({
          studentId: studentId ? Number(studentId) : null,
          courseId: courseId ? Number(courseId) : null,
          month,
          durationMinutes: Number(durationMinutes),
          weekCount: Number(weekCount),
          requirements: requirements.trim(),
        }),
      });
      const plan = response.plan;
      setSelectedId(plan.id);
      setDraft(plan);
      setOpenWeek(1);
      success(
        plan.modelMetadata?.usedFallback
          ? '已用本地模板生成备课框架（AI 暂不可用），请自行补充细节'
          : '教案已生成，确认前可逐周修改'
      );
      await loadPlans();
    } catch (error: any) {
      showError('生成教案失败：' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const select = (record: LessonPlanRecord) => {
    setSelectedId(record.id);
    setDraft(record);
    setOpenWeek(record.plan.weekly_lesson_plans[0]?.week ?? 1);
  };

  const updateWeek = (index: number, patch: Partial<WeeklyLessonPlan>) => {
    if (draft?.isMine === false) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const weeks = prev.plan.weekly_lesson_plans.slice();
      weeks[index] = { ...weeks[index], ...patch };
      return { ...prev, plan: { ...prev.plan, weekly_lesson_plans: weeks } };
    });
  };

  const save = async (status?: 'draft' | 'confirmed') => {
    if (!draft) return;
    if (draft.isMine === false) {
      showError('组内教案为只读，请先克隆为自己的草稿再编辑');
      return;
    }
    setSaving(true);
    try {
      const response = await api.request<{ plan: LessonPlanRecord }>('/lesson-plans/' + draft.id, {
        method: 'PUT',
        body: JSON.stringify({
          title: draft.title,
          durationMinutes: draft.durationMinutes,
          requirements: draft.requirements,
          ...(status ? { status } : {}),
          plan: draft.plan,
        }),
      });
      const plan = response.plan;
      setDraft(plan);
      await loadPlans();
      success(status === 'confirmed' ? '已确认，备课完成' : '已保存');
    } catch (error: any) {
      showError('保存教案失败：' + error.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const ownStudentId = draft?.studentId && students.some((student) => student.id === draft.studentId)
      ? String(draft.studentId)
      : '';
    setCloneStudentId(ownStudentId);
  }, [draft?.id, draft?.studentId, students]);

  const cloneDraft = async () => {
    if (!draft) return;
    setCloning(true);
    try {
      const response = await api.request<{ plan: LessonPlanRecord }>(`/lesson-plans/${draft.id}/clone`, {
        method: 'POST',
        body: JSON.stringify({ studentId: cloneStudentId ? Number(cloneStudentId) : null }),
      });
      setDraft(response.plan);
      setSelectedId(response.plan.id);
      setOpenWeek(response.plan.plan.weekly_lesson_plans[0]?.week ?? 1);
      success('已克隆为我的草稿，原教案和确认状态未改动');
      if (listScope === 'mine') await loadPlans();
      else setListScope('mine');
    } catch (error: any) {
      showError('克隆教案失败：' + error.message);
    } finally {
      setCloning(false);
    }
  };

  const remove = async () => {
    if (!draft) return;
    if (draft.isMine === false) {
      showError('不能删除其他教师的教案');
      return;
    }
    try {
      await api.request('/lesson-plans/' + draft.id, { method: 'DELETE' });
      success('已删除');
      setDraft(null);
      setSelectedId(null);
      await loadPlans();
    } catch (error: any) {
      showError('删除教案失败：' + error.message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="备课参数"
          description="按上周规划、学生画像、教材章节与历史教案备课"
          icon={<Sparkles className="h-4 w-4" />}
        />
        <div className="grid gap-3 p-5 md:grid-cols-2">
          <Select
            label="学生"
            value={studentId}
            options={[{ value: '', label: '不绑定学生（班级共备课）' }, ...studentOptions]}
            onChange={(event) => setStudentId(event.target.value)}
          />
          <Select
            label="教材章节"
            value={courseId}
            options={[{ value: '', label: '不指定章节' }, ...courseOptions]}
            onChange={(event) => setCourseId(event.target.value)}
          />
          <Input label="月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <Input
            label="课时时长（分钟）"
            type="number"
            min={15}
            max={240}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
          <Input
            label="规划周数"
            type="number"
            min={1}
            max={8}
            value={weekCount}
            onChange={(event) => setWeekCount(event.target.value)}
          />
        </div>
        <div className="space-y-3 px-5 pb-5">
          <Textarea
            label="补充要求"
            rows={3}
            placeholder="例如：这周学生状态一般，重点放基础题；周五要考试，最后一节留给复习"
            value={requirements}
            onChange={(event) => setRequirements(event.target.value)}
          />
          <Button variant="primary" className="w-full" loading={generating} onClick={() => void generate()}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            生成教案
          </Button>
        </div>
      </Card>

      {draft ? (
        <Card>
          <CardHeader
            title={draft.isMine === false ? '组内教案（只读）' : '逐周编辑教案'}
            description={draft.isMine === false ? '可查看已确认教案；克隆为自己的草稿后再编辑' : '生成结果只是草稿；修改目标、活动、练习和分层作业后再确认'}
            icon={<BookOpen className="h-4 w-4" />}
            action={<Badge tone={draft.status === 'confirmed' ? 'success' : 'neutral'}>{draft.status === 'confirmed' ? '已确认' : '草稿'}</Badge>}
          />
          <div className="space-y-4 p-4">
            {draft.isMine === false ? (
              <p className="rounded-lg bg-sky-50 p-3 text-xs text-sky-700">
                这是其他教师已确认的共享教案。源教案不可修改或删除；请选择目标学生并克隆后再编辑。
              </p>
            ) : null}
            <fieldset disabled={draft.isMine === false} className="min-w-0">
            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <Input
                label="教案名称"
                value={draft.title}
                onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
              />
              <Input
                label="课时时长（分钟）"
                type="number"
                min={15}
                max={240}
                value={draft.durationMinutes}
                onChange={(event) => setDraft((current) => current ? { ...current, durationMinutes: Number(event.target.value) } : current)}
              />
            </div>
            </fieldset>
            {draft.modelMetadata?.usedFallback ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                这份教案来自本地兜底模板，并非模型生成结果，请逐项核对后再用于课堂。
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
              <div className="flex rounded-lg bg-white p-1 shadow-sm" aria-label="教案视图">
                {(['week', 'day'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={viewMode === mode}
                    onClick={() => {
                      setViewMode(mode);
                      if (mode === 'day') setOpenWeek((current) => current ?? draft.plan.weekly_lesson_plans[0]?.week ?? 1);
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition',
                      viewMode === mode ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800'
                    )}
                  >
                    {mode === 'week' ? '周视图' : '日视图（每次课）'}
                  </button>
                ))}
              </div>
              {viewMode === 'day' ? (
                <select
                  aria-label="选择课时"
                  className="max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                  value={openWeek ?? draft.plan.weekly_lesson_plans[0]?.week ?? 1}
                  onChange={(event) => setOpenWeek(Number(event.target.value))}
                >
                  {draft.plan.weekly_lesson_plans.map((week) => (
                    <option key={week.week} value={week.week}>第 {week.week} 周 · {week.title}</option>
                  ))}
                </select>
              ) : null}
              {viewMode === 'day' ? (
                <p className="w-full text-[11px] text-slate-400">当前教案每周一次课；日视图用于逐课时编辑，不代表已安排具体日期。</p>
              ) : null}
            </div>
            <fieldset disabled={draft.isMine === false} className="min-w-0 space-y-3">
              {draft.plan.weekly_lesson_plans
                .filter((week) => viewMode === 'week' || week.week === openWeek)
                .map((week) => {
                  const index = draft.plan.weekly_lesson_plans.findIndex((item) => item.week === week.week);
                  return (
                    <WeekEditor
                      key={week.week}
                      week={week}
                      planMinutes={draft.durationMinutes}
                      open={viewMode === 'day' || openWeek === week.week}
                      onToggle={() => {
                        if (viewMode === 'week') setOpenWeek((current) => current === week.week ? null : week.week);
                      }}
                      onChange={(patch) => updateWeek(index, patch)}
                    />
                  );
                })}
            </fieldset>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              {draft.isMine !== false ? <Button variant="ghost" className="mr-auto text-red-600" onClick={() => void remove()}>
                <Trash2 className="mr-1 h-4 w-4" />删除教案
              </Button> : null}
              <select
                aria-label="克隆目标学生"
                className="h-9 max-w-40 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600"
                value={cloneStudentId}
                onChange={(event) => setCloneStudentId(event.target.value)}
              >
                <option value="">克隆：不绑定学生</option>
                {students.map((student) => <option key={student.id} value={student.id}>克隆给：{student.name}</option>)}
              </select>
              <Button variant="outline" loading={cloning} onClick={() => void cloneDraft()}>
                <CopyPlus className="mr-1 h-4 w-4" />克隆教案
              </Button>
              {draft.isMine !== false ? <>
                <Button variant="outline" loading={saving} onClick={() => void save('draft')}>
                  <Save className="mr-1 h-4 w-4" />保存草稿
                </Button>
                <Button variant="primary" loading={saving} disabled={!draft.title.trim()} onClick={() => void save('confirmed')}>
                  <CheckCircle2 className="mr-1 h-4 w-4" />确认教案
                </Button>
              </> : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="历史教案"
          description={listLoading ? '加载中…' : '共 ' + plans.length + ' 份'}
          icon={<ClipboardList className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-1">
              <Button variant={listScope === 'mine' ? 'outline' : 'ghost'} size="sm" onClick={() => setListScope('mine')}>我的</Button>
              <Button variant={listScope === 'group' ? 'outline' : 'ghost'} size="sm" onClick={() => setListScope('group')}>教研组</Button>
              <Button variant="ghost" size="sm" aria-label="刷新教案列表" onClick={() => void loadPlans()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          }
        />
        <div className="p-4">
          {listLoading ? (
            <ListSkeleton rows={4} />
          ) : plans.length === 0 ? (
            <EmptyState title="还没有教案" description="选好学生和章节后点上方「生成教案」" />
          ) : (
            <ul className="space-y-1.5">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    onClick={() => select(plan)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition',
                      selectedId === plan.id
                        ? 'border-brand-300 bg-brand-50/60 ring-1 ring-brand-200'
                        : 'border-slate-200/70 bg-white hover:border-brand-200 hover:bg-slate-50/60'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{plan.title}</span>
                      <Badge tone={plan.status === 'confirmed' ? 'success' : 'neutral'}>
                        {plan.status === 'confirmed' ? '已确认' : '草稿'}
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                      <span>{plan.month}</span>
                      <span>{plan.weekCount} 周</span>
                      {plan.studentName && <span>{plan.studentName}</span>}
                      {plan.modelMetadata?.usedFallback && <span className="text-amber-500">模板兜底</span>}
                      <span className="ml-auto">{formatTime(plan.updatedAt)}</span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function ActivityEditor({
  activity,
  index,
  onChange,
  onRemove,
}: {
  activity: LessonActivity;
  index: number;
  onChange: (next: LessonActivity) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
          {index + 1}
        </span>
        <input
          className="min-w-0 flex-1 rounded-lg border border-transparent px-1.5 py-1 text-sm font-medium text-slate-800 outline-none hover:border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
          value={activity.name}
          placeholder="活动名称"
          onChange={(event) => onChange({ ...activity, name: event.target.value })}
        />
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
          分钟
          <input
            type="number"
            min={1}
            max={240}
            className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-brand-400"
            value={activity.duration_minutes}
            onChange={(event) =>
              onChange({ ...activity, duration_minutes: floorMinutes(Number(event.target.value)) })
            }
          />
        </label>
        <button
          type="button"
          className="shrink-0 text-slate-300 hover:text-red-500"
          aria-label="删除活动"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-400">老师做什么</p>
          <textarea
            className="min-h-[48px] w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
            rows={2}
            value={activity.teacher_activity}
            onChange={(event) => onChange({ ...activity, teacher_activity: event.target.value })}
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-400">学生做什么</p>
          <textarea
            className="min-h-[48px] w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
            rows={2}
            value={activity.student_activity}
            onChange={(event) => onChange({ ...activity, student_activity: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function WeekEditor({
  week,
  planMinutes,
  open,
  onToggle,
  onChange,
}: {
  week: WeeklyLessonPlan;
  planMinutes: number;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<WeeklyLessonPlan>) => void;
}) {
  const minutes = activityMinutes(week.activities);
  const diff = minutes - planMinutes;
  const moveHomework = (source: keyof LayeredHomework, sourceIndex: number, target: keyof LayeredHomework) => {
    if (source === target) return;
    const item = week.layered_homework[source][sourceIndex];
    if (item === undefined) return;
    const homework: LayeredHomework = {
      basic: [...week.layered_homework.basic],
      advanced: [...week.layered_homework.advanced],
      challenge: [...week.layered_homework.challenge],
    };
    homework[source].splice(sourceIndex, 1);
    homework[target].push(item);
    onChange({ layered_homework: homework });
  };
  const dropHomework = (event: React.DragEvent, target: keyof LayeredHomework) => {
    event.preventDefault();
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-lesson-homework')) as {
        source?: keyof LayeredHomework;
        sourceIndex?: number;
      };
      if (!payload.source || !LAYER_LABELS.some((layer) => layer.key === payload.source) || !Number.isInteger(payload.sourceIndex)) return;
      moveHomework(payload.source, payload.sourceIndex!, target);
    } catch {
      // 忽略来自页面外部的拖放数据；作业移动只接受本编辑器写出的结构。
    }
  };
  return (
    <div className={cn('overflow-hidden rounded-2xl border', open ? 'border-brand-200' : 'border-slate-200/70')}>
      <WeekSummaryRow week={week} planMinutes={planMinutes} open={open} onToggle={onToggle} />
      {open && (
        <div className="space-y-5 border-t border-slate-100 bg-white p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">本周主题</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
              value={week.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <CardListEditor
              label="教学目标"
              icon={<Target className="h-3 w-3" />}
              placeholder="学完这节课，学生能……"
              items={week.objectives}
              onChange={(objectives) => onChange({ objectives })}
            />
            <CardListEditor
              label="所需材料"
              items={week.materials}
              onChange={(materials) => onChange({ materials })}
            />
            <CardListEditor
              label="教学重点"
              items={week.key_points}
              onChange={(key_points) => onChange({ key_points })}
            />
            <CardListEditor
              label="教学难点"
              items={week.difficult_points}
              onChange={(difficult_points) => onChange({ difficult_points })}
            />
          </div>

          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Layers className="h-3.5 w-3.5 text-brand-500" />
              课堂活动
              <span className="text-[11px] font-normal text-slate-400">合计 {minutes} 分钟</span>
            </h4>
            {week.activities.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">这一周还没有排活动。</p>
            ) : (
              <div className="space-y-2">
                {week.activities.map((activity, aIndex) => (
                  <ActivityEditor
                    key={aIndex}
                    activity={activity}
                    index={aIndex}
                    onChange={(next) => {
                      const activities = week.activities.slice();
                      activities[aIndex] = next;
                      onChange({ activities });
                    }}
                    onRemove={() => onChange({ activities: week.activities.filter((_, i) => i !== aIndex) })}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              className="mt-1.5 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              onClick={() =>
                onChange({
                  activities: [
                    ...week.activities,
                    { name: "", duration_minutes: 10, teacher_activity: "", student_activity: "" },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              添加活动
            </button>
            {minutes !== planMinutes && (
              <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                活动合计 {minutes} 分钟，课时是 {planMinutes} 分钟（
                {diff > 0 ? "超出 " + diff : "还差 " + -diff} 分钟）
              </p>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">配套练习</h4>
            {week.exercises.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">暂无练习。</p>
            )}
            <div className="space-y-2">
              {week.exercises.map((exercise, eIndex) => (
                <div key={eIndex} className="rounded-xl border border-slate-200/70 bg-white p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 text-[11px] text-slate-300">{eIndex + 1}.</span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <textarea
                        className="min-h-[36px] w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
                        rows={2}
                        placeholder="题目"
                        value={exercise.question}
                        onChange={(event) => {
                          const exercises = week.exercises.slice();
                          exercises[eIndex] = { ...exercise, question: event.target.value };
                          onChange({ exercises });
                        }}
                      />
                      <textarea
                        className="min-h-[28px] w-full resize-none rounded-lg border border-slate-200 bg-emerald-50/40 px-2.5 py-1.5 text-xs text-emerald-800 outline-none focus:border-emerald-400"
                        rows={2}
                        placeholder="答案"
                        value={exercise.answer}
                        onChange={(event) => {
                          const exercises = week.exercises.slice();
                          exercises[eIndex] = { ...exercise, answer: event.target.value };
                          onChange({ exercises });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">分层作业</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {LAYER_LABELS.map((layer) => (
                <div
                  key={layer.key}
                  className="rounded-xl border border-slate-200/70 bg-white p-3"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => dropHomework(event, layer.key)}
                >
                  <p className={"mb-1 text-xs font-semibold " + layer.tone}>{layer.label}</p>
                  <div className="space-y-1.5">
                    {week.layered_homework[layer.key].map((item, hIndex) => (
                      <div key={hIndex} className="flex items-start gap-1">
                        <span
                          draggable
                          aria-hidden="true"
                          title="拖拽到其他作业分层"
                          className="mt-1 cursor-grab select-none text-xs tracking-tighter text-slate-300 active:cursor-grabbing"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('application/x-lesson-homework', JSON.stringify({ source: layer.key, sourceIndex: hIndex }));
                          }}
                        >
                          ⋮⋮
                        </span>
                        <textarea
                          className="min-h-[30px] w-full resize-none rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-brand-400"
                          rows={1}
                          value={item}
                          onChange={(event) => {
                            const homework = { ...week.layered_homework };
                            const list = homework[layer.key].slice();
                            list[hIndex] = event.target.value;
                            homework[layer.key] = list;
                            onChange({ layered_homework: homework });
                          }}
                        />
                        <select
                          aria-label={'移动' + layer.label + '作业' + (hIndex + 1)}
                          title="移动到其他分层"
                          className="mt-1 w-12 shrink-0 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-500"
                          value={layer.key}
                          onChange={(event) => moveHomework(layer.key, hIndex, event.target.value as keyof LayeredHomework)}
                        >
                          {LAYER_LABELS.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
                        </select>
                        <button
                          type="button"
                          className="mt-1 shrink-0 text-slate-300 hover:text-red-500"
                          aria-label="删除作业"
                          onClick={() => {
                            const homework = { ...week.layered_homework };
                            homework[layer.key] = homework[layer.key].filter((_, i) => i !== hIndex);
                            onChange({ layered_homework: homework });
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-1 flex items-center gap-0.5 text-[11px] text-brand-600 hover:text-brand-700"
                    onClick={() => {
                      const homework = { ...week.layered_homework };
                      homework[layer.key] = [...homework[layer.key], ""];
                      onChange({ layered_homework: homework });
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    添加
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <CardListEditor
              label="板书设计"
              icon={<Lightbulb className="h-3 w-3" />}
              placeholder="左边写……中间画……"
              items={week.blackboard_design}
              onChange={(blackboard_design) => onChange({ blackboard_design })}
            />
            <CardListEditor
              label="课后反思提示"
              placeholder="这节课学生最难接受的是哪一步？"
              items={week.reflection_prompts}
              onChange={(reflection_prompts) => onChange({ reflection_prompts })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
