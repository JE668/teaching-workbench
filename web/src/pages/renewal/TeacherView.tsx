import { ChevronDown, Users } from 'lucide-react';
import EmptyState from '../../components/ui/EmptyState';
import StudentGrid from '../../components/renewal/StudentGrid';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { TAB_LABELS, TAB_ORDER, count, NOT_AVAILABLE_YET, pct, type TeacherStatRow } from '../../lib/renewal';

interface Props {
  rows: TeacherStatRow[];
  tab: string;
  setTab: (t: string) => void;
  expanded: Set<string>;
  toggleTeacher: (name: string) => void;
}

interface Col {
  key: string;
  label: string;
  isRate: boolean;
  get: (r: TeacherStatRow) => number | null;
}

/**
 * 4 个 tab 的差异化列。
 * extra 装各 tab 特有拆分列（学段分学段、课时分 0-80/80+）；
 * 表里没有该列时为 null，展示成 '—'。
 */
function tabColumns(tab: string): Col[] {
  if (tab === 'stage') {
    return [
      { key: 'juniorBase', label: '在读-非毕业班', isRate: false, get: r => r.extra['juniorBase'] ?? r.baseCount },
      { key: 'junior3Base', label: '在读-初三', isRate: false, get: r => r.extra['junior3Base'] ?? null },
      { key: 'junior3Prepaid', label: '预存-初三', isRate: false, get: r => r.extra['junior3Prepaid'] ?? null },
    ];
  }
  if (tab === 'mentor') {
    return [
      { key: 'prepaidCount', label: '预存人数', isRate: false, get: r => r.prepaidCount },
      { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
    ];
  }
  if (tab === 'hours') {
    return [
      { key: 'under80', label: '在读 0-80h', isRate: false, get: r => r.extra['under80'] ?? r.baseCount },
      { key: 'over80', label: '在读 80h+', isRate: false, get: r => r.extra['over80'] ?? null },
      { key: 'renew80', label: '续生 80h+', isRate: false, get: r => r.extra['renew80'] ?? null },
    ];
  }
  // incentive 已单独有「激励差额」列，这里补预存
  return [
    { key: 'prepaidCount', label: '预存人数', isRate: false, get: r => r.prepaidCount },
    { key: 'prepaidRate', label: '预存率', isRate: true, get: r => r.prepaidRate },
  ];
}

/**
 * 教师统计视图。
 * 四个 tab（激励/学段/学管/课时）共用同一张表，切 tab 后表头列与右侧学生色块一起换。
 * 点教师名展开该老师的完整色块明细。
 */
export default function TeacherView({ rows, tab, setTab, expanded, toggleTeacher }: Props) {
  const cols = tabColumns(tab);
  return (
    <Card>
      <CardHeader
        title="教师统计"
        description="四个 tab 对应表里四张同名统计表，切换后表头列与学生色块一起换"
        icon={<Users className="h-5 w-5" />}
        action={
          <div role="tablist" aria-label="统计表 tab" className="flex gap-1">
            {TAB_ORDER.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === t ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {TAB_LABELS[t] || t}
              </button>
            ))}
          </div>
        }
      />
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="本期数据为空，下月开启"
            description="该统计表的数据将在下个月录入完成后显示。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">教师</th>
                  <th className="px-4 py-2.5 font-medium">科组</th>
                  <th className="px-4 py-2.5 font-medium">基数</th>
                  {cols.map(col => (
                    <th key={col.key} className="px-4 py-2.5 font-medium">{col.label}</th>
                  ))}
                  <th className="px-4 py-2.5 font-medium">续科</th>
                  <th className="px-4 py-2.5 font-medium">续科率</th>
                  <th className="px-4 py-2.5 font-medium">激励差额</th>
                  <th className="px-4 py-2.5 font-medium">学生色块</th>
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
        )}
      </CardBody>
    </Card>
  );
}

function TeacherRow({ r, name, open, cols, colSpan, onToggle }: {
  r: TeacherStatRow;
  name: string;
  open: boolean;
  cols: Col[];
  colSpan: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={cn('align-top hover:bg-slate-50/60', open && 'bg-brand-50/30')}>
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-1.5 font-medium text-slate-700 hover:text-brand-600"
            title={open ? '收起学生色块' : '展开学生色块'}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', !open && '-rotate-90')} />
            <span>{name}</span>
          </button>
          {r.teacherNo && <div className="mt-0.5 pl-5 text-xs text-slate-400">{r.teacherNo}</div>}
        </td>
        <td className="px-4 py-3 text-slate-600">{r.subjectGroup || '-'}</td>
        <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.baseCount)}</td>
        {cols.map(col => (
          <td key={col.key} className="px-4 py-3 tabular-nums text-slate-600">
            {col.isRate ? pct(col.get(r)) : count(col.get(r))}
          </td>
        ))}
        <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.renewedCount)}</td>
        <td className="px-4 py-3 tabular-nums font-medium text-slate-700">{pct(r.renewRate)}</td>
        <td className="px-4 py-3 tabular-nums">
          {r.incentiveGap === null || r.incentiveGap === undefined ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span className={cn('font-medium', r.incentiveGap > 0 ? 'text-amber-600' : 'text-emerald-600')}>
              {count(r.incentiveGap)}
            </span>
          )}
        </td>
        <td className="max-w-[280px] px-4 py-3">
          {r.studentCount > 0 ? <StudentGrid students={r.students} /> : <span className="text-xs text-slate-400">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={colSpan} className="px-6 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
              <span className="font-medium">{r.teacherName || name} 的学生色块明细</span>
              <span>{r.students.length} 人</span>
              <StudentGrid students={r.students} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
