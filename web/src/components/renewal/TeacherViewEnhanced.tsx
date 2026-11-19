import React, { useState, useMemo } from 'react';
import { ChevronDown, Users, TrendingUp, Target, AlertCircle, CheckCircle, X } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { TAB_LABELS, TAB_ORDER, count, NOT_AVAILABLE_YET, pct, rankStyle, GRID_STATUS_META, type TeacherStatRow, type MentorMatrix, type TeacherGradeMatrix, type GroupGradeMatrix, type RateOverview, type MentorMatrixCell, type TeacherGradeMatrixCell, type GroupGradeMatrixCell, type GridStatus } from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';
import Sparkline from './Sparkline';
import StudentGrid from './StudentGrid';
import Modal from '../../components/ui/Modal';

interface Props {
  rows: TeacherStatRow[];
  tab: string;
  setTab: (t: string) => void;
  expanded: Set<string>;
  toggleTeacher: (name: string) => void;
  mentorMatrix?: MentorMatrix;
  teacherGradeMatrix?: TeacherGradeMatrix;
  groupGradeMatrix?: GroupGradeMatrix;
  rateOverview?: RateOverview;
  reportId?: number;
  fetchMentorMatrix?: (reportId: number) => Promise<MentorMatrix>;
  fetchTeacherGradeMatrix?: (reportId: number) => Promise<TeacherGradeMatrix>;
  fetchGroupGradeMatrix?: (reportId: number) => Promise<GroupGradeMatrix>;
  fetchRateOverview?: (reportId: number) => Promise<RateOverview>;
  matrixLoading?: boolean;
}

interface MatrixCellDetailState {
  open: boolean;
  cell: MentorMatrixCell | TeacherGradeMatrixCell | GroupGradeMatrixCell | null;
  type: 'mentor' | 'grade' | 'group';
}

interface Col {
  key: string;
  label: string;
  isRate: boolean;
  get: (r: TeacherStatRow) => number | null;
  sparkline?: boolean;
}

function tabColumns(tab: string): Col[] {
  if (tab === 'stage') {
    return [
      { key: 'juniorBase', label: '在读-非毕业班', isRate: false, get: r => r.extra['juniorBase'] ?? r.baseCount },
      { key: 'junior3Base', label: '在读-初三', isRate: false, get: r => r.extra['junior3Base'] ?? null },
      { key: 'junior3Prepaid', label: '预存-初三', isRate: false, get: r => r.extra['junior3Prepaid'] ?? null },
      { key: 'junior3PrepaidRate', label: '预存率-初三', isRate: true, get: r => r.extra['junior3PrepaidRate'] ?? null },
      { key: 'senior1Base', label: '在读-高一', isRate: false, get: r => r.extra['senior1Base'] ?? null },
      { key: 'senior1Prepaid', label: '预存-高一', isRate: false, get: r => r.extra['senior1Prepaid'] ?? null },
      { key: 'senior1PrepaidRate', label: '预存率-高一', isRate: true, get: r => r.extra['senior1PrepaidRate'] ?? null },
      { key: 'senior2Base', label: '在读-高二', isRate: false, get: r => r.extra['senior2Base'] ?? null },
      { key: 'senior2Prepaid', label: '预存-高二', isRate: false, get: r => r.extra['senior2Prepaid'] ?? null },
      { key: 'senior2PrepaidRate', label: '预存率-高二', isRate: true, get: r => r.extra['senior2PrepaidRate'] ?? null },
      { key: 'senior3Base', label: '在读-高三', isRate: false, get: r => r.extra['senior3Base'] ?? null },
      { key: 'senior3Prepaid', label: '预存-高三', isRate: false, get: r => r.extra['senior3Prepaid'] ?? null },
      { key: 'senior3PrepaidRate', label: '预存率-高三', isRate: true, get: r => r.extra['senior3PrepaidRate'] ?? null },
    ];
  }
  if (tab === 'mentor') {
    return [
      { key: 'baseCount', label: '基数', isRate: false, get: r => r.baseCount },
      { key: 'prepaidCount', label: '预存', isRate: false, get: r => r.prepaidCount },
      { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
    ];
  }
  if (tab === 'incentive') {
    return [
      { key: 'baseCount', label: '基数', isRate: false, get: r => r.baseCount },
      { key: 'prepaidCount', label: '预存', isRate: false, get: r => r.prepaidCount },
      { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
      { key: 'renewedCount', label: '续科', isRate: false, get: r => r.renewedCount },
      { key: 'renewRate', label: '续科率', isRate: true, get: r => r.renewRate },
    ];
  }
  return [
    { key: 'baseCount', label: '基数', isRate: false, get: r => r.baseCount },
    { key: 'prepaidCount', label: '预存', isRate: false, get: r => r.prepaidCount },
    { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
  ];
}

function textColorForHex(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#1e293b' : '#f8fafc';
}

function renderLegendDot(status: GridStatus): React.ReactNode {
  const meta = GRID_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ color: textColorForHex(meta.hex) }}
    >
      <span
        className="w-2.5 h-2.5 rounded-full ring-1 ring-slate-300"
        style={{ backgroundColor: meta.hex }}
        aria-hidden="true"
      />
      <span className="text-xs font-medium">{meta.label}</span>
    </span>
  );
}

function TeacherRow({
  r,
  name,
  open,
  cols,
  colSpan,
  onToggle,
}: {
  r: TeacherStatRow;
  name: string;
  open: boolean;
  cols: Col[];
  colSpan: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 font-medium text-slate-700">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')}
              aria-hidden="true"
            />
            {name}
          </div>
        </td>
        <td className="px-4 py-3 text-slate-600">{r.subjectGroup || '—'}</td>
        <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.baseCount)}</td>
        {cols.map(col => (
          <td key={col.key} className="px-4 py-3 tabular-nums text-slate-600">
            {col.isRate ? pct(col.get(r)) : count(col.get(r))}
          </td>
        ))}
        <td className="px-4 py-3 tabular-nums text-slate-700 font-medium">{count(r.renewedCount)}</td>
        <td className="px-4 py-3 tabular-nums font-semibold text-slate-700">{pct(r.renewRate)}</td>
        <td className="px-4 py-3 tabular-nums">
          {r.incentiveGap !== null && r.incentiveGap !== undefined ? (
            <span className={cn('font-medium', r.incentiveGap > 0 ? 'text-amber-600' : 'text-emerald-600')}>
              {count(r.incentiveGap)}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-3" aria-label="学生状态">
          <StudentGrid students={r.students} />
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/30">
          <td colSpan={colSpan} className="px-4 pb-4">
            <div className="ml-10 border-l-2 border-slate-200 pl-4">
              <StudentGrid students={r.students} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MatrixLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" aria-label="学生状态图例">
      {(['renewed', 'prepaid', 'stopped', 'closed', 'grade3', 'normal'] as GridStatus[]).map(s => (
        <span key={s} className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full ring-1 ring-slate-300"
            style={{ backgroundColor: GRID_STATUS_META[s].hex }}
            aria-hidden="true"
          />
          <span className="text-xs text-slate-500">{GRID_STATUS_META[s].label}</span>
        </span>
      ))}
    </div>
  );
}

function MatrixCellDetail({ cell, type, onClose }: { cell: MentorMatrixCell | TeacherGradeMatrixCell | GroupGradeMatrixCell | null; type: 'mentor' | 'grade' | 'group'; onClose: () => void }) {
  if (!cell) return null;

  const prepaidRate = cell.prepaidRate ?? 0;
  const renewRate = cell.renewRate ?? 0;

  const title = type === 'mentor'
    ? (cell as MentorMatrixCell).teacherName + ' × ' + (cell as MentorMatrixCell).managerName
    : type === 'grade'
    ? (cell as TeacherGradeMatrixCell).teacherName + ' × ' + (cell as TeacherGradeMatrixCell).grade
    : (cell as GroupGradeMatrixCell).subjectGroup + ' × ' + (cell as GroupGradeMatrixCell).grade;

  return (
    <Modal open onClose={onClose} title={title} description={cell.studentCount + ' 名学生 · 预存 ' + cell.prepaidCount + ' · 续费 ' + cell.renewedCount} size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-purple-200" aria-hidden="true"></span>
            <span>预存 {cell.prepaidCount} 人 ({prepaidRate.toFixed(1)}%)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-200" aria-hidden="true"></span>
            <span>续费 {cell.renewedCount} 人 ({renewRate.toFixed(1)}%)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-200" aria-hidden="true"></span>
            <span>学生总数 {cell.studentCount} 人</span>
          </span>
        </div>

        <div className="rounded-lg border border-slate-200 overflow-hidden max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-left font-medium">学生</th>
                <th className="px-3 py-2 text-left font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cell.students.map((s, idx) => {
                const meta = GRID_STATUS_META[s.status as GridStatus] ?? GRID_STATUS_META.normal;
                const textColor = textColorForHex(meta.hex);
                return (
                  <tr key={idx} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-700">{s.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: meta.hex, color: textColor }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.hex }} aria-hidden="true" />
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export default function TeacherViewEnhanced({
  rows,
  tab,
  setTab,
  expanded,
  toggleTeacher,
  mentorMatrix,
  teacherGradeMatrix,
  groupGradeMatrix,
  rateOverview,
  reportId,
  fetchMentorMatrix,
  fetchTeacherGradeMatrix,
  fetchGroupGradeMatrix,
  fetchRateOverview,
  matrixLoading,
}: Props) {
  const [matrixView, setMatrixView] = useState<'mentor' | 'grade' | 'group'>('mentor');
  const [rateMode, setRateMode] = useState<'pre' | 'renew'>('renew');
  const [cellDetail, setCellDetail] = useState<MatrixCellDetailState>({ open: false, cell: null, type: 'mentor' });

  const openCellDetail = (cell: MentorMatrixCell | TeacherGradeMatrixCell | GroupGradeMatrixCell, type: 'mentor' | 'grade' | 'group') => setCellDetail({ open: true, cell, type });
  const closeCellDetail = () => setCellDetail({ open: false, cell: null, type: 'mentor' });

  const cols = useMemo(() => tabColumns(tab), [tab]);
  const maxRenewed = rows.reduce((m, r) => Math.max(m, r.renewedCount || 0), 0);
  const maxBase = rows.reduce((m, r) => Math.max(m, r.baseCount || 0), 0);
  const gapPositive = rows.filter(r => (r.incentiveGap || 0) > 0).sort((a, b) => (b.incentiveGap || 0) - (a.incentiveGap || 0));
  const maxGap = gapPositive.reduce((m, r) => Math.max(m, r.incentiveGap || 0), 0);

  const renewalRanking: BarListRow[] = rows
    .sort((a, b) => (b.renewedCount || 0) - (a.renewedCount || 0))
    .slice(0, 10)
    .map((r, i) => ({
      label: r.teacherName || '未知教师',
      value: count(r.renewedCount),
      rawValue: r.renewedCount || 0,
      ratio: maxRenewed > 0 ? ((r.renewedCount || 0) / maxRenewed) * 100 : 0,
      hint: '基数 ' + count(r.baseCount) + ' · 预存 ' + count(r.prepaidCount) + ' · 续科率 ' + pct(r.renewRate),
      className: rankStyle(i),
    }));

  const gapRanking: BarListRow[] = gapPositive
    .slice(0, 10)
    .map((r, i) => ({
      label: r.teacherName || '未知教师',
      value: count(r.incentiveGap || 0),
      rawValue: r.incentiveGap || 0,
      ratio: maxGap > 0 ? ((r.incentiveGap || 0) / maxGap) * 100 : 0,
      hint: '基数 ' + count(r.baseCount) + ' · 续科 ' + count(r.renewedCount) + ' · 续科率 ' + pct(r.renewRate),
      className: rankStyle(i),
      color: 'bg-amber-500',
    }));

  const totals = useMemo(() => {
    if (rows.length === 0) return { base: 0, renewed: 0, prepaid: 0, gap: 0, rate: 0, hasData: false };
    let base = 0, renewed = 0, gap = 0, prepaid = 0;
    for (const r of rows) {
      base += r.baseCount || 0;
      renewed += r.renewedCount || 0;
      prepaid += r.prepaidCount || 0;
      gap += r.incentiveGap || 0;
    }
    return { base, renewed, prepaid, gap, rate: base > 0 ? (renewed / base) * 100 : 0, hasData: true };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title="教师明细" icon={<Users className="h-5 w-5" />} action={<MatrixLegend />} />
        <CardBody className="py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <Users className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">{NOT_AVAILABLE_YET}</h3>
            <p className="text-sm text-slate-400">该统计表的数据将在下个月录入完成后显示</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <Card className="h-full">
        <CardHeader
          title="教师明细"
          icon={<Users className="h-5 w-5" />}
          action={
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">矩阵视图：</span>
                <div className="flex rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="矩阵维度切换">
                  {(['mentor', 'grade', 'group'] as const).map(view => (
                    <button
                      key={view}
                      type="button"
                      role="radio"
                      aria-checked={matrixView === view}
                      onClick={() => setMatrixView(view)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        matrixView === view
                          ? 'bg-white text-brand-600 shadow-sm'
                          : 'text-slate-600 hover:text-slate-800',
                      )}
                    >
                      {view === 'mentor' ? '教师×学管' : view === 'grade' ? '教师×年级' : '科组×年级'}
                    </button>
                  ))}
                </div>
              </div>
              <MatrixLegend />
            </>
          }
        />
        <CardBody className="space-y-6 p-4">
          {/* 汇总卡 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide">学生基数</p>
              <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{count(totals.base)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide">已预存</p>
              <p className="mt-1 text-2xl font-bold text-violet-600 tabular-nums">{count(totals.prepaid)}</p>
              <p className="mt-1 text-xs text-slate-400">预存率 {pct(totals.prepaid / totals.base * 100)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide">已续科</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600 tabular-nums">{count(totals.renewed)}</p>
              <p className="mt-1 text-xs text-slate-400">续科率 {pct(totals.rate)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide">激励差额</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-{totals.gap > 0 ? 'amber-600' : 'emerald-600'}">
                {count(totals.gap)}
              </p>
              <p className="mt-1 text-xs text-slate-400">{totals.gap > 0 ? '尚差' : '全员达标'}</p>
            </div>
          </div>

          {/* Rate Panel */}
          {rateOverview && (
            <div className="rounded-xl bg-white border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                <Target className="h-4 w-4 text-brand-600" />
                续存概览
              </h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">学管维度</h4>
                  <div className="space-y-2">
                    {rateOverview.byManager.map(m => (
                      <div key={m.managerName} className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{m.managerName}</span>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-purple-500" aria-hidden="true" />
                              预存 {pct(m.prepaidRate)}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                              续费 {pct(m.renewRate)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-emerald-500 rounded-full"
                            style={{ width: rateMode === 'pre' ? m.prepaidRate + '%' : m.renewRate + '%' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">科组维度</h4>
                  <div className="space-y-2">
                    {rateOverview.byGroup.map(g => (
                      <div key={g.subjectGroup} className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{g.subjectGroup}</span>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-purple-500" aria-hidden="true" />
                              预存 {pct(g.prepaidRate)}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                              续费 {pct(g.renewRate)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-emerald-500 rounded-full"
                            style={{ width: rateMode === 'pre' ? g.prepaidRate + '%' : g.renewRate + '%' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs text-slate-500">显示：</span>
                <div className="flex rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="预存/续费切换">
                  {(['pre', 'renew'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={rateMode === mode}
                      onClick={() => setRateMode(mode)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        rateMode === mode
                          ? 'bg-white text-brand-600 shadow-sm'
                          : 'text-slate-600 hover:text-slate-800',
                      )}
                    >
                      {mode === 'pre' ? '预存率' : '续费率'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Matrix View */}
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            {matrixLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-brand-500 border-t-transparent" />
                <span className="ml-2 text-sm text-slate-500">加载矩阵中…</span>
              </div>
            ) : (
              <>
                {matrixView === 'mentor' && mentorMatrix && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm min-w-max">
                      <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0 z-10">
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-2 font-medium sticky left-0 z-20 bg-slate-50 border-r border-slate-200">教师</th>
                          {mentorMatrix.managers.map(m => (
                            <th key={m} className="px-3 py-2 font-medium text-center min-w-[120px]">{m}</th>
                          ))}
                          <th className="px-3 py-2 font-medium text-center min-w-[120px]">合计</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {mentorMatrix.teachers.map(teacher => {
                          const rowCells = mentorMatrix.managers.map(manager => {
                            const cell = mentorMatrix.cells.find(c => c.teacherName === teacher && c.managerName === manager);
                            return cell ? (
                              <td
                                key={manager}
                                className="px-3 py-2 text-center relative cursor-pointer hover:bg-brand-50/50 transition-colors"
                                onClick={() => openCellDetail(cell, 'mentor')}
                                title={cell.studentCount + ' 人 · 预存 ' + cell.prepaidCount + ' · 续费 ' + cell.renewedCount}
                              >
                                <div className="font-medium text-slate-800">{cell.studentCount}</div>
                                <div className="flex justify-center gap-1 text-xs">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {cell.prepaidCount}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {cell.renewedCount}</span>
                                </div>
                                {cell.prepaidRate !== null && cell.renewRate !== null && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    预存率 {cell.prepaidRate.toFixed(1)}% · 续费率 {cell.renewRate.toFixed(1)}%
                                  </div>
                                )}
                              </td>
                            ) : (
                              <td key={manager} className="px-3 py-2 text-center text-slate-300">—</td>
                            );
                          });

                          const teacherTotal = mentorMatrix.cells.filter(c => c.teacherName === teacher);
                          const totalStudents = teacherTotal.reduce((s, c) => s + c.studentCount, 0);
                          const totalPrepaid = teacherTotal.reduce((s, c) => s + c.prepaidCount, 0);
                          const totalRenewed = teacherTotal.reduce((s, c) => s + c.renewedCount, 0);

                          return (
                            <tr key={teacher} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 z-10 bg-white border-r border-slate-200">
                                {teacher}
                              </td>
                              {rowCells}
                              <td className="px-3 py-2 text-center font-medium text-slate-700 bg-slate-50/50 border-l border-slate-200">
                                <div>{totalStudents}</div>
                                <div className="flex justify-center gap-1 text-xs mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {totalPrepaid}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {totalRenewed}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-slate-100 font-semibold">
                          <td className="px-3 py-2 sticky left-0 z-10 bg-slate-100 border-r border-slate-200">合计</td>
                          {mentorMatrix.managers.map(manager => {
                            const colCells = mentorMatrix.cells.filter(c => c.managerName === manager);
                            const totalStudents = colCells.reduce((s, c) => s + c.studentCount, 0);
                            const totalPrepaid = colCells.reduce((s, c) => s + c.prepaidCount, 0);
                            const totalRenewed = colCells.reduce((s, c) => s + c.renewedCount, 0);
                            return (
                              <td key={manager} className="px-3 py-2 text-center border-t border-slate-200">
                                <div>{totalStudents}</div>
                                <div className="flex justify-center gap-1 text-xs mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {totalPrepaid}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {totalRenewed}</span>
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center border-t border-slate-200 border-l border-slate-200 bg-slate-200">
                            <div>{mentorMatrix.totalStudents}</div>
                            <div className="flex justify-center gap-1 text-xs mt-0.5">
                              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {mentorMatrix.totalPrepaid}</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {mentorMatrix.totalRenewed}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {matrixView === 'grade' && teacherGradeMatrix && !matrixLoading && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm min-w-max">
                      <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0 z-10">
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-2 font-medium sticky left-0 z-20 bg-slate-50 border-r border-slate-200">教师</th>
                          {teacherGradeMatrix.grades.map(g => (
                            <th key={g} className="px-3 py-2 font-medium text-center min-w-[120px]">{g}</th>
                          ))}
                          <th className="px-3 py-2 font-medium text-center min-w-[120px]">合计</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {teacherGradeMatrix.teachers.map(teacher => {
                          const rowCells = teacherGradeMatrix.grades.map(grade => {
                            const cell = teacherGradeMatrix.cells.find(c => c.teacherName === teacher && c.grade === grade);
                            return cell ? (
                              <td
                                key={grade}
                                className="px-3 py-2 text-center relative cursor-pointer hover:bg-brand-50/50 transition-colors"
                                onClick={() => openCellDetail(cell, 'grade')}
                                title={cell.studentCount + ' 人 · 预存 ' + cell.prepaidCount + ' · 续费 ' + cell.renewedCount}
                              >
                                <div className="font-medium text-slate-800">{cell.studentCount}</div>
                                <div className="flex justify-center gap-1 text-xs">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {cell.prepaidCount}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {cell.renewedCount}</span>
                                </div>
                                {cell.prepaidRate !== null && cell.renewRate !== null && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    预存率 {cell.prepaidRate.toFixed(1)}% · 续费率 {cell.renewRate.toFixed(1)}%
                                  </div>
                                )}
                              </td>
                            ) : (
                              <td key={grade} className="px-3 py-2 text-center text-slate-300">—</td>
                            );
                          });
                          const teacherTotal = teacherGradeMatrix.cells.filter(c => c.teacherName === teacher);
                          const totalStudents = teacherTotal.reduce((s, c) => s + c.studentCount, 0);
                          const totalPrepaid = teacherTotal.reduce((s, c) => s + c.prepaidCount, 0);
                          const totalRenewed = teacherTotal.reduce((s, c) => s + c.renewedCount, 0);
                          return (
                            <tr key={teacher} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 z-10 bg-white border-r border-slate-200">
                                {teacher}
                              </td>
                              {rowCells}
                              <td className="px-3 py-2 text-center font-medium text-slate-700 bg-slate-50/50 border-l border-slate-200">
                                <div>{totalStudents}</div>
                                <div className="flex justify-center gap-1 text-xs mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {totalPrepaid}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {totalRenewed}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-slate-100 font-semibold">
                          <td className="px-3 py-2 sticky left-0 z-10 bg-slate-100 border-r border-slate-200">合计</td>
                          {teacherGradeMatrix.grades.map(grade => {
                            const colCells = teacherGradeMatrix.cells.filter(c => c.grade === grade);
                            const totalStudents = colCells.reduce((s, c) => s + c.studentCount, 0);
                            const totalPrepaid = colCells.reduce((s, c) => s + c.prepaidCount, 0);
                            const totalRenewed = colCells.reduce((s, c) => s + c.renewedCount, 0);
                            return (
                              <td key={grade} className="px-3 py-2 text-center border-t border-slate-200">
                                <div>{totalStudents}</div>
                                <div className="flex justify-center gap-1 text-xs mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {totalPrepaid}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {totalRenewed}</span>
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center border-t border-slate-200 border-l border-slate-200 bg-slate-200">
                            <div>{teacherGradeMatrix.totalStudents}</div>
                            <div className="flex justify-center gap-1 text-xs mt-0.5">
                              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {teacherGradeMatrix.totalPrepaid}</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {teacherGradeMatrix.totalRenewed}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {matrixView === 'group' && groupGradeMatrix && !matrixLoading && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm min-w-max">
                      <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0 z-10">
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-2 font-medium sticky left-0 z-20 bg-slate-50 border-r border-slate-200">科组</th>
                          {groupGradeMatrix.grades.map(g => (
                            <th key={g} className="px-3 py-2 font-medium text-center min-w-[120px]">{g}</th>
                          ))}
                          <th className="px-3 py-2 font-medium text-center min-w-[120px]">合计</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {groupGradeMatrix.subjectGroups.map(group => {
                          const rowCells = groupGradeMatrix.grades.map(grade => {
                            const cell = groupGradeMatrix.cells.find(c => c.subjectGroup === group && c.grade === grade);
                            return cell ? (
                              <td
                                key={grade}
                                className="px-3 py-2 text-center relative cursor-pointer hover:bg-brand-50/50 transition-colors"
                                onClick={() => openCellDetail(cell, 'group')}
                                title={cell.studentCount + ' 人 · 预存 ' + cell.prepaidCount + ' · 续费 ' + cell.renewedCount}
                              >
                                <div className="font-medium text-slate-800">{cell.studentCount}</div>
                                <div className="flex justify-center gap-1 text-xs">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {cell.prepaidCount}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {cell.renewedCount}</span>
                                </div>
                                {cell.prepaidRate !== null && cell.renewRate !== null && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    预存率 {cell.prepaidRate.toFixed(1)}% · 续费率 {cell.renewRate.toFixed(1)}%
                                  </div>
                                )}
                              </td>
                            ) : (
                              <td key={grade} className="px-3 py-2 text-center text-slate-300">—</td>
                            );
                          });
                          const groupTotal = groupGradeMatrix.cells.filter(c => c.subjectGroup === group);
                          const totalStudents = groupTotal.reduce((s, c) => s + c.studentCount, 0);
                          const totalPrepaid = groupTotal.reduce((s, c) => s + c.prepaidCount, 0);
                          const totalRenewed = groupTotal.reduce((s, c) => s + c.renewedCount, 0);
                          return (
                            <tr key={group} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 z-10 bg-white border-r border-slate-200">
                                {group}
                              </td>
                              {rowCells}
                              <td className="px-3 py-2 text-center font-medium text-slate-700 bg-slate-50/50 border-l border-slate-200">
                                <div>{totalStudents}</div>
                                <div className="flex justify-center gap-1 text-xs mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {totalPrepaid}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {totalRenewed}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-slate-100 font-semibold">
                          <td className="px-3 py-2 sticky left-0 z-10 bg-slate-100 border-r border-slate-200">合计</td>
                          {groupGradeMatrix.grades.map(grade => {
                            const colCells = groupGradeMatrix.cells.filter(c => c.grade === grade);
                            const totalStudents = colCells.reduce((s, c) => s + c.studentCount, 0);
                            const totalPrepaid = colCells.reduce((s, c) => s + c.prepaidCount, 0);
                            const totalRenewed = colCells.reduce((s, c) => s + c.renewedCount, 0);
                            return (
                              <td key={grade} className="px-3 py-2 text-center border-t border-slate-200">
                                <div>{totalStudents}</div>
                                <div className="flex justify-center gap-1 text-xs mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {totalPrepaid}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {totalRenewed}</span>
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-center border-t border-slate-200 border-l border-slate-200 bg-slate-200">
                            <div>{groupGradeMatrix.totalStudents}</div>
                            <div className="flex justify-center gap-1 text-xs mt-0.5">
                              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">预 {groupGradeMatrix.totalPrepaid}</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">续 {groupGradeMatrix.totalRenewed}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {(matrixView === 'grade' && !teacherGradeMatrix && !matrixLoading) || (matrixView === 'group' && !groupGradeMatrix && !matrixLoading) ? (
                  <div className="py-8 text-center text-slate-400">暂无矩阵数据</div>
                ) : null}
              </>
            )}
          </div>

          {/* 快速榜单 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                续科人数 TOP 10
              </h4>
              {renewalRanking.length > 0 ? (
                <BarList rows={renewalRanking} maxValue={maxRenewed} compact />
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">暂无续科数据</p>
              )}
            </div>
            <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                激励差额 TOP 10
              </h4>
              {gapRanking.length > 0 ? (
                <BarList rows={gapRanking} compact />
              ) : (
                <div className="rounded-xl bg-emerald-50/60 px-4 py-6 text-center text-sm text-emerald-700 ring-1 ring-emerald-100">
                  所有老师都已达标，没有激励缺口
                </div>
              )}
            </div>
          </div>

          {/* 明细表格 */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 font-medium">教师</th>
                    <th className="px-4 py-3 font-medium">科组</th>
                    <th className="px-4 py-3 font-medium">基数</th>
                    {cols.map(col => (
                      <th key={col.key} className="px-4 py-3 font-medium">{col.label}</th>
                    ))}
                    <th className="px-4 py-3 font-medium">续科</th>
                    <th className="px-4 py-3 font-medium">续科率</th>
                    <th className="px-4 py-3 font-medium">激励差额</th>
                    <th className="px-4 py-3 font-medium" aria-label="学生状态"><span className="sr-only">学生状态</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, idx) => {
                    const name = r.teacherName || ('行 ' + idx);
                    return (
                      <TeacherRow
                        key={idx}
                        r={r}
                        name={name}
                        open={expanded.has(name)}
                        cols={cols}
                        colSpan={8 + cols.length}
                        onToggle={() => toggleTeacher(name)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </CardBody>
      </Card>
      {cellDetail.cell && <MatrixCellDetail cell={cellDetail.cell} type={cellDetail.type} onClose={closeCellDetail} />}
    </>
  );
}