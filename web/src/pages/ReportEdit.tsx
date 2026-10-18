import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ExamSuggestion,
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
  { key: 'scheduled_at', label: '计划上课时间', width: 'w-36' },
  { key: 'attendance', label: '出勤', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'notes_done', label: '笔记整理', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'mistakes_done', label: '错题整理', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'homework_done', label: '作业完成', width: 'w-20', list: ATTENDANCE_OPTIONS },
  { key: 'exam', label: '考试情况', width: 'w-24' },
];

const PLAN_COLS: { key: CellKey; label: string; width: string; list?: string[] }[] = [
  { key: 'seq', label: '序号', width: 'w-12' },
  { key: 'content', label: '课程内容', width: 'min-w-56' },
  { key: 'type', label: '课程类型', width: 'w-24' },
  { key: 'score', label: '期末考分值占比', width: 'w-24' },
  { key: 'difficulty', label: '学习难度', width: 'w-20', list: DIFFICULTY_OPTIONS },
  { key: 'scheduled_at', label: '计划上课时间', width: 'w-36' },
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

/** 区块的月份标题：优先用明细里真实的上课日期，取不到用兜底年月 */
function monthOfItems(dates: string[], fallbackYearMonth: string): string {
  for (const d of dates) {
    const m = /^(\d{4})-(\d{1,2})/.exec(String(d || ''));
    if (m) return `${Number(m[2])}月`;
  }
  return monthLabel(fallbackYearMonth);
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
  const [examSuggestions, setExamSuggestions] = useState<ExamSuggestion[] | null>(null);
  const [examLoading, setExamLoading] = useState(false);
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
  const examItems = useMemo(() => items.filter((i) => i.kind === 'exam'), [items]);

  /** 两个区块的月份标题，跟服务端导出 Excel 的算法保持一致 */
  const summaryMonth = useMemo(
    () => monthOfItems(summaryItems.map((i) => i.scheduled_at), report?.year_month ?? ''),
    [summaryItems, report?.year_month]
  );
  const planMonth = useMemo(
    () => monthOfItems(planItems.map((i) => i.scheduled_at), nextYearMonth(report?.year_month ?? '')),
    [planItems, report?.year_month]
  );

  /** 图片卡片输入：关掉哪个开关就不出哪一块 */
  const cardInput = useMemo<ReportCardInput>(() => {
    if (!report) return { blocks: [] };
    const byDate = (d?: string) => d || '9999-12-31';
    const courseEntry = (i: ReportItem) => ({ date: i.scheduled_at, text: i.content });
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
        entries: [...planItems.map(courseEntry), ...examItems.map((i) => ({ ...courseEntry(i), highlight: true }))].sort(
          (a, b) => byDate(a.date).localeCompare(byDate(b.date))
        ),
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

  async function addItem(kind: 'summary' | 'plan' | 'exam', body: Record<string, unknown> = {}) {
    if (!report) return;
    try {
      const data = await api.request<{ item: ReportItem }>(`/reports/${report.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ kind, ...body }),
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

  async function fetchExams(insert: boolean) {
    if (!report) return;
    setExamLoading(true);
    try {
      const data = await api.request<{ suggestions: ExamSuggestion[]; inserted: number }>(
        `/reports/${report.id}/exams`,
        { method: 'POST', body: JSON.stringify({ insert }) }
      );
      setExamSuggestions(data.suggestions);
      if (insert) {
        toast.success('已加入 ' + data.inserted + ' 次阶测安排');
        await reload(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '阶测推算失败');
    } finally {
      setExamLoading(false);
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
              <Button
                variant="outline"
                size="sm"
                icon={<Sparkles className="h-4 w-4" />}
                loading={examLoading}
                onClick={() => void fetchExams(false)}
              >
                自动推算阶测
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void addItem('exam', { content: '阶测安排' })}>
                手动加阶测
              </Button>
            </div>
          )
        }
      intro={
        <Textarea
          label="本月规划"
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
        grade={report.grade}
        subject={report.subject}
        onClose={() => setShowPicker(null)}
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
            });
            added++;
          }
          setShowPicker(null);
          toast.success('已添加 ' + added + ' 门课');
        }}
      />

      <ExamDialog
        open={!!examSuggestions}
        suggestions={examSuggestions || []}
        loading={examLoading}
        onClose={() => setExamSuggestions(null)}
        onInsert={() =>
          void (async () => {
            setExamSuggestions(null);
            await fetchExams(true);
          })()
        }
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

function CoursePicker({
  open,
  kind,
  grade,
  subject,
  onClose,
  onPick,
}: {
  open: boolean;
  kind: 'summary' | 'plan';
  grade: string;
  subject: string;
  onClose: () => void;
  onPick: (courses: CatalogCourseOption[]) => Promise<void>;
}) {
  const [courses, setCourses] = useState<CatalogCourseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setType('');
    setPicked(new Set());
    setLoading(true);
    const params = new URLSearchParams({ limit: '1000' });
    if (grade) params.set('grade', grade);
    if (subject) params.set('subject', subject);
    api
      .request<{ courses: CatalogCourseOption[]; total: number }>(`/catalog/courses?${params}`)
      .then((r) => setCourses(r.courses))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, [open, grade, subject]);

  const filtered = useMemo(() => {
    let list = courses;
    if (type) list = list.filter((c) => c.type === type);
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (c) => c.content.toLowerCase().includes(k) || (c.textbook || '').toLowerCase().includes(k)
      );
    }
    return list;
  }, [courses, keyword, type]);

  const typeOptions = useMemo(() => Array.from(new Set(courses.map((c) => c.type).filter(Boolean))), [courses]);

  return (
    <Modal open={open} onClose={onClose} title={'从课程目录添加 · ' + (kind === 'plan' ? '规划' : '总结')} size="lg"
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
                  await onPick(courses.filter((c) => picked.has(c.id)));
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
            placeholder="搜索课程内容 / 教材"
            aria-label="搜索"
          />
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="全部类型"
            options={typeOptions.map((t) => ({ value: t, label: t }))}
            aria-label="课程类型"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-100">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-400">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              没有匹配的课程。
              <Link to="/catalog" className="ml-1 text-brand-600 hover:underline">
                去课程目录导入
              </Link>
            </div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className={cn('cursor-pointer border-b border-slate-50 last:border-0', picked.has(c.id) ? 'bg-brand-50/60' : 'hover:bg-slate-50')}
                    onClick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  >
                    <td className="w-8 px-2 py-1.5 text-center">
                      <input type="checkbox" className="accent-brand-600" checked={picked.has(c.id)} readOnly aria-label="选择" />
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">{c.content}</td>
                    <td className="w-20 px-2 py-1.5 text-slate-400">{c.type}</td>
                    <td className="w-16 px-2 py-1.5 text-slate-400">{c.score}</td>
                    <td className="w-20 px-2 py-1.5 text-slate-400">{c.difficulty}</td>
                    <td className="w-24 truncate px-2 py-1.5 text-slate-400">{c.textbook}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ExamDialog({
  open,
  suggestions,
  loading,
  onClose,
  onInsert,
}: {
  open: boolean;
  suggestions: ExamSuggestion[];
  loading: boolean;
  onClose: () => void;
  onInsert: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="自动推算的阶测安排"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button icon={<Sparkles className="h-4 w-4" />} disabled={suggestions.length === 0 || loading} onClick={onInsert}>
            全部加入规划
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-xs text-slate-400">
          按规划里已有上课时间的跨度推算：学期每 3 周一次，寒暑假每 2 周一次。加入后仍可以改时间。
        </p>
        {suggestions.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">跨度不够排一次阶测</div>
        ) : (
          suggestions.map((s) => (
            <div key={s.date} className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2">
              <span className="text-sm text-slate-700">{s.content}</span>
              <Badge tone="violet">{s.date.slice(5).replace('-', '.')}</Badge>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
