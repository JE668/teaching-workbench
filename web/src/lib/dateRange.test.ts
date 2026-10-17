import { describe, it, expect } from 'vitest';
import { isoDate, rangeFromDays, toQueryString, RANGE_OPTIONS } from './dateRange';

function d(iso: string): Date {
  return new Date(iso + 'T12:00:00');
}

describe('isoDate', () => {
  it('补零且按本地日期输出', () => {
    expect(isoDate(d('2026-01-05'))).toBe('2026-01-05');
    expect(isoDate(d('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('rangeFromDays', () => {
  const today = d('2026-10-17');

  it('全部时间返回空对象', () => {
    expect(rangeFromDays('', today)).toEqual({});
  });

  it('近 7 天 = 今天往前 6 天到今天（含今天）', () => {
    expect(rangeFromDays('7', today)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
  });

  it('近 30 天 / 90 天 / 365 天', () => {
    expect(rangeFromDays('30', today)).toEqual({ from: '2026-09-18', to: '2026-10-17' });
    expect(rangeFromDays('90', today).from).toBe('2026-07-20');
    expect(rangeFromDays('365', today).from).toBe('2025-10-18');
  });

  it('跨月与跨年不串行', () => {
    expect(rangeFromDays('7', d('2027-01-01'))).toEqual({ from: '2026-12-26', to: '2027-01-01' });
    // 2026 非闰年，2 月 28 天：3 月 1 日往前 6 天是 2 月 23 日
    expect(rangeFromDays('7', d('2026-03-01'))).toEqual({ from: '2026-02-23', to: '2026-03-01' });
    // 闰年 2028：2 月 29 天，3 月 1 日往前 6 天是 2 月 24 日
    expect(rangeFromDays('7', d('2028-03-01'))).toEqual({ from: '2028-02-24', to: '2028-03-01' });
  });

  it('非法值退回空对象（不崩）', () => {
    expect(rangeFromDays('0' as any, today)).toEqual({});
    expect(rangeFromDays('abc' as any, today)).toEqual({});
  });

  it('选项表覆盖全部时间 + 4 个区间', () => {
    expect(RANGE_OPTIONS.map((o) => o.value)).toEqual(['', '7', '30', '90', '365']);
    expect(RANGE_OPTIONS.every((o) => o.label)).toBe(true);
  });
});

describe('toQueryString', () => {
  it('拼出正确查询串并编码', () => {
    expect(toQueryString({ teacherId: 3, from: '2026-10-01', to: '2026-10-17' }))
      .toBe('?teacherId=3&from=2026-10-01&to=2026-10-17');
  });

  it('跳过空字符串 / null / undefined', () => {
    expect(toQueryString({ teacherId: '', from: null, to: undefined })).toBe('');
    expect(toQueryString({ teacherId: '', range: 30 })).toBe('?range=30');
  });
});
