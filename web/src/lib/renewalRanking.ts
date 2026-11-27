export type RenewalRankingMode = 'pre' | 'renew';

export interface RenewalRankingMetrics {
  prepaidRate: number | null | undefined;
  prepaidCount: number | null | undefined;
  renewRate: number | null | undefined;
  renewedCount: number | null | undefined;
}

const RANKING_FIELDS = {
  pre: { rate: 'prepaidRate', count: 'prepaidCount' },
  renew: { rate: 'renewRate', count: 'renewedCount' },
} as const;

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 降序比较；null、undefined 与非有限数始终排在有效数值之后。 */
export function compareNullableNumberDesc(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  const leftPresent = isPresentNumber(left);
  const rightPresent = isPresentNumber(right);
  if (leftPresent && rightPresent) return right - left;
  if (leftPresent) return -1;
  if (rightPresent) return 1;
  return 0;
}

/**
 * 预存/续科统一排序：率先、人数后，最后按名称升序。
 * 名称也相同则返回 0，由调用方保留原始相对顺序。
 */
export function compareRenewalRanking<T extends RenewalRankingMetrics>(
  left: T,
  right: T,
  mode: RenewalRankingMode,
  getName: (row: T) => string,
): number {
  const fields = RANKING_FIELDS[mode];
  return compareNullableNumberDesc(left[fields.rate], right[fields.rate])
    || compareNullableNumberDesc(left[fields.count], right[fields.count])
    || getName(left).localeCompare(getName(right), 'zh-CN');
}

/** 返回新数组，不修改接口数据；显式索引保证完全同名时顺序稳定。 */
export function rankByRenewalMetric<T extends RenewalRankingMetrics>(
  rows: readonly T[],
  mode: RenewalRankingMode,
  getName: (row: T) => string,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => (
      compareRenewalRanking(left.row, right.row, mode, getName) || left.index - right.index
    ))
    .map(({ row }) => row);
}
