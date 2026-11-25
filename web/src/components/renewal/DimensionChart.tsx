import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { TeacherStatRow } from '../../lib/renewal';
import { HOUR_BUCKETS, hourBucketCounts, summarizeHourBucket } from '../../lib/hourBuckets';

interface DimensionDefinition {
  label: string;
  enrolledKey: string;
  prepaidKey: string;
}

const STAGE_DIMENSIONS: DimensionDefinition[] = [
  { label: '非毕业班', enrolledKey: 'enroll_nongrad', prepaidKey: 'prepaid_nongrad' },
  { label: '初三', enrolledKey: 'enroll_g9', prepaidKey: 'prepaid_g9' },
  { label: '高三', enrolledKey: 'enroll_g12', prepaidKey: 'prepaid_g12' },
];

function sumExtra(rows: TeacherStatRow[], key: string): number | null {
  let found = false;
  let total = 0;
  for (const row of rows) {
    const value = row.extra[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

function formatCount(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

/** 学段/课时的在读与预存分布；仅汇总 Excel 原始人数，不重算业务比率。 */
export default function DimensionChart({ rows, tab }: { rows: TeacherStatRow[]; tab: string }) {
  const isHourView = tab === 'hours';
  const definitions = tab === 'stage' ? STAGE_DIMENSIONS : isHourView ? [] : null;
  const data = useMemo(() => isHourView
    ? HOUR_BUCKETS.map(bucket => ({ label: bucket.label, ...summarizeHourBucket(rows, bucket) }))
    : definitions?.map(item => ({
      ...item,
      enrolled: sumExtra(rows, item.enrolledKey),
      prepaid: sumExtra(rows, item.prepaidKey),
    })) ?? [], [definitions, isHourView, rows]);

  if (!definitions) return null;
  const title = tab === 'stage' ? '学段学生与预存分布' : '课时学生与预存分布';
  const maxEnrolled = Math.max(...data.map(item => item.enrolled ?? 0), 1);
  const hasData = data.some(item => item.enrolled !== null || item.prepaid !== null);
  const missingHourTeachers = isHourView
    ? rows.filter(row => hourBucketCounts(row, HOUR_BUCKETS[0]).enrolled === null).length
    : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="dimension-chart-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="dimension-chart-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BarChart3 className="h-4 w-4 text-brand-600" aria-hidden="true" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {isHourView
              ? `按 ${rows.length} 位教师的学生网格五档分组汇总，新增续费学生不重复计入`
              : `按 ${rows.length} 位教师明细汇总，不重复计入科组小计与学习中心总计`}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500" aria-label="图例">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" />在读人数</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" />预存人数</span>
        </div>
      </div>
      {hasData ? (
        <div className="mt-5 space-y-5">
          {data.map(item => (
            <div
              key={item.label}
              className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center"
              role="img"
              aria-label={item.label + '：在读 ' + formatCount(item.enrolled) + ' 人，预存 ' + formatCount(item.prepaid) + ' 人'}
            >
              <div className="text-sm font-medium text-slate-700">{item.label}</div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-300" style={{ width: ((item.enrolled ?? 0) / maxEnrolled * 100) + '%' }} />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-slate-600">{formatCount(item.enrolled)} 人</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-violet-50">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: ((item.prepaid ?? 0) / maxEnrolled * 100) + '%' }} />
                  </div>
                  <span className="w-16 text-right text-xs font-medium tabular-nums text-violet-700">{formatCount(item.prepaid)} 人</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          {isHourView ? '当前报表缺少可识别的课时学生网格，空值未按 0 人统计' : '当前报表未提供该维度的拆分数据'}
        </p>
      )}
      {isHourView && hasData && missingHourTeachers > 0 && (
        <p role="note" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          另有 {missingHourTeachers} 位教师缺少可识别的课时学生网格，未按 0 人计入。
        </p>
      )}
    </section>
  );
}
