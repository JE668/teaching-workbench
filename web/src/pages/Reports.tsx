import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  Copy,
  FilePlus2,
  GraduationCap,
  ListTodo,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../api/client';
import { Student } from '../types';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Input, Select } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';
import { computeTrajectory, summarizeTrajectory, type MonthTrajectory } from '../lib/reportProgress';
import { MonthlyReport, ReportItem, TERM_OPTIONS, formatYearMonth } from '../types/reports';

const selectCls = 'w-full';

function StatTile({
  icon,
  label,
  value,
  tone = 'brand',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: 'brand' | 'info' | 'success';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    info: 'bg-sky-50 text-sky-600',
    success: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tones[tone])}>{icon}</div>
        <div>
          <div className="text-2xl font-semibold text-slate-800">{value}</div>
          <div className="text-xs text-slate-400">{label}</div>
        </div>
      </div>
    </Card>
  );
}

export default function Reports() {
  const toast = useToast();
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  const [studentId, setStudentId] = useState('');
  const [yearMonth, setYearMonth] = useState('');
  const [term, setTerm] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [showClone, setShowClone] = useState<MonthlyReport | null>(null);
  const [cloning, setCloning] = useState(false);
  const [toDelete, setToDelete] = useState<MonthlyReport | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 跨月进度弹窗当前看的学生 */
  const [progressStudent, setProgressStudent] = useState<{ id: number; name: string } | null>(null);

  const loadReports = useCallback(async (stu = '') => {
    const query = stu ? '?studentId=' + encodeURIComponent(stu) : '';
    // 接口返回的是 { reports: [...] } 包一层 —— 直接当数组用会让
    // reports.map 抛错，整页渲染崩成白屏
    const res = await api.request<{ reports: MonthlyReport[] }>('/reports' + query);
    setReports(res.reports);
  }, []);

  useEffect(() => {
    void loadReports()
      .catch((e) => toast.error(e.message || '加载报告失败'))
      .finally(() => setLoading(false));
    api.request<{ students: Student[] }>('/students')
      .then((r) => setStudents(r.students))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = reports;
    if (yearMonth) list = list.filter((r) => r.year_month === yearMonth);
    if (term) list = list.filter((r) => r.term === term);
    return list;
  }, [reports, yearMonth, term]);

  async function applyStudentFilter(id: string) {
    setStudentId(id);
    try {
      await loadReports(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '筛选失败');
    }
  }

  async function removeReport() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.request(`/reports/${toDelete.id}`, { method: 'DELETE' });
      toast.success('已删除');
      await loadReports(studentId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  /**
   * 克隆报告：复制基本信息和课程规划到新的月份。
   * 上月规划 → 本月规划，上月总结 → 本月总结（带出勤标记）
   */
  async function cloneReport(source: MonthlyReport) {
    if (!source.student_id) return;
    setCloning(true);
    try {
      // 计算下个月份
      const m = /^(\d{4})-(\d{1,2})$/.exec(source.year_month);
      if (!m) throw new Error('月份格式错误');
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const nextYM = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;

      // 创建新报告
      const newReport = await api.request<{ report: MonthlyReport; duplicated: boolean }>(
        `/reports`,
        {
          method: 'POST',
          body: JSON.stringify({
            studentId: source.student_id,
            yearMonth: nextYM,
            term: source.term,
            grade: source.grade,
            subject: source.subject,
          }),
        }
      );

      if (newReport.duplicated) {
        toast.info('该学生该月份已有报告');
        setShowClone(null);
        return;
      }

      // 获取源报告的明细
      const sourceData = await api.request<{ items: ReportItem[] }>(
        `/reports/${source.id}`
      );
      const planItems = sourceData.items.filter((i) => i.kind === 'plan');

      // 复制规划到新月
      let added = 0;
      for (const item of planItems) {
        await api.request(`/reports/${newReport.report.id}/items`, {
          method: 'POST',
          body: JSON.stringify({
            kind: 'plan',
            seq: item.seq,
            content: item.content,
            type: item.type,
            score: item.score,
            difficulty: item.difficulty,
            course_id: item.course_id,
          }),
        });
        added++;
      }

      toast.success(`已克隆到 ${nextYM}，复制了 ${added} 门课程规划`);
      setShowClone(null);
      await loadReports(studentId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '克隆失败');
    } finally {
      setCloning(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">月度总结与课程规划</h1>
          <p className="mt-1 text-sm text-slate-500">按学生按月出总结与规划，阶测安排可自动推算</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowNew(true)}>
          新建月份
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile icon={<CalendarRange className="h-4 w-4" />} label="月度报告" value={reports.length} />
        <StatTile
          icon={<Users className="h-4 w-4" />}
          label="覆盖学生"
          value={new Set(reports.map((r) => r.student_id)).size}
          tone="info"
        />
        <StatTile
          icon={<ListTodo className="h-4 w-4" />}
          label="课程条目"
          value={reports.reduce((s, r) => s + r.item_count, 0)}
          tone="success"
        />
      </div>

      <Card>
        <CardHeader
          title="报告列表"
          description="点击打开进入编辑"
          action={
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void loadReports(studentId).then(() => toast.success('已刷新'))}
            >
              刷新
            </Button>
          }
        />
        <CardBody className="p-0">
          <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 md:grid-cols-4">
            <Input
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              aria-label="月份"
            />
            <Select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="全部学期"
              options={TERM_OPTIONS.map((t) => ({ value: t, label: t }))}
              aria-label="学期"
            />
            <Select
              value={studentId}
              onChange={(e) => void applyStudentFilter(e.target.value)}
              placeholder="全部学生"
              options={students.map((s) => ({ value: String(s.id), label: s.name }))}
              aria-label="学生"
            />
            <Button
              variant="outline"
              size="md"
              className="h-10"
              onClick={() => {
                setYearMonth('');
                setTerm('');
                void applyStudentFilter('');
              }}
            >
              重置筛选
            </Button>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">加载中…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<BookOpenCheck className="h-8 w-8" />}
              title="还没有月度报告"
              description="先选一个学生和月份，把本月课程排起来"
              className="py-16"
              action={
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowNew(true)}>
                  新建月份
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">学生</th>
                    <th className="px-4 py-3 font-medium">月份</th>
                    <th className="px-4 py-3 font-medium">学期</th>
                    <th className="px-4 py-3 font-medium">总结 / 规划</th>
                    <th className="px-4 py-3 font-medium">条目</th>
                    <th className="px-4 py-3 font-medium">更新时间</th>
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 transition hover:bg-brand-50/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <GraduationCap className="h-4 w-4 text-brand-500" />
                          <span className="font-medium text-slate-800">{r.student_name}</span>
                          {(r.grade || r.subject) && (
                            <span className="text-xs text-slate-400">
                              {[r.grade, r.subject].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatYearMonth(r.year_month)}</td>
                      <td className="px-4 py-3">
                        <Badge tone="brand">{r.term || '未定'}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className={cn('h-4 w-4', r.summary_enabled ? 'text-emerald-500' : 'text-slate-300')} />
                          <CheckCircle2 className={cn('h-4 w-4', r.plan_enabled ? 'text-emerald-500' : 'text-slate-300')} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.item_count}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{(r.updated_at || '').slice(0, 16)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link to={`/reports/${r.id}`}>
                            <Button variant="outline" size="sm">
                              打开
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="跨月进度：上月规划 vs 本月总结的达成轨迹"
                            aria-label="跨月进度"
                            onClick={() => setProgressStudent({ id: r.student_id, name: r.student_name })}
                          >
                            <TrendingUp className="h-4 w-4 text-brand-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="克隆到下月"
                            aria-label="克隆"
                            onClick={() => setShowClone(r)}
                          >
                            <Copy className="h-4 w-4 text-slate-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="删除"
                            aria-label="删除"
                            onClick={() => setToDelete(r)}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <NewReportModal
        open={showNew}
        onClose={() => setShowNew(false)}
        students={students}
        onCreate={async (payload) => {
          const res = await api.request<{ report: MonthlyReport; duplicated: boolean }>('/reports', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          toast.success(res.duplicated ? '该学生该月份已有报告' : '已新建');
          setShowNew(false);
          await loadReports();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void removeReport()}
        loading={deleting}
        title="删除这块报告？"
        description={
          toDelete
            ? `${toDelete.student_name} · ${formatYearMonth(toDelete.year_month)} 及其 ${toDelete.item_count} 条明细会一起删掉，不可恢复。`
            : ''
        }
        confirmText="删除"
        danger
      />

      <ConfirmDialog
        open={!!showClone}
        onCancel={() => setShowClone(null)}
        onConfirm={() => void cloneReport(showClone!)}
        loading={cloning}
        title="克隆到下月？"
        description={
          showClone
            ? `将复制 ${showClone.student_name} · ${formatYearMonth(showClone.year_month)} 的课程规划到下一月份。基本信息（学生、学期、年级、学科）会一并复制。`
            : ''
        }
        confirmText="克隆"
      />

      <StudentProgressModal student={progressStudent} onClose={() => setProgressStudent(null)} />
    </div>
  );
}

function NewReportModal({
  open,
  onClose,
  students,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  students: Student[];
  onCreate: (payload: { studentId: number; yearMonth: string; term: string }) => Promise<void>;
}) {
  const toast = useToast();
  const [studentId, setStudentId] = useState('');
  const [yearMonth, setYearMonth] = useState('');
  const [term, setTerm] = useState(TERM_OPTIONS[1]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const now = new Date();
      setYearMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
  }, [open]);

  const canSubmit = !!studentId && /^\d{4}-\d{2}$/.test(yearMonth);

  return (
    <Modal open={open} onClose={onClose} title="新建月份报告" size="sm">
      <div className="space-y-4">
        <Select
          label="学生"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          placeholder="请选择学生"
          options={students.map((s) => ({ value: String(s.id), label: s.name }))}
        />
        <Input
          label="月份"
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
        />
        <Select
          label="学期"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          options={TERM_OPTIONS.map((t) => ({ value: t, label: t }))}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            icon={<FilePlus2 className="h-4 w-4" />}
            disabled={!canSubmit}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreate({ studentId: Number(studentId), yearMonth, term });
                setStudentId('');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : '创建失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            创建
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 跨月进度弹窗：把一个学生所有月份的报告，按「上一份报告的规划 → 这份报告的总结」
 * 换算成达成轨迹——完成率、漏上的课、额外补上的课，一眼看出规划跟没跟住。
 */
function StudentProgressModal({
  student,
  onClose,
}: {
  student: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<MonthTrajectory[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!student) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRows(null);
    void (async () => {
      try {
        const res = await api.request<{ reports: MonthlyReport[] }>('/reports?studentId=' + student.id);
        const reports = [...(res.reports || [])].sort((a, b) => a.year_month.localeCompare(b.year_month));
        const months = await Promise.all(
          reports.map(async (r) => {
            const d = await api.request<{ items: ReportItem[] }>(`/reports/${r.id}`);
            return { yearMonth: r.year_month, term: r.term, items: d.items || [] };
          })
        );
        if (!cancelled) setRows(computeTrajectory(months));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : '加载跨月进度失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  const summary = rows ? summarizeTrajectory(rows) : null;

  const rateTone = (rate: number | null) =>
    rate == null ? 'text-slate-300' : rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-500';

  return (
    <Modal open={!!student} onClose={onClose} title={'跨月进度 · ' + (student?.name || '')} size="lg">
      {loading ? (
        <div className="p-10 text-center text-sm text-slate-400">加载中…</div>
      ) : !rows || rows.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm text-slate-400">这个学生还没有月度报告，先新建一份再来看进度。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 汇总 */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-500">
              报告 <b className="text-slate-800">{summary!.months}</b> 份
            </span>
            <span className="text-slate-500">
              规划合计 <b className="text-slate-800">{summary!.planned}</b> 门
            </span>
            <span className="text-slate-500">
              已完成 <b className="text-slate-800">{summary!.completed}</b> 门
            </span>
            <span className="text-slate-500">
              完成率 <b className={rateTone(summary!.rate)}>{summary!.rate == null ? '—' : summary!.rate + '%'}</b>
            </span>
            <span className="text-slate-500">
              累计漏上 <b className="text-red-500">{summary!.missed}</b> 门
            </span>
            <span className="text-slate-500">
              累计补上 <b className="text-slate-800">{summary!.extraTaught}</b> 门
            </span>
          </div>

          {/* 月度轨迹表 */}
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">月份</th>
                  <th className="px-3 py-2 text-left font-medium">规划 → 完成</th>
                  <th className="px-3 py-2 text-left font-medium">完成率</th>
                  <th className="px-3 py-2 text-left font-medium">漏上的课</th>
                  <th className="px-3 py-2 text-left font-medium">额外补上</th>
                  <th className="px-3 py-2 text-left font-medium">阶测</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.yearMonth} className="border-b border-slate-50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <div className="font-medium text-slate-800">{formatYearMonth(r.yearMonth)}</div>
                      {r.term && <div className="text-xs text-slate-400">{r.term}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                      {r.planned > 0 ? (
                        <span>
                          {r.completed}/{r.planned}
                          {r.baseMonth && (
                            <span className="ml-1 text-xs text-slate-400">（基准 {formatYearMonth(r.baseMonth)}）</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300" title="上一份报告里没有规划课程">
                          无规划基准
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className={'font-semibold ' + rateTone(r.rate)}>{r.rate == null ? '—' : r.rate + '%'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.missed.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className="text-red-500">{r.missed.join('、')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.extraTaught.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className="text-slate-500">{r.extraTaught.join('、')}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                      {r.examCount > 0 ? r.examCount : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            对比基准是上一份报告的课程规划：先按来源课程匹配，手输的课按内容文本匹配。跳月时以实际存在的上一份报告为准。
          </p>
        </div>
      )}
    </Modal>
  );
}
