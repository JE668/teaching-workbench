import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  AlertCircle,
  History,
  Archive,
  RotateCcw,
  Loader2,
  Clock,
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
import { getSummaryPlaceholder, getPlanPlaceholder } from '../shared/reportTemplate';
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingText, setSavingText] = useState(false);
  const [aiField, setAiField] = useState<'summary' | 'plan' | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const [showPicker, setShowPicker] = useState<'summary' | 'plan' | null>(null);
  const [showImportLastMonth, setShowImportLastMonth] = useState(false);
  const [importingLastMonth, setImportingLastMonth] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiError, setAiError] = useState<{ status?: number; detail?: any; message: string } | null>(null);

  // 草稿历史
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [draftHistory, setDraftHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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

  // URL 参数触发 AI 生成：?aiGenerate=summary 或 ?aiGenerate=plan
  useEffect(() => {
    const aiGenerate = searchParams.get('aiGenerate');
    if (aiGenerate === 'summary' && report?.summary_enabled && summaryItems.length > 0) {
      void runAi('summary');
    } else if (aiGenerate === 'plan' && report?.plan_enabled && planItems.length > 0) {
      void runAi('plan');
    }
  }, [report?.summary_enabled, report?.plan_enabled, summaryItems.length, planItems.length, searchParams]);

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

  /**
   * 从上月规划导入到本月总结。
   * 上月规划里的课程默认都是已上的，所以导入到总结后自动标记出勤/笔记/作业完成。
   */
  async function importFromLastMonth() {
    if (!report || !report.student_id) return;
    setImportingLastMonth(true);
    try {
      // 查询该学生的所有报告，找到上个月的
      const res = await api.request<{ reports: MonthlyReport[] }>(
        `/reports?studentId=${report.student_id}`
      );
      // 按时间排序，找到当前报告的前一个月
      const sorted = res.reports.sort((a, b) => a.year_month.localeCompare(b.year_month));
      const currentIndex = sorted.findIndex((r) => r.id === report.id);
      if (currentIndex === -1 || currentIndex === 0) {
        toast.error('没有找到上月的报告');
        return;
      }
      const lastReport = sorted[currentIndex - 1];

      // 获取上月的报告详情
      const lastReportData = await api.request<{ report: MonthlyReport; items: ReportItem[] }>(
        `/reports/${lastReport.id}`
      );
      const planItems = lastReportData.items.filter((i) => i.kind === 'plan');

      if (planItems.length === 0) {
        toast.error('上月的规划里没有课程内容');
        return;
      }

      // 导入到本月总结
      let added = 0;
      for (const item of planItems) {
        await addItem('summary', {
          content: item.content,
          type: item.type,
          score: item.score,
          difficulty: item.difficulty,
          course_id: item.course_id, // 保持目录关联
        });
        added++;
      }

      toast.success('已从上月规划导入 ' + added + ' 门课');
      setShowImportLastMonth(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImportingLastMonth(false);
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

  // 草稿历史相关函数
  const loadDraftHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await api.getDraftHistory(20);
      setDraftHistory(res.history || []);
    } catch (err: any) {
      toast.error('加载草稿历史失败：' + err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const restoreDraft = async (item: any) => {
    try {
      const res = await api.restoreDraftHistory(item.id);
      if (res.success && res.payload) {
        // 恢复总结/规划文本
        if (res.payload.summaryIntro) setReport((prev) => prev ? ({ ...prev, summaryIntro: res.payload.summaryIntro } as MonthlyReport) : prev);
        if (res.payload.planIntro) setReport((prev) => prev ? ({ ...prev, planIntro: res.payload.planIntro } as MonthlyReport) : prev);
        if (res.payload.farewell) setReport((prev) => prev ? ({ ...prev, farewell: res.payload.farewell } as MonthlyReport) : prev);
        // 恢复明细行
        if (res.payload.items) setItems(res.payload.items);
        setShowHistoryPanel(false);
        toast.success('已恢复到 ' + new Date(item.createdAt).toLocaleString('zh-CN') + ' 的版本');
      }
    } catch (err: any) {
      toast.error('恢复失败：' + err.message);
    }
  };

  const deleteDraft = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('确定删除这条历史记录吗？')) return;
    try {
      await api.deleteDraftHistory(id);
      setDraftHistory((prev) => prev.filter((h) => h.id !== id));
      toast.success('已删除');
    } catch (err: any) {
      toast.error('删除失败：' + err.message);
    }
  };

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
    setAiError(null); // 清除之前的错误
    setIntro(introKey, '');

    try {
      await api.streamPost(
        `/reports/${report.id}/ai/stream`,
        { field },
        {
          onDelta: (text) => appendIntro(introKey, text),
          onRegenerating: () => toast.info('字数不达标，正在重新生成一次……'),
          onDone: ({ content }) => {
            if (!content) {
              toast.error('AI 未返回任何内容，请检查模型配置后重试');
              return;
            }
            void patchText(introKey, content);
            toast.success('AI 编写完成，可以直接改');
          },
          onError: (msg, err) => {
            const status = err?.status;
            const detail = err?.detail;
            setAiError({
              status,
              detail,
              message: msg,
            });
            toast.error(msg);
          },
        },
        controller.signal
      );
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        const status = (e as any)?.status;
        const detail = (e as any)?.detail;
        setAiError({
          status,
          detail,
          message: e instanceof Error ? e.message : 'AI 编写失败',
        });
        toast.error(e instanceof Error ? e.message : 'AI 编写失败');
      }
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
          {/* 草稿历史按钮 */}
          <button
            type="button"
            onClick={() => {
              setShowHistoryPanel(!showHistoryPanel);
              if (!showHistoryPanel) loadDraftHistory();
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs shadow-soft ring-1 transition-all duration-200',
              showHistoryPanel
                ? 'bg-brand-50 text-brand-700 ring-brand-200 shadow-soft'
                : 'bg-white text-slate-600 ring-slate-100 hover:bg-slate-50'
            )}
            title={showHistoryPanel ? '关闭历史面板' : '查看草稿历史（最近 20 条自动保存）'}
          >
            <History className="h-3.5 w-3.5" />
            <span className="font-medium">草稿历史</span>
          </button>
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
              <Button
                variant="ghost"
                size="sm"
                icon={<CalendarDays className="h-4 w-4" />}
                loading={importingLastMonth}
                onClick={() => setShowImportLastMonth(true)}
                title="从上月规划导入到本月总结"
              >
                从上月导入
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
            placeholder={getSummaryPlaceholder()}
            value={report.summary_intro}
            onChange={(e) => setReport({ ...report, summary_intro: e.target.value })}
            onBlur={(e) => void patchText('summary_intro', e.target.value)}
            rows={6}
          />
        }
        body={
          <>
            {aiError && aiField === 'summary' && (
              <div className="mb-3 p-3 rounded-xl bg-red-50 ring-1 ring-red-100 animate-fade-up">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-red-700">AI 生成失败</p>
                    <p className="mt-1 text-xs text-red-600 font-mono">{aiError.message}</p>
                    {aiError.status && <p className="mt-1 text-xs text-red-500">HTTP {aiError.status}</p>}
                    {aiError.detail && (
                      <details className="mt-2">
                        <summary className="text-xs text-red-500 cursor-pointer underline">查看完整错误详情</summary>
                        <pre className="mt-1 text-[10px] text-red-400 bg-red-100 p-2 rounded overflow-auto max-h-24 whitespace-pre-wrap">
                          {JSON.stringify(aiError.detail, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            )}
            <ItemTable cols={SUMMARY_COLS} items={summaryItems} onPatch={patchItem} onRemove={removeItem} onMove={moveItem} />
          </>
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
          placeholder={getPlanPlaceholder()}
          value={report.plan_intro}
          onChange={(e) => setReport({ ...report, plan_intro: e.target.value })}
          onBlur={(e) => void patchText('plan_intro', e.target.value)}
          rows={3}
        />
      }
      body={
        <>
          {aiError && aiField === 'plan' && (
            <div className="mb-3 p-3 rounded-xl bg-red-50 ring-1 ring-red-100 animate-fade-up">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-red-700">AI 生成失败</p>
                  <p className="mt-1 text-xs text-red-600 font-mono">{aiError.message}</p>
                  {aiError.status && <p className="mt-1 text-xs text-red-500">HTTP {aiError.status}</p>}
                  {aiError.detail && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-500 cursor-pointer underline">查看完整错误详情</summary>
                      <pre className="mt-1 text-[10px] text-red-400 bg-red-100 p-2 rounded overflow-auto max-h-24 whitespace-pre-wrap">
                        {JSON.stringify(aiError.detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}
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

      <ConfirmDialog
        open={showImportLastMonth}
        onCancel={() => setShowImportLastMonth(false)}
        onConfirm={() => void importFromLastMonth()}
        loading={importingLastMonth}
        title="从上月规划导入？"
        description="上月规划里的课程会导入到本月总结，并保持课程目录关联。导入后你可以手动调整课程内容。"
        confirmText="导入"
      />

      {/* 草稿历史侧边栏（桌面端） */}
      {showHistoryPanel && (
        <aside className="fixed right-0 top-0 h-full w-96 lg:static lg:h-auto lg:w-auto lg:grid-cols-1" style={{ zIndex: 40 }}>
          <div className="lg:col-span-1">
            <Card className="h-full flex flex-col">
              <CardHeader
                title="草稿历史"
                description="最近 20 条自动保存记录，点击可恢复"
                icon={<Archive className="h-4 w-4" />}
                action={
                  draftHistory.length > 0 ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('确定清空所有草稿历史吗？')) return;
                        try {
                          await api.clearDraftHistory();
                          setDraftHistory([]);
                          toast.success('已清空历史');
                        } catch (err: any) {
                          toast.error('清空失败：' + err.message);
                        }
                      }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      清空全部
                    </button>
                  ) : null
                }
              />
              <div className="flex-1 overflow-y-auto p-4">
                {loadingHistory ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
                  </div>
                ) : draftHistory.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <History className="mx-auto h-10 w-10 mb-2 opacity-50" />
                    <p className="text-sm">暂无草稿历史</p>
                    <p className="text-xs mt-1">编辑内容时会自动记录</p>
                  </div>
                ) : (
                  <ul className="space-y-3" role="list">
                    {draftHistory.map((item) => (
                      <li
                        key={item.id}
                        onClick={() => restoreDraft(item)}
                        className="group relative p-3 rounded-xl bg-slate-50 ring-1 ring-slate-100 hover:bg-slate-100 hover:ring-slate-200 transition-all cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2 pr-8">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs mb-1">
                              <span className="font-medium text-slate-700 truncate">
                                {item.payload?.summaryIntro || item.payload?.planIntro || '月度总结/规划草稿'}
                              </span>
                              <span className="text-slate-400 whitespace-nowrap">
                                {new Date(item.createdAt).toLocaleString('zh-CN')}
                              </span>
                              <span
                                className={cn(
                                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                                  item.source === 'ai'
                                    ? 'bg-purple-50 text-purple-700 ring-purple-200'
                                    : item.source === 'manual'
                                    ? 'bg-brand-50 text-brand-700 ring-brand-200'
                                    : 'bg-slate-50 text-slate-600 ring-slate-200'
                                )}
                              >
                                {item.source === 'ai' ? 'AI' : item.source === 'manual' ? '手动' : '自动'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 line-clamp-2">
                              {item.payload?.summaryIntro
                                ? item.payload.summaryIntro.slice(0, 80) + '…'
                                : item.payload?.planIntro
                                ? item.payload.planIntro.slice(0, 80) + '…'
                                : '无内容预览'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => deleteDraft(item.id, e)}
                            className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity p-1"
                            aria-label="删除此历史记录"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                          <span>点击恢复此版本</span>
                          <RotateCcw className="h-3 w-3" />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </aside>
      )}

      {/* 移动端抽屉遮罩 */}
      {showHistoryPanel && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          onClick={() => setShowHistoryPanel(false)}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-black/30" />
        </div>
      )}
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
  const [batchUpdating, setBatchUpdating] = useState<string | null>(null);

  const batchUpdate = async (field: 'attendance' | 'notes_done' | 'mistakes_done' | 'homework_done', value: string) => {
    if (items.length === 0) return;
    setBatchUpdating(field);
    try {
      await Promise.all(
        items.map((item) => onPatch(item.id, field, value))
      );
    } finally {
      setBatchUpdating(null);
    }
  };

  return (
    <div>
      {/* 批量操作栏（仅当有出勤/作业等列时显示） */}
      {items.length > 1 && cols.some((c) => ['attendance', 'notes_done', 'mistakes_done', 'homework_done'].includes(c.key)) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">批量设置：</span>
          {cols.map((c) => {
            if (!['attendance', 'notes_done', 'mistakes_done', 'homework_done'].includes(c.key)) return null;
            return (
              <Select
                key={c.key}
                value=""
                onChange={(e) => void batchUpdate(c.key as any, e.target.value)}
                options={c.list?.map((v) => ({ value: v, label: v })) ?? []}
                placeholder={c.label}
                className="h-8 w-24 text-xs"
                disabled={batchUpdating !== null}
                aria-label={`批量设置 ${c.label}`}
              />
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              {cols.map((c) => (
                <th key={c.key} className={`pb-2 pr-2 ${c.width}`}>
                  {c.label}
                </th>
              ))}
              <th className="w-20 pb-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr
                key={item.id}
                className={cn(
                  'border-b border-slate-50 last:border-0 transition-colors',
                  item.id < 0 && 'bg-brand-50/40'
                )}
              >
                {cols.map((c) => (
                  <td key={c.key} className={`py-1.5 pr-2 ${c.width}`}>
                    {c.key === 'seq' ? (
                      <span className="text-slate-400">{idx + 1}</span>
                    ) : c.list ? (
                      <Select
                        value={String(item[c.key] ?? '')}
                        onChange={(e) => void onPatch(item.id, c.key, e.target.value)}
                        options={c.list.map((v) => ({ value: v, label: v }))}
                        className="h-8 w-full text-xs"
                        placeholder="—"
                      />
                    ) : c.key === 'content' ? (
                      <Input
                        value={String(item[c.key] ?? '')}
                        onChange={(e) => void onPatch(item.id, c.key, e.target.value)}
                        placeholder="课程内容"
                        className="h-8 text-xs"
                        autoFocus={item.id < 0 && idx === 0}
                      />
                    ) : (
                      <Input
                        value={String(item[c.key] ?? '')}
                        onChange={(e) => void onPatch(item.id, c.key, e.target.value)}
                        placeholder="—"
                        className="h-8 text-xs"
                      />
                    )}
                  </td>
                ))}
                <td className="w-20 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void onMove(item.id, 'up')}
                      disabled={idx === 0}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                      aria-label="上移"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onMove(item.id, 'down')}
                      disabled={idx === items.length - 1}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                      aria-label="下移"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRemove(item.id)}
                      className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"
                      aria-label="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={item.id} className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 ring-1 ring-slate-100">
          <span className="w-12 text-center text-xs text-slate-400">{idx + 1}</span>
          <Input
            value={String(item.content ?? '')}
            onChange={(e) => void onPatch(item.id, 'content', e.target.value)}
            placeholder="阶测内容"
            className="flex-1 h-8 text-sm"
          />
          <Input
            value={String(item.scheduled_at ?? '')}
            onChange={(e) => void onPatch(item.id, 'scheduled_at', e.target.value)}
            placeholder="YYYY-MM-DD"
            className="w-28 h-8 text-sm"
            type="date"
          />
          <button
            type="button"
            onClick={() => void onMove(item.id, 'up')}
            disabled={idx === 0}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            aria-label="上移"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void onMove(item.id, 'down')}
            disabled={idx === items.length - 1}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            aria-label="下移"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void onRemove(item.id)}
            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 ml-auto"
            aria-label="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function CoursePicker({
  open,
  kind,
  subject,
  reportGrade,
  reportTerm,
  addedIds,
  onClose,
  onCoursesUsed,
  onPick,
}: {
  open: boolean;
  kind: 'summary' | 'plan';
  subject?: string;
  reportGrade?: string;
  reportTerm?: string;
  addedIds: Set<number>;
  onClose: () => void;
  onCoursesUsed: (courseIds: number[]) => void;
  onPick: (courses: CatalogCourseOption[]) => Promise<void>;
}) {
  const [courses, setCourses] = useState<CatalogCourseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [termFilter, setTermFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setLoading(true);
      setPicked(new Set());
      api
        .request<{ courses: CatalogCourseOption[] }>('/catalog/courses', { method: 'GET' })
        .then((res) => {
          let filtered = res.courses;
          if (subject) filtered = filtered.filter((c) => c.subject === subject);
          if (reportGrade) filtered = filtered.filter((c) => c.grade === reportGrade);
          if (reportTerm) filtered = filtered.filter((c) => c.term === reportTerm);
          setCourses(filtered);
        })
        .catch(() => toast.error('加载课程目录失败'))
        .finally(() => setLoading(false));
    }
  }, [open, subject, reportGrade, reportTerm]);

  const resetAll = () => {
    setSearch('');
    setGradeFilter('');
    setTermFilter('');
    setTypeFilter('');
  };

  const hasFilter = search || gradeFilter || termFilter || typeFilter;

  const filtered = useMemo(() => {
    return courses
      .filter((c) => !addedIds.has(c.id))
      .filter((c) => {
        if (search && !c.content.toLowerCase().includes(search.toLowerCase())) return false;
        if (gradeFilter && c.grade !== gradeFilter) return false;
        if (termFilter && c.term !== termFilter) return false;
        if (typeFilter && c.type !== typeFilter) return false;
        return true;
      });
  }, [courses, search, gradeFilter, termFilter, typeFilter, addedIds]);

  const toggle = (course: CatalogCourseOption) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(course.id)) next.delete(course.id);
      else next.add(course.id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (picked.size === 0) return;
    const selected = courses.filter((c) => picked.has(c.id));
    await onPick(selected);
    onCoursesUsed(Array.from(picked));
    onClose();
  };

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="从课程目录添加" subtitle={`已添加 ${picked.size} 门，确认后批量加入${kind === 'summary' ? '总结' : '规划'}`} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="搜索课程内容…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] h-8"
            icon={<Search className="h-4 w-4" />}
            aria-label="搜索课程"
          />
          <Select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            options={['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'].map((g) => ({ value: g, label: g || '全部年级' }))}
            className="h-8 w-28"
            placeholder="全部年级"
          />
          <Select
            value={termFilter}
            onChange={(e) => setTermFilter(e.target.value)}
            options={['', '上学期', '下学期', '寒假', '暑假'].map((t) => ({ value: t, label: t || '全部学期' }))}
            className="h-8 w-28"
            placeholder="全部学期"
          />
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={['', '新授课', '复习课', '专题课', '错题课', '测试课', '其他'].map((t) => ({ value: t, label: t || '全部类型' }))}
            className="h-8 w-28"
            placeholder="全部类型"
          />
          {hasFilter && (
            <button onClick={resetAll} className="ml-auto h-8 px-3 text-xs text-brand-600 hover:underline">
              重置筛选
            </button>
          )}
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
                {filtered.map((c) => {
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

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={picked.size === 0 || loading} icon={<Plus className="h-4 w-4" />}>
            确认添加 {picked.size} 门
          </Button>
        </div>
      </div>
    </Modal>
  );
}