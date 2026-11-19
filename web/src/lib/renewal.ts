/**
 * 续费看板前端领域层。
 *
 * 设计原则与后端一致：**不重算业务指标**。
 * 用户在 Excel 里算好的数（预存率/续科率/激励差额/现金流…）直接展示，
 * 这里只做三件事：类型声明、展示格式化、颜色状态映射。
 *
 * 唯一需要前端复刻的业务细节是学生网格颜色 —— 那本来是 Excel 条件格式，
 * 后端解析时已按优先级算好 status 存库，这里只负责把 status 变回颜色。
 */

/** 学生网格颜色状态（与后端 parser.ts 的 GridStatus 对应） */
export type GridStatus = 'renewed' | 'prepaid' | 'stopped' | 'closed' | 'grade3' | 'normal';

/**
 * 颜色取自用户在 Excel 里配的条件格式，保证「系统显示的色 = 表里看到的色」。
 * renewed=绿 00B050 / prepaid=紫 7030A0 / stopped=橙 FFC000 / closed=红 FF0000。
 * grade3 与 normal 原表未上色，这里用低对比度灰蓝/浅灰以示区分。
 */
export const GRID_STATUS_META: Record<GridStatus, { label: string; hex: string }> = {
  renewed: { label: '已续费', hex: '#00B050' },
  prepaid: { label: '已预存', hex: '#7030A0' },
  stopped: { label: '停课', hex: '#FFC000' },
  closed: { label: '结课', hex: '#FF0000' },
  grade3: { label: '高三', hex: '#8C9BB5' },
  normal: { label: '未标记', hex: '#EEF2F7' },
};

/** 汇总卡片的遍历顺序（normal 是底色，不进图例） */
export const GRID_STATUS_ORDER: GridStatus[] = ['renewed', 'prepaid', 'stopped', 'closed', 'grade3', 'normal'];

/** 颜色状态 → 图例项（含色块） */
export function gridLegend(): { status: GridStatus; label: string; hex: string }[] {
  return GRID_STATUS_ORDER.filter(s => s !== 'normal').map(s => ({
    status: s,
    label: GRID_STATUS_META[s].label,
    hex: GRID_STATUS_META[s].hex,
  }));
}

/** 4 个教师统计表 tab 的展示名（顺序即下拉顺序） */
export const TAB_LABELS: Record<string, string> = {
  incentive: '激励',
  stage: '学段',
  mentor: '学管',
  hours: '课时',
};

export const TAB_ORDER = ['incentive', 'stage', 'mentor', 'hours'] as const;

/** 后端批次列表行 */
export interface ReportSummary {
  reportId: number;
  fileName: string;
  fileSize: number;
  statMonth: string | null;
  centerName: string | null;
  rowCount: number | null;
  errorCount: number;
  status: string;
  uploadedAt: string;
}

/** 教师统计行（4 个 tab 共用形状，extra 装 tab 特有拆分列） */
export interface TeacherStatRow {
  tab: string;
  teacherName: string | null;
  teacherNo: string | null;
  subjectGroup: string | null;
  baseCount: number | null;
  prepaidCount: number | null;
  prepaidRate: number | null;
  renewedCount: number | null;
  renewRate: number | null;
  incentiveGap: number | null;
  extra: Record<string, number | null>;
  studentCount: number;
  students: { name: string; status: string; slot: number }[];
}

/** 科组汇总 */
export interface GroupSummaryRow {
  subjectGroup: string;
  teacherCount: number;
  baseCount: number;
  prepaidCount: number;
  renewedCount: number;
  prepaidRate: number | null;
  renewRate: number | null;
  incentiveGap: number;
}

/** 学管业绩行 */
export interface ManagerPerfRow {
  managerName: string;
  renew: { one2one: number | null; one2many: number | null; small: number | null; other: number | null; total: number | null };
  newsign: { one2one: number | null; one2many: number | null; small: number | null; other: number | null; total: number | null };
  renewedCount: number | null;
  tutoredCount: number | null;
  renewRate: number | null;
  taskAmount: number | null;
  cashflowTotal: number | null;
  completionRate: number | null;
  actualStudents: number | null;
  perStudent: number | null;
  avgOrder: number | null;
  gap80: number | null;
}

/** 续生漏斗行（按学管） */
export interface FunnelRow {
  managerName: string;
  students: number;
  classedLast1: number;
  classedLast2: number;
  renewed: number;
  renewRate: number | null;
}

/** 风险学生行 */
export interface RiskStudentRow {
  managerName: string | null;
  studentId: string | null;
  studentName: string;
  grade: string | null;
  enrollDays: number | null;
  coef: number | null;
  type: string | null;
  courseProduct: string | null;
  classLast1: number | null;
  classLast2: number | null;
}

/* ---------- 展示格式化 ---------- */

/**
 * 把后端读出来的率值格式化成百分比字符串。
 * 容错策略：Excel 公式 #DIV/0! 会被解析层当成空值传上来，
 * 此时显示 '—' 而不是 NaN%（后者会让表格读起来像坏数据）。
 */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits) + '%';
}

/**
 * 钱数：单位「万」，保留 1 位。
 * 学管业绩里的 taskAmount/cashflowTotal 是大数（百万级），直接列出来会把表格撑爆。
 */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return (value / 10000).toFixed(1) + ' 万';
}

/** 整数人数：缺失显示 '—'，浮点残留四舍五入 */
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return String(Math.round(value));
}

/** 文件体积（字节 → 人类可读） */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** 汇总卡的「达成度」：0-100 用于进度条，钳到 [0,100] 避免渲染出溢出条 */
export function clampRatio(numerator: number | null, denominator: number | null): number {
  if (!denominator || denominator <= 0) return 0;
  if (!numerator || numerator < 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 100));
}

/** 排名样式：前三名给底色（榜单场景），其余无底色 */
export function rankStyle(index: number): string {
  if (index === 0) return 'bg-amber-50';
  if (index === 1) return 'bg-slate-50';
  if (index === 2) return 'bg-sky-50/60';
  return '';
}

/** 空数据占位：本期缺失、下月开启 */
export const NOT_AVAILABLE_YET = '下月开启'; // "下月开启"
