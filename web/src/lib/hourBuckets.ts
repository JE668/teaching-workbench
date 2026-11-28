import type { TeacherStatRow } from './renewal';
import { normalizeStatus, StandardStatus } from '@shared/statusDictionary.js';

/**
 * 教师统计表(课时)学生网格的五档分组。
 * slot 是 parser 从 W 列开始记录的学生网格相对位置；分隔列不占 slot。
 * 新增续费学生位于另一组网格（slot 35–39），不计入在读课时分段。
 */
export const HOUR_BUCKETS = [
  { key: '0_24', shortLabel: '0–24', label: '0–24 课时', minSlot: 1, maxSlot: 7 },
  { key: '24_40', shortLabel: '24–40', label: '24–40 课时', minSlot: 9, maxSlot: 17 },
  { key: '40_60', shortLabel: '40–60', label: '40–60 课时', minSlot: 19, maxSlot: 22 },
  { key: '60_80', shortLabel: '60–80', label: '60–80 课时', minSlot: 24, maxSlot: 27 },
  { key: '80p', shortLabel: '80+', label: '80+ 课时', minSlot: 29, maxSlot: 33 },
] as const;

export type HourBucket = (typeof HOUR_BUCKETS)[number];
export interface HourBucketCount {
  enrolled: number | null;
  prepaid: number | null;
}

export function hasHourGridStudents(row: Pick<TeacherStatRow, 'students'>): boolean {
  return row.students.some((student) => HOUR_BUCKETS.some(
    (bucket) => student.slot >= bucket.minSlot && student.slot <= bucket.maxSlot,
  ));
}

/** 网格完全缺失且源表并非明确的零基数时保留未知，不把公式缓存缺失当成 0 人。 */
function knownEmptyGrid(row: Pick<TeacherStatRow, 'baseCount' | 'extra'>): boolean {
  return row.baseCount === 0 || (row.extra.enroll_0_80 === 0 && row.extra.enroll_80p === 0);
}

export function hourBucketCounts(
  row: Pick<TeacherStatRow, 'baseCount' | 'extra' | 'students'>,
  bucket: HourBucket,
): HourBucketCount {
  if (!hasHourGridStudents(row) && !knownEmptyGrid(row)) return { enrolled: null, prepaid: null };
  let enrolled = 0;
  let prepaid = 0;
  for (const student of row.students) {
    if (student.slot < bucket.minSlot || student.slot > bucket.maxSlot) continue;
    enrolled += 1;
    if (normalizeStatus(student.status as StandardStatus) === 'prepaid') prepaid += 1;
  }
  return { enrolled, prepaid };
}

function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

export function summarizeHourBucket(rows: TeacherStatRow[], bucket: HourBucket): HourBucketCount {
  const counts = rows.map((row) => hourBucketCounts(row, bucket));
  return {
    enrolled: sumKnown(counts.map((count) => count.enrolled)),
    prepaid: sumKnown(counts.map((count) => count.prepaid)),
  };
}
