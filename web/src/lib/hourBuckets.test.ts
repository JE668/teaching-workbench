import { describe, expect, it } from 'vitest';
import { HOUR_BUCKETS, hasHourGridStudents, hourBucketCounts, summarizeHourBucket } from './hourBuckets';
import type { TeacherStatRow } from './renewal';

function row(students: TeacherStatRow['students'], baseCount: number | null = 20): TeacherStatRow {
  return {
    tab: 'hours', teacherName: '教师', teacherNo: 'T1', subjectGroup: '理科', baseCount,
    prepaidCount: null, prepaidRate: null, renewedCount: null, renewRate: null, incentiveGap: null,
    extra: { enroll_0_80: 11, enroll_80p: 9 }, studentCount: students.length, students,
  };
}

describe('课时五档学生网格汇总', () => {
  it('按源表 slot 边界统计五档并排除分隔列与新增续费网格', () => {
    const students = [
      { name: '0-24预存', status: 'prepaid', slot: 1 },
      { name: '0-24边界', status: 'normal', slot: 7 },
      { name: '24-40', status: 'prepaid', slot: 9 },
      { name: '24-40边界', status: 'renewed', slot: 17 },
      { name: '40-60', status: 'normal', slot: 19 },
      { name: '40-60边界', status: 'prepaid', slot: 22 },
      { name: '60-80', status: 'prepaid', slot: 24 },
      { name: '60-80边界', status: 'normal', slot: 27 },
      { name: '80+', status: 'renewed', slot: 29 },
      { name: '80+边界', status: 'prepaid', slot: 33 },
      { name: '分隔列', status: 'prepaid', slot: 8 },
      { name: '新增续费网格', status: 'prepaid', slot: 35 },
    ];
    const source = row(students, 12);
    expect(HOUR_BUCKETS.map((bucket) => hourBucketCounts(source, bucket))).toEqual([
      { enrolled: 2, prepaid: 1 }, { enrolled: 2, prepaid: 1 }, { enrolled: 2, prepaid: 1 },
      { enrolled: 2, prepaid: 1 }, { enrolled: 2, prepaid: 1 },
    ]);
    expect(hasHourGridStudents(source)).toBe(true);
  });

  it('跨教师先汇总人数，网格缺失保留未知，明确零基数才显示 0', () => {
    const available = row([{ name: '学生', status: 'prepaid', slot: 1 }], 1);
    const missing = row([], 5);
    const empty = row([], 0);
    expect(hourBucketCounts(missing, HOUR_BUCKETS[0])).toEqual({ enrolled: null, prepaid: null });
    expect(hourBucketCounts(empty, HOUR_BUCKETS[0])).toEqual({ enrolled: 0, prepaid: 0 });
    expect(summarizeHourBucket([available, missing], HOUR_BUCKETS[0])).toEqual({ enrolled: 1, prepaid: 1 });
    expect(summarizeHourBucket([missing], HOUR_BUCKETS[0])).toEqual({ enrolled: null, prepaid: null });
  });
});
