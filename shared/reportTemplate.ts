/**
 * 月度报告 AI Prompt 模板常量 —— 前后端共享
 * 
 * 修改这里会同时影响：
 *  - 后端 buildReportSummaryMessages / buildReportPlanMessages（实际发给模型的指令）
 *  - 前端 ReportEdit.tsx 的 placeholder（用户看到的输入框提示）
 * 
 * 保持两边同步，避免"生成的格式对不上输入框"的问题。
 */

export const REPORT_SUMMARY_SECTIONS = [
  { key: 'classroom', label: '课堂情况', emoji: '📚', placeholder: '本月计划x次课……' },
  { key: 'content', label: '学习内容', emoji: '📖', placeholder: '' },
  { key: 'gains', label: '本月收获', emoji: '🎯', placeholder: '' },
  { key: 'progress', label: '进步表现', emoji: '🏆', placeholder: '' },
  { key: 'weakness', label: '本月不足', emoji: '📝', placeholder: '' },
  { key: 'advice', label: '建议', emoji: '💡', placeholder: '' },
  { key: 'nextGoal', label: '下月目标', emoji: '🎯', placeholder: '' },
] as const;

export const REPORT_PLAN_SECTIONS = [
  { key: 'goal', label: '核心目标', placeholder: '一句话总括本月教学重点与预期达成' },
  { key: 'content', label: '重点内容', placeholder: '1. [课程1] —— 让孩子会什么、练到什么程度\n2. [课程2] —— ……' },
] as const;

/** 总结 placeholder 文案（前端直接用） */
export function getSummaryPlaceholder(): string {
  return REPORT_SUMMARY_SECTIONS.map(s => 
    `${s.emoji}${s.label}：${s.placeholder || '…'}`
  ).join('\n');
}

/** 规划 placeholder 文案（前端直接用） */
export function getPlanPlaceholder(): string {
  return REPORT_PLAN_SECTIONS.map(s => 
    `${s.label}：${s.placeholder || '…'}`
  ).join('\n');
}

/** 总结段落标题数组（后端 prompt 用） */
export const SUMMARY_SECTION_TITLES = REPORT_SUMMARY_SECTIONS.map(s => `${s.emoji}${s.label}：`);

/** 规划段落标题数组（后端 prompt 用） */
export const PLAN_SECTION_TITLES = REPORT_PLAN_SECTIONS.map(s => `${s.label}：`);

/** 字数区间常量（前后端一致） */
export const WORD_RANGES = {
  summary: { min: 240, max: 340 },
  plan: { baseMin: 90, baseMax: 160, perExtraCourse: 15 },
} as const;

/** 规划按课次数计算动态字数上限 */
export function planWordRange(courseCount: number): { min: number; max: number } {
  const base = WORD_RANGES.plan;
  if (courseCount > 3) {
    const extra = Math.floor((courseCount - 1) / 3) * base.perExtraCourse;
    return { min: base.baseMin, max: base.baseMax + extra };
  }
  return { min: base.baseMin, max: base.baseMax };
}

/** 总结字数区间 */
export const SUMMARY_WORD_RANGE = WORD_RANGES.summary;