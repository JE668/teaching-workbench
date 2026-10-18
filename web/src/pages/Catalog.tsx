import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Upload,
  FileSpreadsheet,
  Trash2,
  RotateCcw,
  Star,
  Search,
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

export default function Catalog() {
  const toast = useToast();
  const [courses, setCourses] = useState<CatalogCourse[]>([]);
  const [facets, setFacets] = useState<Facets>({ grades: [], subjects: [], terms: [], types: [], tracks: [], textbooks: [] });
  const [imports, setImports] = useState<CatalogImport[]>([]);
  const [loading, setLoading] = useState(true);

  // 筛选
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [term, setTerm] = useState('');
  const [type, setType] = useState('');
  const [track, setTrack] = useState('');
  const [q, setQ] = useState('');

  // 导入
  const [importOpen, setImportOpen] = useState(false);
  const [band, setBand] = useState('高中');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<CatalogImport | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    } catch (e: any) {
      toast.error(e.message || '加载课程目录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const filtered = courses.filter(
    (c) =>
      (!grade || c.grade === grade) &&
      (!subject || c.subject === subject) &&
      (!term || c.term === term) &&
      (!type || c.type === type) &&
      (!track || c.track === track) &&
      (!q || c.content.includes(q) || c.section.includes(q))
  );

  const byGroup = new Map<string, CatalogCourse[]>();
  for (const c of filtered) {
    const key = c.grade + c.subject + ' · ' + c.term + (c.track ? ' · ' + c.track : '');
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(c);
  }

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
          <CardHeader title="筛选" description="全部本地过滤，不用来回请求" />
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 md:grid-cols-3 lg:grid-cols-6">
            <Select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              options={facets.grades.map((v) => ({ value: v, label: v }))}
              placeholder="全部年级"
            />
            <Select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              options={facets.subjects.map((v) => ({ value: v, label: v }))}
              placeholder="全部学科"
            />
            <Select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              options={facets.terms.map((v) => ({ value: v, label: v }))}
              placeholder="全部学期"
            />
            <Select
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={facets.types.map((v) => ({ value: v, label: v }))}
              placeholder="全部类型"
            />
            <Select
              value={track}
              onChange={(e) => setTrack(e.target.value)}
              options={facets.tracks.map((v) => ({ value: v, label: v }))}
              placeholder="全部轨"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索辅导内容"
              icon={<Search size={14} />}
            />
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
              <Button
                variant="outline"
                onClick={() => { setGrade(''); setSubject(''); setTerm(''); setType(''); setTrack(''); setQ(''); }}
              >
                <RotateCcw size={16} />
                清空筛选
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="px-1 text-xs text-slate-400">
            共 {filtered.length} 条 · 点击星星可直接设掌握星级
          </p>
          {[...byGroup.entries()].map(([key, list]) => (
            <Card key={key} className="overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm font-medium text-slate-600">
                {key}
                <span className="ml-2 text-xs font-normal text-slate-400">{list.length} 条</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                      <th className="px-3 py-2 font-medium">序号</th>
                      <th className="px-3 py-2 font-medium">辅导内容</th>
                      <th className="px-3 py-2 font-medium">课程类型</th>
                      <th className="px-3 py-2 font-medium">分值占比</th>
                      <th className="px-3 py-2 font-medium">难度</th>
                      <th className="px-3 py-2 font-medium">教材</th>
                      <th className="px-3 py-2 font-medium">掌握</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-slate-400">{c.seq}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-slate-700">{c.content}</span>
                          {c.section && (
                            <span className="ml-1.5 inline-block align-middle text-[11px] text-amber-600">
                              「{c.section}」
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={c.type === '专题' ? 'brand' : c.type === '预习' ? 'info' : 'neutral'}>{c.type || '—'}</Badge>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{c.score || '—'}</td>
                        <td className="px-3 py-2 text-amber-500">{c.difficulty || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{c.textbook || '—'}</td>
                        <td className="px-3 py-1.5">
                          <StarEditor value={c.mastery_star} onPick={(v) => void pickStar(c, v)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

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
