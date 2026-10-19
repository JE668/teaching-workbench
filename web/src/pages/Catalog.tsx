import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Upload,
  FileSpreadsheet,
  Trash2,
  RotateCcw,
  Star,
  Search,
  Sparkles,
  Loader2,
  X,
  UserCheck,
} from 'lucide-react';
import { api } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { Input, Select } from '../components/ui/Field';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';

/**
 * 课程目录。
 *
 * 老师自己维护两份 Excel（高中 / 小初），列布局不统一、合并单元格很多，
 * 手工搬进来不现实。这里做批量导入 + 浏览，后面「课程总结」「课程规划」都从这取数。
 */

interface CatalogCourse {
  id: number;
  import_id: number | null;
  band: string;
  term: string;
  grade: string;
  subject: string;
  track: string;
  seq: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  impact: string;
  textbook: string;
  section: string;
  sheet: string;
  source_row: number;
  mastery_star: number | null;
  created_at: string;
  updated_at: string;
}

interface CatalogImport {
  id: number;
  band: string;
  filename: string;
  file_sha256: string;
  courses_total: number;
  courses_imported: number;
  courses_duplicated: number;
  failed_sheets: string[];
  created_at: string;
}

/** 目录 ↔ 报告 / 听评课打通：一门课被用过几次 */
interface CourseUsageEntry {
  report_id: number;
  student_id: number | null;
  student_name: string;
  year_month: string;
  kind: 'summary' | 'plan';
  /** 记录来自月度报告还是听评课 */
  source: 'report' | 'observation';
}

interface CourseUsage {
  course_id: number;
  /** 记在「已上的课」里的次数 */
  taught: number;
  /** 记在「下月要上的课」里的次数 */
  planned: number;
  /** 有老师旁听过几节课（听评课） */
  observed: number;
  entries: CourseUsageEntry[];
}

interface Facets {
  grades: string[];
  subjects: string[];
  terms: string[];
  types: string[];
  tracks: string[];
  textbooks: string[];
}

interface SheetSummary {
  sheet: string;
  grade: string;
  subject: string;
  courses: number;
  error?: string;
}

/** AI 批量定档的进度 */
interface SuggestProgress {
  batch: number;
  totalBatches: number;
  done: number;
  total: number;
}

type ImportResult = {
  dryRun?: boolean;
  importId?: number;
  filename?: string;
  band?: string;
  coursesTotal?: number;
  coursesImported?: number;
  coursesDuplicated?: number;
  failedSheets?: string[];
  sheets?: SheetSummary[];
};

const BANDS = [
  { value: '高中', label: '高中' },
  { value: '小初', label: '小初' },
];

const trackTone = (track: string) =>
  track === '拓展拔尖' ? 'violet' : track === '进阶' ? 'info' : 'neutral';

const STAR_OPTIONS = [1, 2, 3, 4, 5];

/** 掌握星级就地编辑：点 ★ 设置，点当前值取消 */
function StarEditor({ value, onPick }: { value: number | null; onPick: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-0.5" data-testid="star-editor">
      {STAR_OPTIONS.map((n) => (
        <button
          key={n}
          type="button"
          title={'点击设为 ' + n + ' 星'}
          onClick={() => onPick(value === n ? null : n)}
          className={cn(
            'rounded p-0.5 transition-colors',
            value !== null && n <= value ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'
          )}
        >
          <Star size={13} fill={value !== null && n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

/** 每个分组先展示的课程条数，其余按需展开 */
const GROUP_PAGE_SIZE = 12;

/** 「已上 3 · 计划 1 · 听课 1」小标签：点一下看是哪些学生 */
function UsageChip({
  usage,
  onShow,
}: {
  usage: CourseUsage;
  onShow: () => void;
}) {
  const parts = [
    usage.taught > 0 ? '已上' + usage.taught : '',
    usage.planned > 0 ? '计划' + usage.planned : '',
    usage.observed > 0 ? '听课' + usage.observed : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <button
      type="button"
      onClick={onShow}
      title="点一下看是哪些学生、上过还是听课"
      className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-100"
    >
      <UserCheck size={11} />
      {parts.join(' · ')}
    </button>
  );
}

/** 一门课的使用明细：哪些学生、哪个月、已上还是计划，还有谁听过这节 */
function UsageDialog({ course, usage, onClose }: { course: CatalogCourse | null; usage: CourseUsage | undefined; onClose: () => void }) {
  if (!course) return null;
  const u = usage || { course_id: course.id, taught: 0, planned: 0, observed: 0, entries: [] };
  const parts = [
    u.taught > 0 ? '已上 ' + u.taught + ' 次' : '',
    u.planned > 0 ? '计划 ' + u.planned + ' 次' : '',
    u.observed > 0 ? '听课 ' + u.observed + ' 次' : '',
  ].filter(Boolean);
  return (
    <Modal open title={'「' + course.content + '」上过哪些课'} onClose={onClose} footer={null}>
      <p className="text-sm text-slate-500">{parts.length ? parts.join(' · ') : '还没有记录'}</p>
      {u.entries.length ? (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-100">
          {u.entries.map((e, i) => (
            <div
              key={e.report_id + ':' + i}
              className="flex items-center justify-between gap-2 border-b border-slate-50 px-3 py-2 text-sm last:border-0"
            >
              <span className="font-medium text-slate-700">
                {e.student_name || '未填姓名'}
                {e.source === 'observation' && <span className="ml-1.5 text-xs font-normal text-slate-400">（听课）</span>}
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {e.year_month}
                <Badge tone={e.source === 'observation' ? 'success' : e.kind === 'summary' ? 'brand' : 'info'}>
                  {e.source === 'observation' ? '听课' : e.kind === 'summary' ? '已上' : '计划'}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">还没有学生上过这门课。</p>
      )}
    </Modal>
  );
}

/**
 * 按学生看进度：这门课对这个学生来说是已上 / 计划 / 还没上。
 * months 里是已经上的那几个月（已上模式）或计划的那几个月（计划模式）。
 */
interface CourseProgress {
  kind: 'taught' | 'planned' | 'none';
  months: string[];
}

/** 从 usage 聚合里抽出某一个学生的进度。usage 传 student_id 拉来的口径已经是这个学生的。 */
function progressOf(usage: Record<string, CourseUsage>, courseId: number): CourseProgress {
  const u = usage[String(courseId)];
  if (!u) return { kind: 'none', months: [] };
  const taught = u.entries.filter((e) => e.kind === 'summary').map((e) => e.year_month);
  if (taught.length) return { kind: 'taught', months: taught };
  const planned = u.entries.filter((e) => e.kind === 'plan').map((e) => e.year_month);
  if (planned.length) return { kind: 'planned', months: planned };
  return { kind: 'none', months: [] };
}

/** 进度模式下的行内标记：已上（哪几个月）/ 计划（哪几个月）/ 未上 */
function ProgressBadge({ progress }: { progress: CourseProgress }) {
  if (progress.kind === 'none') {
    return <span className="text-[11px] text-slate-300">未上</span>;
  }
  const taught = progress.kind === 'taught';
  const label = taught ? '已上' : '计划';
  return (
    <span
      title={label + '：' + progress.months.join('、')}
      className={cn(
        'mt-1 inline-flex max-w-full items-center truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        taught ? 'bg-emerald-50 text-emerald-700' : 'bg-info-50 text-info-700'
      )}
    >
      {label + (progress.months.length ? ' ' + progress.months.join('、') : '')}
    </span>
  );
}

/** 一个分组（年级+学科 · 学期 · 轨）的课程表。
 *
 * 分组内分页，几百门课不会一次性铺满整个页面；
 * 窄屏隐藏序号 / 分值占比 / 教材，手机上留辅导内容、课程类型、难度、掌握四列。
 */
function CourseGroupCard({
  name,
  list,
  usage,
  onPickStar,
  onShowUsage,
  studentId,
}: {
  name: string;
  list: CatalogCourse[];
  /** course_id → 已上/计划次数 */
  usage: Record<string, CourseUsage>;
  onPickStar: (course: CatalogCourse, value: number | null) => void;
  onShowUsage: (course: CatalogCourse) => void;
  /** 非空时是「按学生看进度」模式，行内显示这个学生上过没有 */
  studentId: string;
}) {
  const [visible, setVisible] = useState(GROUP_PAGE_SIZE);
  const rest = Math.max(0, list.length - visible);
  const inProgressMode = studentId !== '';

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm font-medium text-slate-600">
        {name}
        <span className="ml-2 text-xs font-normal text-slate-400">
          {list.length} 条{visible < list.length ? ' · 已显示 ' + visible : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="hidden px-3 py-2 font-medium sm:table-cell">序号</th>
              <th className="px-3 py-2 font-medium">辅导内容</th>
              <th className="px-3 py-2 font-medium">课程类型</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">分值占比</th>
              <th className="px-3 py-2 font-medium">难度</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">教材</th>
              <th className="px-3 py-2 font-medium">掌握</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, visible).map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <td className="hidden px-3 py-2 text-slate-400 sm:table-cell">{c.seq}</td>
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-700">{c.content}</span>
                  {c.section && (
                    <span className="ml-1.5 inline-block align-middle text-[11px] text-amber-600">
                      「{c.section}」
                    </span>
                  )}
                  {inProgressMode ? (
                    <ProgressBadge progress={progressOf(usage, c.id)} />
                  ) : (
                    usage[String(c.id)] && (
                      <UsageChip usage={usage[String(c.id)]!} onShow={() => onShowUsage(c)} />
                    )
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={c.type === '专题' ? 'brand' : c.type === '预习' ? 'info' : 'neutral'}>{c.type || '—'}</Badge>
                </td>
                <td className="hidden px-3 py-2 text-slate-500 md:table-cell">{c.score || '—'}</td>
                <td className="px-3 py-2 text-amber-500">{c.difficulty || '—'}</td>
                <td className="hidden px-3 py-2 text-slate-500 md:table-cell">{c.textbook || '—'}</td>
                <td className="px-3 py-1.5">
                  <StarEditor value={c.mastery_star} onPick={(v) => onPickStar(c, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rest > 0 ? (
        <div className="border-t border-slate-100 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisible((n) => Math.min(n + GROUP_PAGE_SIZE, list.length))}
          >
            展开更多 · 还有 {rest} 条
          </Button>
        </div>
      ) : visible > GROUP_PAGE_SIZE ? (
        <div className="border-t border-slate-100 px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setVisible(GROUP_PAGE_SIZE)}>
            收起
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export default function Catalog() {
  const toast = useToast();
  const [courses, setCourses] = useState<CatalogCourse[]>([]);
  const [facets, setFacets] = useState<Facets>({ grades: [], subjects: [], terms: [], types: [], tracks: [], textbooks: [] });
  const [imports, setImports] = useState<CatalogImport[]>([]);
  // 目录 ↔ 报告打通：course_id → 已上/计划次数
  const [usage, setUsage] = useState<Record<string, CourseUsage>>({});
  const [usageCourse, setUsageCourse] = useState<CatalogCourse | null>(null);
  // 按学生看进度：校区里的学生列表
  const [students, setStudents] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // 筛选条件读写地址栏：刷新不丢、手机上能分享某个视图、也能直接回跳
  const [params, setParams] = useSearchParams();
  const grade = params.get('grade') ?? '';
  const subject = params.get('subject') ?? '';
  const term = params.get('term') ?? '';
  const type = params.get('type') ?? '';
  const track = params.get('track') ?? '';
  const textbook = params.get('textbook') ?? '';
  const q = params.get('q') ?? '';
  // 选中某个学生 = 「按学生看进度」模式
  const student = params.get('student') ?? '';

  const setFilter = useCallback(
    (key: string, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const hasFilter = !!(grade || subject || term || type || track || textbook || q);
  // 清筛选只清筛选：选中的学生属于「看进度模式」，不该被一起清掉
  const clearFilters = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams();
          const s = prev.get('student');
          if (s) next.set('student', s);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );

  // 导入
  const [importOpen, setImportOpen] = useState(false);
  const [band, setBand] = useState('高中');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<CatalogImport | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 拉一次使用情况。studentId 非空时只拉这个学生的（进度模式）。 */
  const loadUsage = useCallback((studentId: string) => {
    void api
      .request<{ usage: Record<string, CourseUsage> }>(
        '/catalog/usage' + (studentId ? '?student_id=' + encodeURIComponent(studentId) : '')
      )
      .then((r) => setUsage(r.usage))
      .catch(() => setUsage({}));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [f, cs, im] = await Promise.all([
        api.request<Facets>('/catalog/facets'),
        api.request<{ courses: CatalogCourse[]; total: number }>('/catalog/courses?limit=20000'),
        api.request<{ imports: CatalogImport[] }>('/catalog/imports'),
      ]);
      setFacets(f);
      setCourses(cs.courses);
      setImports(im.imports);
      void api
        .request<{ students: { id: number; name: string }[] }>('/students')
        .then((r) => setStudents((r.students || []).map((s) => ({ id: s.id, name: s.name }))))
        .catch(() => setStudents([]));
    } catch (e: any) {
      toast.error(e.message || '加载课程目录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 使用情况跟着「选中了哪个学生」走；目录不用重拉
  useEffect(() => {
    loadUsage(student);
  }, [student, loadUsage]);

  const submitImport = async (dryRun: boolean) => {
    if (!pickedFile) {
      toast.error('请先选择 Excel 文件');
      return;
    }
    if (!/\.xlsx$/i.test(pickedFile.name)) {
      toast.error('仅支持 .xlsx 格式');
      return;
    }
    const fd = new FormData();
    fd.append('file', pickedFile);
    fd.append('band', band);
    if (dryRun) fd.append('dryRun', '1');

    setImporting(true);
    setImportResult(null);
    try {
      const res = await api.upload<ImportResult>('/catalog/import', fd);
      setImportResult(res);
      if (!dryRun) {
        toast.success('导入完成，新增 ' + res.coursesImported + ' 条课程');
        await reload();
      }
    } catch (e: any) {
      toast.error(e.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const pickStar = async (course: CatalogCourse, value: number | null) => {
    const prev = course.mastery_star;
    setCourses((list) => list.map((c) => (c.id === course.id ? { ...c, mastery_star: value } : c)));
    try {
      await api.request('/catalog/courses/' + course.id, {
        method: 'PATCH',
        body: JSON.stringify({ mastery_star: value }),
      });
    } catch (e: any) {
      setCourses((list) => list.map((c) => (c.id === course.id ? { ...c, mastery_star: prev } : c)));
      toast.error(e.message || '保存星级失败');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.request('/catalog/imports/' + deleteTarget.id, { method: 'DELETE' });
      toast.success('已删除该次导入及其课程');
      setDeleteTarget(null);
      await reload();
    } catch (e: any) {
      toast.error(e.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  // AI 批量定掌握星级
  const [suggesting, setSuggesting] = useState(false);
  const [suggestInfo, setSuggestInfo] = useState<SuggestProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * 按当前筛选范围让 AI 给未定档的课程定档。
   * 走 SSE 拿进度；中途断了再点一次只补剩下的，不会重复定档。
   */
  const runSuggest = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setSuggesting(true);
    setSuggestInfo(null);
    let updated = 0;
    let total = 0;
    let failed = false;

    try {
      await api.streamPostRaw(
        '/catalog/courses/suggest-stars',
        { grade, subject, term, track, type },
        {
          onEvent: (event, data) => {
            if (event === 'start') {
              total = Number(data.total || 0);
              setSuggestInfo({ batch: 0, totalBatches: 0, done: 0, total });
            } else if (event === 'progress') {
              updated = Number(data.updated || 0);
              setSuggestInfo({
                batch: Number(data.batch || 0),
                totalBatches: Number(data.totalBatches || 0),
                done: updated,
                total: Number(data.total || total),
              });
            } else if (event === 'error') {
              failed = true;
              toast.error(data.error || 'AI 定档失败');
            } else if (event === 'done') {
              updated = Number(data.updated || 0);
            }
          },
        },
        controller.signal
      );
      await reload();
      if (!failed) {
        toast.success(total ? 'AI 已定档 ' + updated + ' 门，点星星可以修改' : '没有待定档的课程');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast.error(e.message || 'AI 定档失败');
    } finally {
      abortRef.current = null;
      setSuggesting(false);
      setSuggestInfo(null);
    }
  };

  const cancelSuggest = () => {
    abortRef.current?.abort();
  };

  // 关键词命中辅导内容 / 分节 / 教材 / 课程类型 / 难度——教材和难度之前搜不到
  const filtered = courses.filter((c) => {
    if (grade && c.grade !== grade) return false;
    if (subject && c.subject !== subject) return false;
    if (term && c.term !== term) return false;
    if (type && c.type !== type) return false;
    if (track && c.track !== track) return false;
    if (textbook && c.textbook !== textbook) return false;
    if (!q) return true;
    return [c.content, c.section, c.textbook, c.type, c.difficulty].some((f) => f.includes(q));
  });

  const byGroup = new Map<string, CatalogCourse[]>();
  for (const c of filtered) {
    const key = c.grade + c.subject + ' · ' + c.term + (c.track ? ' · ' + c.track : '');
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(c);
  }

  /** 当前筛选范围内还没有掌握星期的课程数 */
  const pendingStars = filtered.filter((c) => c.mastery_star == null).length;

  // 进度模式的汇总：当前筛选范围内，这个学生已上 / 计划 / 还没上各多少门
  const progressCounts = (() => {
    if (!student) return null;
    let taught = 0;
    let planned = 0;
    let none = 0;
    for (const c of filtered) {
      const p = progressOf(usage, c.id);
      if (p.kind === 'taught') taught++;
      else if (p.kind === 'planned') planned++;
      else none++;
    }
    return { taught, planned, none };
  })();

  const activeStudentName = (() => {
    if (!student) return null;
    return students.find((s) => String(s.id) === student)?.name || '未知学生';
  })();

  const anyImported = imports.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <BookOpen className="text-brand-500" size={22} />
            课程目录
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            从「全年课程体系目录」Excel 批量导入，供课程总结与课程规划取数
          </p>
        </div>
        <Button onClick={() => { setImportOpen(true); setImportResult(null); setPickedFile(null); }}>
          <Upload size={16} />
          导入目录
        </Button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '课程条目', value: courses.length, icon: <FileSpreadsheet size={15} /> },
          { label: '学科', value: facets.subjects.length, icon: <BookOpen size={15} /> },
          { label: '学期 / 轮次', value: facets.terms.length, icon: <RotateCcw size={15} /> },
          { label: '导入次数', value: imports.length, icon: <Upload size={15} /> },
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <div className="flex items-center gap-2 text-slate-400">
              {s.icon}
              <span className="text-xs">{s.label}</span>
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-800">{loading ? '—' : s.value}</div>
          </Card>
        ))}
      </div>

      {anyImported && (
        <Card>
          <CardHeader
            title="筛选"
            description="全部本地过滤，不用来回请求；条件存在地址栏里，刷新不丢也能分享"
          />
          {students.length > 0 && (
            <div className="border-b border-slate-100 bg-slate-50/40 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-slate-500">看谁进度</span>
                <Select
                  aria-label="按学生查看课程进度"
                  value={student}
                  onChange={(e) => setFilter('student', e.target.value)}
                  options={students.map((s) => ({ value: String(s.id), label: s.name }))}
                  placeholder="全部学生（看总用量）"
                />
                {student && activeStudentName ? (
                  <span className="truncate text-xs text-slate-400">
                    {activeStudentName} · 已上 {progressCounts?.taught ?? 0} · 计划 {progressCounts?.planned ?? 0} · 未上 {progressCounts?.none ?? 0}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 md:grid-cols-3 lg:grid-cols-4">
            <Select
              aria-label="按年级筛选"
              value={grade}
              onChange={(e) => setFilter('grade', e.target.value)}
              options={facets.grades.map((v) => ({ value: v, label: v }))}
              placeholder="全部年级"
            />
            <Select
              aria-label="按学科筛选"
              value={subject}
              onChange={(e) => setFilter('subject', e.target.value)}
              options={facets.subjects.map((v) => ({ value: v, label: v }))}
              placeholder="全部学科"
            />
            <Select
              aria-label="按学期筛选"
              value={term}
              onChange={(e) => setFilter('term', e.target.value)}
              options={facets.terms.map((v) => ({ value: v, label: v }))}
              placeholder="全部学期"
            />
            <Select
              aria-label="按课程类型筛选"
              value={type}
              onChange={(e) => setFilter('type', e.target.value)}
              options={facets.types.map((v) => ({ value: v, label: v }))}
              placeholder="全部类型"
            />
            <Select
              aria-label="按轨筛选"
              value={track}
              onChange={(e) => setFilter('track', e.target.value)}
              options={facets.tracks.map((v) => ({ value: v, label: v }))}
              placeholder="全部轨"
            />
            <Select
              aria-label="按教材版本筛选"
              value={textbook}
              onChange={(e) => setFilter('textbook', e.target.value)}
              options={facets.textbooks.map((v) => ({ value: v, label: v }))}
              placeholder="全部教材版本"
            />
            <Input
              aria-label="搜索辅导内容 / 教材 / 难度"
              value={q}
              onChange={(e) => setFilter('q', e.target.value)}
              placeholder="搜索辅导内容 / 教材 / 难度"
              icon={<Search size={14} />}
            />
            {hasFilter ? (
              <Button variant="outline" onClick={() => clearFilters()}>
                <RotateCcw size="14" />
                清空筛选
              </Button>
            ) : null}
          </div>
        </Card>
      )}

      {/* 课程列表 */}
      {loading ? (
        <ListSkeleton />
      ) : !anyImported ? (
        <Card>
          <EmptyState
            icon={<BookOpen size={28} />}
            title="还没有课程目录"
            description="上传「全年课程体系目录」Excel，自动按年级 / 学科 / 学期拆成可查询的课程条目"
            action={
              <Button onClick={() => { setImportOpen(true); setImportResult(null); }}>
                <Upload size={16} />
                导入目录
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search size={28} />}
            title="没有匹配的课程"
            description="换个筛选条件试试"
            action={
              <Button variant="outline" onClick={() => clearFilters()}>
                <RotateCcw size={16} />
                清空筛选
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-xs text-slate-400">
              共 {filtered.length} 条 · 待定档 <span className="font-medium text-amber-600">{pendingStars}</span> 条
              · 点击星星可直接设掌握星级
              {progressCounts ? (
                <span className="ml-1">
                  ·{' '}
                  <span className="font-medium text-emerald-600">已上 {progressCounts.taught}</span>
                  {' · '}
                  <span className="font-medium text-info-600">计划 {progressCounts.planned}</span>
                  {' · '}
                  <span className="font-medium text-slate-400">未上 {progressCounts.none}</span>
                </span>
              ) : null}
            </p>
            {pendingStars > 0 && (
              <Button size="sm" onClick={() => void runSuggest()} disabled={suggesting}>
                {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {suggesting ? 'AI 定档中' : 'AI 定档'}
              </Button>
            )}
          </div>

          {suggestInfo && suggestInfo.total > 0 && (
            <Card className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 size={15} className="animate-spin text-brand-500" />
                  <span>
                    AI 正在定档
                    {suggestInfo.totalBatches > 0
                      ? ' · 第 ' + suggestInfo.batch + '/' + suggestInfo.totalBatches + ' 批'
                      : ''}
                    {' · 已定 ' + suggestInfo.done + ' 门'}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={cancelSuggest}>
                  <X size={14} />
                  取消
                </Button>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-brand-500 transition-all duration-300"
                  style={{ width: (suggestInfo.done / suggestInfo.total) * 100 + '%' }}
                />
              </div>
            </Card>
          )}

          {[...byGroup.entries()].map(([key, list]) => (
            <CourseGroupCard
              key={key}
              name={key}
              list={list}
              usage={usage}
              onPickStar={pickStar}
              onShowUsage={setUsageCourse}
              studentId={student}
            />
          ))}
        </div>
      )}

      {/* 目录 ↔ 报告打通：这门课已经给谁上过了 */}
      <UsageDialog
        course={usageCourse}
        usage={usageCourse ? usage[String(usageCourse.id)] : undefined}
        onClose={() => setUsageCourse(null)}
      />

      {/* 导入历史 */}
      {anyImported && (
        <Card>
          <CardHeader title="导入历史" description="同一份文件重复上传不会重复灌库" />
          <div className="divide-y divide-slate-100">
            {imports.map((im) => (
              <div key={im.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet size={18} className="text-emerald-500" />
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      {im.filename}
                      <Badge tone="neutral">{im.band}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {im.created_at} · 解析 {im.courses_total} 条 · 新增 {im.courses_imported} 条
                      {im.courses_duplicated > 0 && ' · 跳过重复 ' + im.courses_duplicated + ' 条'}
                      {im.failed_sheets.length > 0 && (
                        <span className="text-red-400"> · {im.failed_sheets.length} 个 sheet 未解析</span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteTarget(im)}
                  data-testid={'delete-import-' + im.id}
                >
                  <Trash2 size={14} />
                  删除
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 导入弹窗 */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入全年课程体系目录"
        description="上传老师维护的 Excel 工作簿，会自动识别 6 种列布局、合并单元格和分区标题"
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              取消
            </Button>
            <Button
              variant="outline"
              onClick={() => void submitImport(true)}
              loading={importing}
              disabled={!pickedFile}
            >
              仅预览
            </Button>
            <Button onClick={() => void submitImport(false)} loading={importing} disabled={!pickedFile}>
              <Upload size={16} />
              导入
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="学段"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              options={BANDS}
            />
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Excel 文件 <span className="text-red-400">*</span>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="block w-full text-sm text-slate-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover=file:bg-brand-100"
                onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
                data-testid="catalog-file-input"
              />
            </div>
          </div>

          {pickedFile && (
            <p className="text-xs text-slate-400">
              已选择 {pickedFile.name}（{(pickedFile.size / 1024).toFixed(0)} KB）
            </p>
          )}

          {importResult && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-700">
                  {importResult.dryRun ? '预览结果' : '导入结果'}
                </span>
                <Badge tone="brand">{importResult.coursesTotal} 条课程</Badge>
                {!importResult.dryRun && <Badge tone="success">新增 {importResult.coursesImported}</Badge>}
                {!importResult.dryRun && importResult.coursesDuplicated ? (
                  <Badge tone="warning">跳过重复 {importResult.coursesDuplicated}</Badge>
                ) : null}
                {importResult.failedSheets?.length ? (
                  <Badge tone="danger">未解析 {importResult.failedSheets.length} 个 sheet</Badge>
                ) : (
                  <Badge tone="success">全部 sheet 解析成功</Badge>
                )}
              </div>

              <div className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1 pr-2 font-medium">sheet</th>
                      <th className="py-1 pr-2 font-medium">年级</th>
                      <th className="py-1 pr-2 font-medium">学科</th>
                      <th className="py-1 pr-2 font-medium">课程数</th>
                      <th className="py-1 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(importResult.sheets || []).map((s) => (
                      <tr key={s.sheet} className="border-t border-slate-100">
                        <td className="py-1 pr-2 text-slate-600">{s.sheet}</td>
                        <td className="py-1 pr-2 text-slate-500">{s.grade}</td>
                        <td className="py-1 pr-2 text-slate-500">{s.subject}</td>
                        <td className="py-1 pr-2 text-slate-500">{s.courses}</td>
                        <td className="py-1">
                          {s.error ? (
                            <span title={s.error} className="text-red-400">未解析</span>
                          ) : (
                            <span className="text-emerald-500">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除这次导入？"
        description={
          deleteTarget
            ? '将删除「' + deleteTarget.filename + '」导入的 ' + deleteTarget.courses_imported + ' 条课程，删除后不可恢复。'
            : ''
        }
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
