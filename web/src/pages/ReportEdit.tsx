import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileImage,
  FilePlus2,
  FileSpreadsheet,
  ListPlus,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Input, Select, Textarea } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { cn, saveBlob } from '../lib/utils';
import { downloadReportCard, type ReportCardBlock, type ReportCardInput } from '../lib/reportCard';
import {
  ATTENDANCE_OPTIONS,
  CatalogCourseOption,
  DIFFICULTY_OPTIONS,
  MonthlyReport,
  ReportItem,
  TERM_OPTIONS,
  formatYearMonth,
} from '../types/reports';

/** 明细行可编辑的列（顺序即展示顺序） */
type CellKey =
  | 'seq'
  | 'content'
  | 'type'
  | 'score'
  | 'difficulty'
  | 'scheduled_at'
  | 'attendance'
  | 'notes_done'
  | 'mistakes_done'
  | 'homework_done'
  | 'exam';

const SUMMARY_COLS: { key: CellKey; label: string; width: string; list?: string[] }[] = [
  { key: 'seq', label: '序号', width: 'w-12' },
  { key: 'content', label: '课程内容', width: 'min-w-56' },
  { key: 'type', label: '课程类型', width: 'w-24' },
  { key: 'score', label: '期末考分值占比', width: 'w-24' },
  { key: 'difficulty', label: '学习难度', width: 'w-20', list: DIFFICULTY_OPTIONS },
  { key: 'attendance', label: '出勤', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'notes_done', label: '笔记整理', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'mistakes_done', label: '错题整理', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'homework_done', label: '作业完成', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'exam', label: '考试情况', width: 'w-24' },
];

/** 新加的总结课默认填好的 5 列——省得每节课都点四下 ✅ */
const SUMMARY_DEFAULTS: Record<string, string> = {
  attendance: '✅️',
  notes_done: '✅️',
  mistakes_done: '✅️',
  homework_done: '✅️',
  exam: '/',
};

const PLAN_COLS: { key: CellKey; label: string; width: string; list?: string[] }[] = [
  { key: 'seq', label: '序号', width: 'w-12' },
  { key: 'content', label: '课程内容', width: 'min-w-56' },
  { key: 'type', label: '课程类型', width: 'w-24' },
  { key: 'score', label: '期末考分值占比', width: 'w-24' },
  { key: 'difficulty', label: '学习难度', width: 'w-20', list: DIFFICULTY_OPTIONS },
];

const cellInputCls =
  'h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-xs text-slate-700 ' +
  'hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:ring-1 focus:ring-brand-100 outline-none transition';

/** '2026-09' → '9月' */
function monthLabel(yearMonth: string): string {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(yearMonth || ''));
  return m ? `${Number(m[2])}月` : '';
}

/** '2026-09' → '2026-10' */
function nextYearMonth(yearMonth: string): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(yearMonth || ''));
  if (!m) return String(yearMonth || '');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

/** '2026-09' → '2026年9月' */
function yearMonthText(yearMonth: string): string {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(yearMonth || ''));
  return m ? `${m[1]}年${Number(m[2])}月` : String(yearMonth || '');
}

/** 就地编辑的单元格：失焦时如果值变了才提交 */
function CellInput({
  value,
  onCommit,
  type = 'text',
  list,
  placeholder,
  ariaLabel,
}: {
  value: string | number | null | undefined;
  onCommit: (next: string) => void;
  type?: string;
  list?: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const original = String(value ?? '');
  const [draft, setDraft] = useState(original);

  useEffect(() => {
    setDraft(original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original]);

  return (
    <input
      type={type}
      className={cellInputCls}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      list={list ? `list-${list.join()}` : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== original) onCommit(draft);
      }}
    />
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
        checked ? 'bg-brand-600' : 'bg-slate-300'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}

export default function ReportEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingText, setSavingText] = useState(false);
  const [aiField, setAiField] = useState<'summary' | 'plan' | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const [showPicker, setShowPicker] = useState<'summary' | 'plan' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(
    async (silent = true) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const data = await api.request<{ report: MonthlyReport; items: ReportItem[] }>(`/reports/${id}`);
        setReport(data.report);
        setItems(data.items);
      } catch (e) {
        if (!silent) toast.error(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const summaryItems = useMemo(() => items.filter((i) => i.kind === 'summary'), [items]);
  const planItems = useMemo(() => items.filter((i) => i.kind === 'plan'), [items]);

  /** 当前要挑课的面板里已经加过、还连着目录 id 的课——弹窗里灰掉，不允许重复加 */
  const pickerAddedIds = useMemo(() => {
    const kind = showPicker || 'plan';
    return new Set(
      items
        .filter((i) => i.kind === kind && i.course_id != null)
        .map((i) => Number(i.course_id))
    );
  }, [items, showPicker]);
  const examItems = useMemo(() => items.filter((i) => i.kind === 'exam'), [items]);

  /**
   * 两个区块的月份标题，跟服务端导出 Excel 的算法保持一致。
   * 都以报告自己的 year_month 为准，不从明细取日期 —— 明细排序可手动上移，
   * 取首条会把「9月总结」变成「10月总结」，导出的 Excel 和报告文字会一起错。
   */
  const summaryMonth = useMemo(() => monthLabel(report?.year_month ?? ''), [report?.year_month]);
  const planMonth = useMemo(
    () => monthLabel(nextYearMonth(report?.year_month ?? '')),
    [report?.year_month]
  );

  /** 图片卡片输入：关掉哪个开关就不出哪一块 */
  const cardInput = useMemo<ReportCardInput>(() => {
    if (!report) return { blocks: [] };
    const courseEntry = (i: ReportItem) => ({ text: i.content });
    const blocks: ReportCardBlock[] = [];
    if (report.summary_enabled) {
      blocks.push({
        heading: summaryMonth + '总结',
        intro: report.summary_intro,
        entries: summaryItems.map(courseEntry),
      });
    }
    if (report.plan_enabled) {
      blocks.push({
        heading: planMonth + '规划',
        intro: report.plan_intro,
        // 课程在前、阶测在后，跟页面上的排列一致
        entries: [...planItems.map(courseEntry), ...examItems.map((i) => ({ ...courseEntry(i), highlight: true }))],
      });
    }
    const core = [report.term ?? '', report.grade ?? '', report.subject ?? ''].filter(Boolean).join('');
    return {
      title: report.student_name,
      meta: [core, yearMonthText(report.year_month)].filter(Boolean).join(' · '),
      blocks,
      farewell: report.farewell,
      watermark: '星火个性化教学 · 月度总结与课程规划',
    };
  }, [report, summaryItems, planItems, examItems, summaryMonth, planMonth]);

  async function downloadExcel() {
    if (!report) return;
    setExporting(true);
    try {
      const { blob, filename } = await api.downloadFile(`/reports/${report.id}/xlsx`);
      saveBlob(blob, filename);
      toast.success('已导出 Excel');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出 Excel 失败');
    } finally {
      setExporting(false);
    }
  }

  function downloadCard() {
    if (!report) return;
    const filename = `${report.student_name} ${monthLabel(report.year_month)}月度报告.png`;
    downloadReportCard(cardInput, filename);
    toast.success('已导出图片');
  }

  async function patchReport(fields: Record<string, unknown>) {
    if (!report) return;
    try {
      const data = await api.request<{ report: MonthlyReport }>(`/reports/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      setReport(data.report);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  }

  async function patchText(field: 'summary_intro' | 'plan_intro' | 'farewell', value: string) {
    if (!report) return;
    const key = field === 'summary_intro' ? 'summaryIntro' : field === 'plan_intro' ? 'planIntro' : 'farewell';
    setSavingText(true);
    try {
      await patchReport({ [key]: value });
    } finally {
      setSavingText(false);
    }
  }

  /** 只改本地：AI 流式写输入框时用，避免 PATCH 回写把已流出的文字冲掉 */
  function setIntro(field: 'summary_intro' | 'plan_intro', value: string) {
    setReport((prev) => (prev ? ({ ...prev, [field]: value } as MonthlyReport) : prev));
  }

  function appendIntro(field: 'summary_intro' | 'plan_intro', text: string) {
    setReport((prev) => (prev ? ({ ...prev, [field]: (prev[field] || '') + text } as MonthlyReport) : prev));
  }

  async function addItem(kind: 'summary' | 'plan' | 'exam', body: Record<string, unknown> = {}) {
    if (!report) return;
    try {
      // 总结块的课一进来就把出勤/笔记/错题/作业记成 ✅、考试情况记成「/」，
      // 老师只在真的请假、补课、有考试时才改回来
      const base = kind === 'summary' ? { kind, ...SUMMARY_DEFAULTS } : { kind };
      const data = await api.request<{ item: ReportItem }>(`/reports/${report.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ ...base, ...body }),
      });
      setItems((prev) => [...prev, data.item]);
      return data.item;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败');
      return null;
    }
  }

  async function patchItem(itemId: number, field: CellKey, value: string) {
    if (!report) return;
    try {
      const data = await api.request<{ item: ReportItem }>(`/reports/${report.id}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value === '' ? null : value }),
      });
      setItems((prev) => prev.map((i) => (i.id === itemId ? data.item : i)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  }

  async function removeItem(itemId: number) {
    if (!report) return;
    try {
      await api.request(`/reports/${report.id}/items/${itemId}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function moveItem(itemId: number, dir: 'up' | 'down') {
    if (!report) return;
    try {
      const data = await api.request<{ items: ReportItem[]; moved: boolean }>(
        `/reports/${report.id}/items/move`,
        { method: 'POST', body: JSON.stringify({ itemId, dir }) }
      );
      setItems(data.items);
      if (!data.moved) toast.info('已经到顶了');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '排序失败');
    }
  }

  /**
   * AI 编写「本月总结」或「本月规划」，流式写进对应输入框。
   * 材料是这块报告自己的课程明细 + 该学生最近的课后回访，所以两段不会雷同。
   * 已有内容先问一句，免得老师手写的稿子被冲掉；流完立刻落库，不用等失焦。
   */
  async function runAi(field: 'summary' | 'plan') {
    if (!report) return;
    const introKey = field === 'summary' ? 'summary_intro' : 'plan_intro';
    const courses = field === 'summary' ? summaryItems : planItems;
    if (courses.length === 0) {
      toast.error((field === 'summary' ? '总结' : '规划') + '里还没有课程内容，先添加课程再让 AI 写');
      return;
    }
    if ((report[introKey] || '').trim() && !window.confirm('要用 AI 生成的内容替换现在这段文字，继续吗？')) return;

    const controller = new AbortController();
    aiAbort.current = controller;
    setAiField(field);
    setIntro(introKey, '');

    try {
      await api.streamPost(
        `/reports/${report.id}/ai/stream`,
        { field },
        {
          onDelta: (text) => appendIntro(introKey, text),
          onDone: ({ content }) => {
            if (!content) {
              toast.error('AI 未返回任何内容，请检查模型配置后重试');
              return;
            }
            void patchText(introKey, content);
            toast.success('AI 编写完成，可以直接改');
          },
          onError: (msg) => toast.error(msg),
        },
        controller.signal
      );
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast.error(e instanceof Error ? e.message : 'AI 编写失败');
    } finally {
      if (aiAbort.current === controller) {
        aiAbort.current = null;
        setAiField(null);
      }
    }
  }

  async function deleteAll() {
    if (!report) return;
    setDeleting(true);
    try {
      await api.request(`/reports/${report.id}`, { method: 'DELETE' });
      toast.success('已删除');
      navigate('/reports');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-500">加载中…</div>;
  }
  if (!report) {
    return (
      <div className="space-y-4">
        <Link to="/reports" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> 返回报告列表
        </Link>
        <Card className="p-10 text-center text-sm text-slate-500">没有找到这块报告，可能已经被删除了</Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="返回列表">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-800">{report.student_name}</h1>
              <span className="text-sm text-slate-400">{formatYearMonth(report.year_month)}</span>
              {(report.grade || report.subject) && (
                <span className="text-xs text-slate-400">
                  {[report.grade, report.subject].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              共 {items.length} 条 · 最后更新 {(report.updated_at || '').slice(0, 16)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={report.term}
            onChange={(e) => void patchReport({ term: e.target.value })}
            options={TERM_OPTIONS.map((t) => ({ value: t, label: t }))}
            className="h-10 w-32"
            aria-label="学期"
          />
          <Button
            variant="outline"
            size="sm"
            icon={<FileSpreadsheet className="h-4 w-4" />}
            loading={exporting}
            disabled={items.length === 0 && !report.farewell}
            onClick={() => void downloadExcel()}
          >
            导出 Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<FileImage className="h-4 w-4" />}
            onClick={downloadCard}
          >
            导出图片
          </Button>
          <Button variant="outline" size="sm" icon={<Trash2 className="h-4 w-4 text-red-500" />} onClick={() => setConfirmDelete(true)}>
            删除报告
          </Button>
        </div>
      </header>

      {savingText && <div className="text-xs text-slate-400">正在保存…</div>}

      <Panel
        title="月度总结"
        icon={<ClipboardList className="h-4 w-4" />}
        enabled={report.summary_enabled}
        onToggle={(v) => void patchReport({ summaryEnabled: v })}
        empty={summaryItems.length === 0}
        action={
          report.summary_enabled && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" icon={<ListPlus className="h-4 w-4" />} onClick={() => void addItem('summary', { seq: nextSeq(summaryItems) })}>
                加空行
              </Button>
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowPicker('summary')}>
                从课程目录添加
              </Button>
            </div>
          )
        }
        intro={
          <Textarea
            label="本月总结"
            hint={
              <Button
                variant="ghost"
                size="sm"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                loading={aiField === 'summary'}
                disabled={summaryItems.length === 0 || aiField !== null}
                title={summaryItems.length === 0 ? '先添加本月的课程内容' : '按课程明细和最近的回访生成'}
                aria-label="AI 编写本月总结"
                onClick={() => void runAi('summary')}
              >
                AI 编写
              </Button>
            }
            placeholder={'📚课堂情况：本月计划x次课\n📖学习内容：\n🎯本月收获：\n🏆进步表现：\n📝本月不足：\n💡建议：\n🎯下月目标：'}
            value={report.summary_intro}
            onChange={(e) => setReport({ ...report, summary_intro: e.target.value })}
            onBlur={(e) => void patchText('summary_intro', e.target.value)}
            rows={6}
          />
        }
        body={
          <ItemTable cols={SUMMARY_COLS} items={summaryItems} onPatch={patchItem} onRemove={removeItem} onMove={moveItem} />
        }
      />

      <Panel
        title="课程规划"
        icon={<PencilLine className="h-4 w-4" />}
        enabled={report.plan_enabled}
        onToggle={(v) => void patchReport({ planEnabled: v })}
        empty={planItems.length === 0 && examItems.length === 0}
        action={
          report.plan_enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" icon={<ListPlus className="h-4 w-4" />} onClick={() => void addItem('plan', { seq: nextSeq(planItems) })}>
                加空行
              </Button>
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowPicker('plan')}>
                从课程目录添加
              </Button>
              <Button variant="ghost" size="sm" icon={<CalendarDays className="h-4 w-4" />} onClick={() => void addItem('exam', { content: '阶测安排' })}>
                手动加阶测
              </Button>
            </div>
          )
        }
      intro={
        <Textarea
          label="本月规划"
          hint={
            <Button
              variant="ghost"
              size="sm"
              icon={<Sparkles className="h-3.5 w-3.5" />}
              loading={aiField === 'plan'}
              disabled={planItems.length === 0 || aiField !== null}
              title={planItems.length === 0 ? '先添加下月的课程内容' : '按课程明细和总结里的收获生成'}
              aria-label="AI 编写本月规划"
              onClick={() => void runAi('plan')}
            >
              AI 编写
            </Button>
          }
          placeholder="本月打算讲哪些内容、重点攻克什么…"
          value={report.plan_intro}
          onChange={(e) => setReport({ ...report, plan_intro: e.target.value })}
          onBlur={(e) => void patchText('plan_intro', e.target.value)}
          rows={3}
        />
      }
      body={
        <>
          <ItemTable cols={PLAN_COLS} items={planItems} onPatch={patchItem} onRemove={removeItem} onMove={moveItem} />

          {examItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" /> 阶测安排（{examItems.length}）
              </div>
              <ExamRows items={examItems} onPatch={patchItem} onRemove={removeItem} onMove={moveItem} />
            </div>
          )}
        </>
      }
      />

      <Card>
        <CardBody className="p-5">
          <Textarea
            label="结尾祝福语"
            placeholder="对家长的寄语，导出时会附在文件末尾"
            value={report.farewell}
            onChange={(e) => setReport({ ...report, farewell: e.target.value })}
            onBlur={(e) => void patchText('farewell', e.target.value)}
            rows={3}
          />
        </CardBody>
      </Card>

      <CoursePicker
        open={showPicker !== null}
        kind={showPicker || 'plan'}
        subject={report.subject}
        reportGrade={report.grade}
        reportTerm={report.term}
        addedIds={pickerAddedIds}
        onClose={() => setShowPicker(null)}
        onCoursesUsed={(courseIds) => {
          // 课程使用记录回调（可用于后续统计）
          console.debug('[CoursePicker] 常用课程已更新', courseIds.length, '门');
        }}
        onPick={async (courses) => {
          const kind = showPicker || 'plan';
          let base = kind === 'plan' ? nextSeq(planItems) : nextSeq(summaryItems);
          let added = 0;
          for (const c of courses) {
            await addItem(kind, {
              seq: base++,
              content: c.content,
              type: c.type,
              score: c.score,
              difficulty: c.difficulty,
              // 记下来源课程，目录里才能看出「这门课已经给几个学生上过了」
              course_id: c.id,
            });
            added++;
          }
          setShowPicker(null);
          toast.success('已添加 ' + added + ' 门课');
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteAll()}
        loading={deleting}
        title="删除这块报告？"
        description={`${report.student_name} · ${formatYearMonth(report.year_month)} 及其 ${items.length} 条明细会一起删掉，不可恢复。`}
        confirmText="删除"
        danger
      />
    </div>
  );
}

function nextSeq(items: ReportItem[]): number {
  return items.reduce((m, i) => Math.max(m, Number(i.seq) || 0), 0) + 1;
}

function Panel({
  title,
  icon,
  enabled,
  onToggle,
  empty,
  action,
  intro,
  body,
}: {
  title: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  empty: boolean;
  action?: React.ReactNode;
  /** 面板打开后就该一直可见的摘要输入（不能被空状态挡掉） */
  intro?: React.ReactNode;
  body?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <Switch checked={enabled} onChange={onToggle} label={title + '开关'} />
            {!enabled && <Badge tone="neutral">已关闭</Badge>}
          </span>
        }
        icon={icon}
        action={enabled ? action : undefined}
        className="p-4"
      />
      {enabled && (
        <CardBody className="space-y-4 p-4">
          {intro}
          {empty ? (
            <div className="flex flex-col items-center py-8 text-center text-sm text-slate-400">
              <CheckCircle2 className="mb-2 h-6 w-6 text-slate-300" />
              还没有内容
            </div>
          ) : (
            body
          )}
        </CardBody>
      )}
    </Card>
  );
}

function ItemTable({
  cols,
  items,
  onPatch,
  onRemove,
  onMove,
}: {
  cols: typeof SUMMARY_COLS;
  items: ReportItem[];
  onPatch: (id: number, field: CellKey, value: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onMove: (id: number, dir: 'up' | 'down') => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      {cols.map((c) =>
        c.list ? (
          <datalist key={'dl-' + c.key} id={`list-${c.list.join()}`}>
            {c.list.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ) : null
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-slate-500">
            {cols.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium">
                {c.label}
              </th>
            ))}
            <th className="w-20 px-2 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-brand-50/20">
              {cols.map((c) => (
                <td key={c.key} className={cn('p-0.5', c.width)}>
                  <CellInput
                    value={item[c.key]}
                    type={c.key === 'scheduled_at' ? 'date' : 'text'}
                    list={c.list}
                    ariaLabel={`${item.content || '行'} ${c.label}`}
                    onCommit={(v) => void onPatch(item.id, c.key, v)}
                  />
                </td>
              ))}
              <td className="p-0.5">
                <div className="flex items-center justify-end gap-0.5">
                  <button className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30" disabled={idx === 0} onClick={() => void onMove(item.id, 'up')} aria-label="上移" title="上移">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30" disabled={idx === items.length - 1} onClick={() => void onMove(item.id, 'down')} aria-label="下移" title="下移">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500" onClick={() => void onRemove(item.id)} aria-label="删除" title="删除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExamRows({
  items,
  onPatch,
  onRemove,
  onMove,
}: {
  items: ReportItem[];
  onPatch: (id: number, field: CellKey, value: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onMove: (id: number, dir: 'up' | 'down') => Promise<void>;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, idx) => (
        <div key={item.id} className="flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/40 px-2 py-1">
          <Badge tone="violet" className="shrink-0">
            阶测
          </Badge>
          <div className="min-w-0 flex-1">
            <CellInput value={item.content} ariaLabel="阶测内容" onCommit={(v) => void onPatch(item.id, 'content', v)} />
          </div>
          <div className="w-36 shrink-0">
            <CellInput value={item.scheduled_at} type="date" ariaLabel="阶测时间" onCommit={(v) => void onPatch(item.id, 'scheduled_at', v)} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button className="rounded p-1 text-slate-300 hover:bg-white hover:text-slate-600 disabled:opacity-30" disabled={idx === 0} onClick={() => void onMove(item.id, 'up')} aria-label="上移" title="上移">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button className="rounded p-1 text-slate-300 hover:bg-white hover:text-slate-600 disabled:opacity-30" disabled={idx === items.length - 1} onClick={() => void onMove(item.id, 'down')} aria-label="下移" title="下移">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button className="rounded p-1 text-slate-300 hover:bg-white hover:text-red-500" onClick={() => void onRemove(item.id)} aria-label="删除" title="删除">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 从课程目录挑课。
 *
 * 默认只列这块报告学科的课，学期默认锁在报告自己的学期上——报告是秋季的就不该
 * 往里塞寒假的课，目录那边「引用」也跟着对不上。年级 / 学期 / 类型可以再收窄，
 * 「查看全部」一键放开所有条件。已经加进当前面板的课标灰、不能再选，
 * 免得同一门课在总结里写两遍。
 *
 * 新增：常用课程缓存 - 记录最近使用的课程，下次打开时优先展示
 */
function CoursePicker({
  open,
  kind,
  subject,
  reportGrade,
  reportTerm,
  addedIds,
  onClose,
  onPick,
  onCoursesUsed,
}: {
  open: boolean;
  kind: 'summary' | 'plan';
  subject: string;
  reportGrade: string;
  reportTerm: string;
  addedIds: Set<number>;
  onClose: () => void;
  onPick: (courses: CatalogCourseOption[]) => Promise<void>;
  onCoursesUsed?: (courseIds: number[]) => void;
}) {
  const [courses, setCourses] = useState<CatalogCourseOption[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [grade, setGrade] = useState('');
  const [term, setTerm] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [grades, setGrades] = useState<string[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [recentCourses, setRecentCourses] = useState<CatalogCourseOption[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  /** 自动展开标记：「同步」类型无结果时自动放开，避免用户看到空列表 */
  const autoClearedType = useRef(false);

  // 加载常用课程（localStorage 缓存）
  useEffect(() => {
    if (!open) return;
    const key = `recent-courses-${subject}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved) && saved.length > 0) {
        setRecentCourses(saved);
        setShowRecent(true);
      }
    } catch {
      // 解析失败忽略
    }
  }, [open, subject]);

  useEffect(() => {
    if (!open) {
      autoClearedType.current = false;
      return;
    }
    setKeyword('');
    setType('同步');
    setGrade(reportGrade);
    setTerm(reportTerm);
    setShowAll(false);
    setPicked(new Set());
    void api
      .request<{ grades: string[]; terms: string[] }>('/catalog/facets')
      .then((r) => {
        setGrades(r.grades || []);
        setTerms(r.terms || []);
      })
      .catch(() => undefined);
  }, [open, reportGrade, reportTerm]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: '5000' });
    // subject 始终带：「查看全部」只放开年级/学期/类型，学科范围不变
    if (subject) params.set('subject', subject);
    if (grade) params.set('grade', grade);
    if (term) params.set('term', term);
    if (type) params.set('type', type);
    if (keyword.trim()) params.set('q', keyword.trim());
    api
      .request<{ courses: CatalogCourseOption[]; total: number; rows: number }>(`/catalog/courses?${params}`)
      .then((r) => {
        setCourses(r.courses || []);
        setTotal(r.total || 0);
        setTruncated((r.rows || 0) < (r.total || 0));
      })
      .catch(() => {
        setCourses([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [open, subject, grade, term, type, keyword, showAll]);

  // 「同步」类型无结果时自动放开类型筛选，避免用户看到空列表
  useEffect(() => {
    if (!open || showAll || loading || autoClearedType.current) return;
    if (type === '同步' && total === 0 && courses.length === 0) {
      autoClearedType.current = true;
      setType('');
    }
  }, [open, showAll, loading, type, total, courses]);

  const typeOptions = useMemo(() => Array.from(new Set(courses.map((c) => c.type).filter(Boolean))), [courses]);

  const hasFilter = showAll || !!(subject || grade || term || type || keyword.trim());

  const resetAll = () => {
    setKeyword('');
    setType('');
    setGrade('');
    setTerm('');
    setShowAll(true);
  };

  // 「查看全部」是开关：有收窄就展开到全部课程，已经展开了就收回来。
  // 收回时必须把报告学期重新套回去——不然展开过一次再点回来会变成「全部学期」，
  // 寒假的课又悄悄混进秋季的报告里了。
  const toggleShowAll = () => {
    setKeyword('');
    if (showAll) {
      // 收回：恢复默认筛选（年级 + 学期 + 同步）
      setShowAll(false);
      setType('同步');
      setGrade(reportGrade);
      setTerm(reportTerm);
    } else {
      // 展开：放开所有条件
      setShowAll(true);
      setType('');
      setGrade('');
      setTerm('');
    }
  };

  const scopeText = [
    showAll ? '全部课程' : subject ? subject : '',
    grade,
    type || (showAll ? '' : '全部类型'),
    term || (showAll ? '' : '全部学期'),
  ]
    .filter(Boolean)
    .join(' · ');

  const toggle = (c: CatalogCourseOption) => {
    if (addedIds.has(c.id)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.add(c.id);
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'从课程目录添加 · ' + (kind === 'plan' ? '规划' : '总结')}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">已选 {picked.size} 门</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              icon={<FilePlus2 className="h-4 w-4" />}
              disabled={picked.size === 0}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const pickedCourses = courses.filter((c) => picked.has(c.id));
                  // 保存常用课程到 localStorage
                  if (pickedCourses.length > 0) {
                    const key = `recent-courses-${subject}`;
                    const ids = pickedCourses.map((c) => c.id);
                    let prev: number[] = [];
                    try {
                      prev = JSON.parse(localStorage.getItem(key) || '[]');
                    } catch {
                      // 忽略解析错误
                    }
                    // 去重 + 去已添加的，最多保留 20 个
                    const merged = [...ids, ...prev.filter((id) => !ids.includes(id) && !addedIds.has(id))].slice(0, 20);
                    localStorage.setItem(key, JSON.stringify(merged));
                    onCoursesUsed?.(ids);
                  }
                  await onPick(pickedCourses);
                } finally {
                  setBusy(false);
                }
              }}
            >
              添加 {picked.size} 门
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索课程内容 / 教材 / 难度"
            aria-label="搜索"
          />
          <Select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="全部学期"
            options={terms.map((t) => ({ value: t, label: t }))}
            aria-label="学期"
          />
          <Select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="全部年级"
            options={grades.map((g) => ({ value: g, label: g }))}
            aria-label="年级"
          />
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="全部类型"
            options={typeOptions.map((t) => ({ value: t, label: t }))}
            aria-label="课程类型"
          />
        </div>

        {/* 常用课程快捷栏 */}
        {showRecent && recentCourses.length > 0 && !showAll && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">
                <span className="mr-1">📌</span>常用课程（点击快速选择）
              </span>
              <button
                type="button"
                onClick={() => setShowRecent(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                收起
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentCourses.map((c) => {
                const isAdded = addedIds.has(c.id);
                const isPicked = picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={isAdded}
                    onClick={() => toggle(c)}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs transition',
                      isAdded
                        ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                        : isPicked
                        ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-300'
                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50'
                    )}
                  >
                    {c.content.length > 20 ? c.content.slice(0, 20) + '…' : c.content}
                    {isAdded && <span className="ml-1 text-[10px]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-slate-400">
            {scopeText} · 共 {total} 门{truncated ? '，仅显示前 ' + courses.length + ' 门' : ''}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void toggleShowAll()} aria-label="查看全部课程">
            查看全部
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-100">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-400">加载中…</div>
          ) : courses.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              这个范围里没有匹配的课程。
              {hasFilter && (
                <button onClick={resetAll} className="ml-1 text-brand-600 hover:underline">
                  查看全部课程
                </button>
              )}
              {!hasFilter && (
                <Link to="/catalog" className="ml-1 text-brand-600 hover:underline">
                  去课程目录导入
                </Link>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {courses.map((c) => {
                  const added = addedIds.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        'border-b border-slate-50 last:border-0',
                        added ? 'text-slate-300' : 'cursor-pointer hover:bg-slate-50',
                        picked.has(c.id) && 'bg-brand-50/60'
                      )}
                      onClick={() => toggle(c)}
                      aria-disabled={added}
                    >
                      <td className="w-8 px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={picked.has(c.id)}
                          disabled={added}
                          readOnly
                          aria-label="选择"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {c.content}
                        {added && <span className="ml-1.5 text-[11px] text-slate-300">已添加</span>}
                      </td>
                      <td className="w-16 px-2 py-1.5 text-slate-400">{c.term}</td>
                      <td className="w-20 px-2 py-1.5 text-slate-400">{c.type}</td>
                      <td className="w-16 px-2 py-1.5 text-slate-400">{c.score}</td>
                      <td className="w-20 px-2 py-1.5 text-slate-400">{c.difficulty}</td>
                      <td className="w-24 truncate px-2 py-1.5 text-slate-400">{c.textbook}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
