/**
 * 听评课报告（纯文本）的复制/导出工具。
 *
 * 报告由 AI 生成，结构为：
 *   【听课人评价】
 *   一、… 二、… 八、…
 *   【综合评价与建议】
 *   · 亮点 / 待优化 / 建议 / 总体评价等级
 * 这里只做"切块"，供前端按需复制进 Word；切不出就退化为整份。
 */

/** 把报告拆成"听课人评价"（8 项）与"综合评价与建议"两大块。 */
export function splitReport(report: string): { head: string; tail: string } {
  const idx = report.indexOf('【综合评价与建议】');
  const rawHead = idx >= 0 ? report.slice(0, idx) : report;
  const head = rawHead.replace('【听课人评价】', '').trim();
  const tail = idx >= 0 ? report.slice(idx).trim() : '';
  return { head, tail };
}

/** .txt 导出文件名：听评课_老师_课题.txt（去掉非法字符）。 */
export function buildReportFilename(teacher: string, topic: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();
  return '听评课_' + (clean(teacher) || '老师') + '_' + (clean(topic) || '报告') + '.txt';
}
