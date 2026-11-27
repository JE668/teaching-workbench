import { describe, expect, it } from 'vitest';
import {
  compareNullableNumberDesc,
  rankByRenewalMetric,
  type RenewalRankingMetrics,
} from './renewalRanking';

interface Row extends RenewalRankingMetrics {
  name: string;
}

function row(name: string, overrides: Partial<Row> = {}): Row {
  return {
    name,
    prepaidRate: null,
    prepaidCount: null,
    renewRate: null,
    renewedCount: null,
    ...overrides,
  };
}

const byName = (item: Row) => item.name;
const names = (items: Row[]) => items.map(item => item.name);

describe('renewalRanking', () => {
  it('预存模式按预存率、预存人数降序，空率最后且名称打破平局', () => {
    const input = [
      row('空率大人数', { prepaidCount: 999 }),
      row('B同名指标', { prepaidRate: 80, prepaidCount: 5 }),
      row('低率高人数', { prepaidRate: 10, prepaidCount: 100 }),
      row('A同名指标', { prepaidRate: 80, prepaidCount: 5 }),
      row('人数优先', { prepaidRate: 80, prepaidCount: 8 }),
    ];

    expect(names(rankByRenewalMetric(input, 'pre', byName))).toEqual([
      '人数优先',
      'A同名指标',
      'B同名指标',
      '低率高人数',
      '空率大人数',
    ]);
    expect(names(input)).toEqual(['空率大人数', 'B同名指标', '低率高人数', 'A同名指标', '人数优先']);
  });

  it('续费模式按续科率、续科人数降序，空人数排在同率有效人数之后', () => {
    const input = [
      row('空人数', { renewRate: 60, renewedCount: null }),
      row('低率大人数', { renewRate: 20, renewedCount: 100 }),
      row('同率少人数', { renewRate: 60, renewedCount: 2 }),
      row('同率多人数', { renewRate: 60, renewedCount: 8 }),
      row('空率', { renewRate: null, renewedCount: 999 }),
    ];

    expect(names(rankByRenewalMetric(input, 'renew', byName))).toEqual([
      '同率多人数',
      '同率少人数',
      '空人数',
      '低率大人数',
      '空率',
    ]);
  });

  it('0 是有效指标，非有限数按空值处理，完全同名时保持原顺序', () => {
    const first = row('同名', { prepaidRate: 0, prepaidCount: 0 });
    const second = row('同名', { prepaidRate: 0, prepaidCount: 0 });
    const input = [
      row('无效率', { prepaidRate: Number.NaN, prepaidCount: 50 }),
      first,
      second,
      row('无穷率', { prepaidRate: Number.POSITIVE_INFINITY, prepaidCount: 10 }),
    ];

    expect(rankByRenewalMetric(input, 'pre', byName)).toEqual([first, second, input[0], input[3]]);
    expect(compareNullableNumberDesc(null, 0)).toBe(1);
    expect(compareNullableNumberDesc(0, null)).toBe(-1);
    expect(compareNullableNumberDesc(undefined, Number.NaN)).toBe(0);
  });
});
