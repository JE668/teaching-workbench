/**
 * 月度报告的月份口径。总结讲本月、规划讲下个月，两个地方都要用同一套算法，
 * 所以收敛在这里，不要让路由和 AI 服务各写一份。
 */

/** '2026-09' → '9月' */
export function monthLabel(yearMonth: string): string {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(yearMonth || ''));
  return m ? `${Number(m[2])}月` : '';
}

/** '2026-09' → '2026-10'（总结是本月、规划是下个月的场景） */
export function nextYearMonth(yearMonth: string): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(yearMonth || ''));
  if (!m) return String(yearMonth || '');
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}
