/**
 * 看板筛选的日期区间工具。
 *
 * 前端只负责把"近 30 天"这种选项换算成 from/to 日期对，
 * 具体过滤交给后端 SQL（date(observed_at) 比较），避免把全量数据拉回前端再筛。
 */

/** '' = 全部时间；其余为天数 */
export type RangeKey = '' | '7' | '30' | '90' | '365';

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '', label: '全部时间' },
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: '365', label: '近一年' },
];

/** 本地时区下的 YYYY-MM-DD（走本地 getFullYear，不经过 UTC，避免跨天差一天） */
export function isoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 时间范围 → from/to；全部时间返回空对象 */
export function rangeFromDays(
  key: RangeKey,
  today: Date = new Date()
): { from?: string; to?: string } {
  const days = Number(key);
  if (!key || !Number.isFinite(days) || days <= 0) return {};
  const from = new Date(today);
  // 含今天：近 7 天 = 今天往前 6 天到今天
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(today) };
}

/** 拼 query string：跳过空值，值做 URI 编码；无有效参数返回 '' */
export function toQueryString(params: Record<string, string | number | '' | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v == null) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}
