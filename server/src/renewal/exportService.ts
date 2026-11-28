import { renewalDb } from './db.js';
import { getTeacherStats, getGroupComparison, getManagerPerf, getFunnel, getRiskStudentsPage, getStudentStatusSummary, getMentorMatrix, getTeacherGradeMatrix, getGroupGradeMatrix, getRateOverview, getMultiPeriodComparison, getAvailableStatMonths, getAvailableCenters, type TeacherStatFull, type GroupSummary, type ManagerPerfDto, type FunnelDto, type RiskStudentPage, type RiskStudentDto, type MentorMatrix, type TeacherGradeMatrix, type GroupGradeMatrix, type RateOverview, type MultiPeriodComparison } from './analytics.js';
import { log } from '../utils/logger.js';

/**
 * 导出数据结构定义
 */
export interface ExportSheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
  columnWidths?: number[];
  styles?: {
    header?: Partial<ExcelStyle>;
    body?: Partial<ExcelStyle>;
    conditional?: ConditionalFormat[];
  };
}

export interface ExcelStyle {
  font?: { bold?: boolean; color?: string; size?: number; name?: string };
  fill?: { type: 'pattern'; pattern: 'solid'; fgColor: string };
  alignment?: { horizontal?: 'left' | 'center' | 'right'; vertical?: 'top' | 'middle' | 'bottom'; wrapText?: boolean };
  border?: { top?: BorderStyle; bottom?: BorderStyle; left?: BorderStyle; right?: BorderStyle };
  numFmt?: string;
}

export interface BorderStyle {
  style: 'thin' | 'medium' | 'thick' | 'hair';
  color?: string;
}

export interface ConditionalFormat {
  type: 'cellIs' | 'colorScale' | 'dataBar';
  range: string; // e.g., 'C2:C100'
  operator?: 'greaterThan' | 'lessThan' | 'between' | 'equal';
  formula?: string[];
  colorScale?: { min: { color: string; type: 'num' | 'percent'; value: number }; max: { color: string; type: 'num' | 'percent'; value: number } };
  dataBar?: { color: string; showValue: boolean };
}

export interface ExportOptions {
  reportId: number;
  userId: number;
  template?: 'standard' | 'detailed' | 'executive' | 'matrix' | 'funnel' | 'risk' | 'multi-period';
  sheets?: string[]; // specific sheets to include
  includeCharts?: boolean;
  dateRange?: { start: string; end: string };
  centerName?: string;
  months?: string[];
}

/**
 * 标准导出模板：教师统计 4 个 tab + 科组对比 + 学管业绩 + 概览
 */
export async function buildStandardExport(reportId: number, userId: number): Promise<ExportSheet[]> {
  const sheets: ExportSheet[] = [];

  // 1. 概览页
  const overview = getRateOverview(reportId, 'mentor');
  sheets.push({
    name: '续费概览',
    headers: ['指标', '数值'],
    rows: [
      ['学生总数', overview.total],
      ['预存人数', overview.prepaidCount],
      ['到期人数', overview.expiredCount],
      ['续费人数', overview.renewedCount],
      ['流失人数', overview.lostCount],
      ['预存率', overview.prepaidRate ? overview.prepaidRate.toFixed(1) + '%' : '—'],
      ['到期率', overview.expiredRate ? overview.expiredRate.toFixed(1) + '%' : '—'],
      ['续费率', overview.renewedRate ? overview.renewedRate.toFixed(1) + '%' : '—'],
      ['流失率', overview.lostRate ? overview.lostRate.toFixed(1) + '%' : '—'],
      ['', ''],
      ['按学管分布', ''],
      ...overview.byManager.map(m => [m.managerName, `基数:${m.baseCount} 预存:${m.prepaidCount} 续费:${m.renewedCount} 预存率:${m.prepaidRate?.toFixed(1) ?? '—'}% 续费率:${m.renewRate?.toFixed(1) ?? '—'}%`]),
      ['', ''],
      ['按科组分布', ''],
      ...overview.byGroup.map(g => [g.subjectGroup, `基数:${g.baseCount} 预存:${g.prepaidCount} 续费:${g.renewedCount} 预存率:${g.prepaidRate?.toFixed(1) ?? '—'}% 续费率:${g.renewRate?.toFixed(1) ?? '—'}%`]),
    ],
    columnWidths: [30, 80],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '4F46E5' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'left' } },
    },
  });

  // 2. 教师统计 - 4 个 tab
  const tabs = ['incentive', 'stage', 'mentor', 'hours'];
  const tabLabels: Record<string, string> = { incentive: '激励', stage: '学段', mentor: '学管', hours: '课时' };

  for (const tab of tabs) {
    const rows = getTeacherStats(reportId, tab);
    sheets.push({
      name: `教师统计-${tabLabels[tab]}`,
      headers: ['教师', '工号', '科组', '基数', '预存人数', '预存率', '续费人数', '续费率', '激励差额', '学生数'],
      rows: rows.map(r => [
        r.teacherName || '—',
        r.teacherNo || '—',
        r.subjectGroup || '—',
        r.baseCount ?? '—',
        r.prepaidCount ?? '—',
        r.prepaidRate !== null ? r.prepaidRate.toFixed(1) + '%' : '—',
        r.renewedCount ?? '—',
        r.renewRate !== null ? r.renewRate.toFixed(1) + '%' : '—',
        r.incentiveGap ?? '—',
        r.studentCount,
      ]),
      columnWidths: [18, 12, 15, 10, 12, 12, 12, 12, 12, 10],
      styles: {
        header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '059669' }, alignment: { horizontal: 'center' } },
        body: { alignment: { horizontal: 'center' } },
        conditional: [
          { type: 'colorScale', range: `F2:F${rows.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: '10B981', type: 'num', value: 100 } } },
          { type: 'colorScale', range: `H2:H${rows.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: '10B981', type: 'num', value: 100 } } },
        ],
      },
    });
  }

  // 3. 科组对比
  const groupRows = getGroupComparison(reportId, 'incentive');
  sheets.push({
    name: '科组对比',
    headers: ['科组', '教师数', '基数', '预存人数', '续费人数', '预存率', '续费率', '激励差额'],
    rows: groupRows.map(r => [
      r.subjectGroup,
      r.teacherCount,
      r.baseCount,
      r.prepaidCount,
      r.renewedCount,
      r.prepaidRate !== null ? r.prepaidRate.toFixed(1) + '%' : '—',
      r.renewRate !== null ? r.renewRate.toFixed(1) + '%' : '—',
      r.incentiveGap,
    ]),
    columnWidths: [20, 10, 10, 12, 12, 12, 12, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '7C3AED' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
      conditional: [
        { type: 'colorScale', range: `F2:F${groupRows.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: 'A855F7', type: 'num', value: 100 } } },
        { type: 'colorScale', range: `G2:G${groupRows.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: 'A855F7', type: 'num', value: 100 } } },
      ],
    },
  });

  // 4. 学管业绩
  const managerRows = getManagerPerf(reportId, userId);
  sheets.push({
    name: '学管业绩',
    headers: ['学管', '续费1v1', '续费1vN', '续费小班', '续费其他', '续费合计', '新签合计', '现金流合计', '任务额', '完成率', '人均', '单价', '差距80%'],
    rows: managerRows.map(r => [
      r.managerName,
      r.renew.one2one ?? '—',
      r.renew.one2many ?? '—',
      r.renew.small ?? '—',
      r.renew.other ?? '—',
      r.renew.total ?? '—',
      r.newsign.total ?? '—',
      r.cashflowTotal ?? '—',
      r.taskAmount ?? '—',
      r.completionRate !== null ? r.completionRate.toFixed(1) + '%' : '—',
      r.perStudent ?? '—',
      r.avgOrder ?? '—',
      r.gap80 ?? '—',
    ]),
    columnWidths: [15, 12, 12, 12, 12, 12, 12, 15, 15, 12, 12, 12, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: 'EA580C' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
      conditional: [
        { type: 'colorScale', range: `J2:J${managerRows.length + 1}`, colorScale: { min: { color: 'FEF2F2', type: 'num', value: 0 }, max: { color: 'EF4444', type: 'num', value: 100 } } },
      ],
    },
  });

  // 5. 续生漏斗
  const funnelRows = getFunnel(reportId);
  sheets.push({
    name: '续生漏斗',
    headers: ['学管', '学生总数', '上2月课消', '上1月课消', '已续费', '续生率'],
    rows: funnelRows.map(r => [
      r.managerName,
      r.students,
      r.classedLast1,
      r.classedLast2,
      r.renewed,
      r.renewRate !== null ? r.renewRate.toFixed(1) + '%' : '—',
    ]),
    columnWidths: [15, 12, 12, 12, 12, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '0891B2' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
    },
  });

  return sheets;
}

/**
 * 详细导出模板：包含学生明细
 */
export async function buildDetailedExport(reportId: number, userId: number): Promise<ExportSheet[]> {
  const sheets = await buildStandardExport(reportId, userId);

  // 添加学生明细页（每个 tab 的学生）
  const tabs = ['incentive', 'stage', 'mentor', 'hours'];
  const tabLabels: Record<string, string> = { incentive: '激励', stage: '学段', mentor: '学管', hours: '课时' };

  for (const tab of tabs) {
    const rows = getTeacherStats(reportId, tab);
    const studentRows: (string | number | null)[][] = [];
    
    for (const teacher of rows) {
      for (const student of teacher.students) {
        studentRows.push([
          teacher.teacherName || '—',
          teacher.subjectGroup || '—',
          student.name,
          student.status,
          student.slot,
          student.studentId || '—',
        ]);
      }
    }

    if (studentRows.length > 0) {
      sheets.push({
        name: `学生明细-${tabLabels[tab]}`,
        headers: ['教师', '科组', '学生姓名', '状态', '槽位', '学生编号'],
        rows: studentRows,
        columnWidths: [18, 15, 18, 12, 8, 15],
        styles: {
          header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '4F46E5' }, alignment: { horizontal: 'center' } },
          body: { alignment: { horizontal: 'left' } },
        },
      });
    }
  }

  // 矩阵页
  const mentorMatrix = getMentorMatrix(reportId);
  if (mentorMatrix.cells.length > 0) {
    const matrixRows: (string | number | null)[][] = [];
    for (const cell of mentorMatrix.cells) {
      matrixRows.push([
        cell.teacherName,
        cell.managerName,
        cell.studentCount,
        cell.prepaidCount,
        cell.renewedCount,
        cell.prepaidRate !== null ? cell.prepaidRate.toFixed(1) + '%' : '—',
        cell.renewRate !== null ? cell.renewRate.toFixed(1) + '%' : '—',
      ]);
    }
    sheets.push({
      name: '矩阵-教师×学管',
      headers: ['教师', '学管', '学生数', '预存人数', '续费人数', '预存率', '续费率'],
      rows: matrixRows,
      columnWidths: [18, 18, 10, 12, 12, 12, 12],
      styles: {
        header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '059669' }, alignment: { horizontal: 'center' } },
        body: { alignment: { horizontal: 'center' } },
      },
    });
  }

  return sheets;
}

/**
 * 矩阵导出模板：三种矩阵完整导出
 */
export async function buildMatrixExport(reportId: number): Promise<ExportSheet[]> {
  const sheets: ExportSheet[] = [];

  // 教师×学管
  const mentorMatrix = getMentorMatrix(reportId);
  if (mentorMatrix.cells.length > 0) {
    const matrixRows: (string | number | null)[][] = [];
    for (const cell of mentorMatrix.cells) {
      matrixRows.push([
        cell.teacherName,
        cell.managerName,
        cell.studentCount,
        cell.prepaidCount,
        cell.renewedCount,
        cell.prepaidRate !== null ? cell.prepaidRate.toFixed(1) + '%' : '—',
        cell.renewRate !== null ? cell.renewRate.toFixed(1) + '%' : '—',
      ]);
    }
    sheets.push({
      name: '教师×学管',
      headers: ['教师', '学管', '学生数', '预存人数', '续费人数', '预存率', '续费率'],
      rows: matrixRows,
      columnWidths: [20, 20, 10, 12, 12, 12, 12],
      styles: {
        header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '059669' }, alignment: { horizontal: 'center' } },
        body: { alignment: { horizontal: 'center' } },
        conditional: [
          { type: 'colorScale', range: `F2:F${mentorMatrix.cells.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: '10B981', type: 'num', value: 100 } } },
          { type: 'colorScale', range: `G2:G${mentorMatrix.cells.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: '10B981', type: 'num', value: 100 } } },
        ],
      },
    });
  }

  // 教师×年级
  const gradeMatrix = getTeacherGradeMatrix(reportId);
  if (gradeMatrix.cells.length > 0) {
    const matrixRows: (string | number | null)[][] = [];
    for (const cell of gradeMatrix.cells) {
      matrixRows.push([
        cell.teacherName,
        cell.grade,
        cell.studentCount,
        cell.prepaidCount,
        cell.renewedCount,
        cell.prepaidRate !== null ? cell.prepaidRate.toFixed(1) + '%' : '—',
        cell.renewRate !== null ? cell.renewRate.toFixed(1) + '%' : '—',
      ]);
    }
    sheets.push({
      name: '教师×年级',
      headers: ['教师', '年级', '学生数', '预存人数', '续费人数', '预存率', '续费率'],
      rows: matrixRows,
      columnWidths: [20, 12, 10, 12, 12, 12, 12],
      styles: {
        header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '7C3AED' }, alignment: { horizontal: 'center' } },
        body: { alignment: { horizontal: 'center' } },
      },
    });
  }

  // 科组×年级
  const groupMatrix = getGroupGradeMatrix(reportId);
  if (groupMatrix.cells.length > 0) {
    const matrixRows: (string | number | null)[][] = [];
    for (const cell of groupMatrix.cells) {
      matrixRows.push([
        cell.subjectGroup,
        cell.grade,
        cell.studentCount,
        cell.prepaidCount,
        cell.renewedCount,
        cell.prepaidRate !== null ? cell.prepaidRate.toFixed(1) + '%' : '—',
        cell.renewRate !== null ? cell.renewRate.toFixed(1) + '%' : '—',
      ]);
    }
    sheets.push({
      name: '科组×年级',
      headers: ['科组', '年级', '学生数', '预存人数', '续费人数', '预存率', '续费率'],
      rows: matrixRows,
      columnWidths: [20, 12, 10, 12, 12, 12, 12],
      styles: {
        header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: 'EA580C' }, alignment: { horizontal: 'center' } },
        body: { alignment: { horizontal: 'center' } },
      },
    });
  }

  return sheets;
}

/**
 * 漏斗导出模板
 */
export async function buildFunnelExport(reportId: number): Promise<ExportSheet[]> {
  const sheets: ExportSheet[] = [];

  const funnelRows = getFunnel(reportId);
  sheets.push({
    name: '整体漏斗',
    headers: ['学管', '学生总数', '上2月课消', '上1月课消', '已续费', '续生率'],
    rows: funnelRows.map(r => [
      r.managerName,
      r.students,
      r.classedLast1,
      r.classedLast2,
      r.renewed,
      r.renewRate !== null ? r.renewRate.toFixed(1) + '%' : '—',
    ]),
    columnWidths: [15, 12, 12, 12, 12, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '0891B2' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
    },
  });

  // 学生状态分布
  const statusRows = getStudentStatusSummary(reportId);
  sheets.push({
    name: '学生状态分布',
    headers: ['状态', '人数'],
    rows: statusRows.map(r => [r.status, r.count]),
    columnWidths: [15, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '4F46E5' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
    },
  });

  return sheets;
}

/**
 * 风险学生导出模板
 */
export async function buildRiskExport(reportId: number): Promise<ExportSheet[]> {
  const sheets: ExportSheet[] = [];

  const riskPage = getRiskStudentsPage(reportId, 1, 10000); // Get all
  sheets.push({
    name: '风险学生清单',
    headers: ['学管', '学生编号', '学生姓名', '年级', '在读天数', '系数', '产品类型', '上月课消', '上上月课消'],
    rows: riskPage.rows.map(r => [
      r.managerName || '—',
      r.studentId || '—',
      r.studentName,
      r.grade || '—',
      r.enrollDays ?? '—',
      r.coef ?? '—',
      r.courseProduct || '—',
      r.classLast1 ?? '—',
      r.classLast2 ?? '—',
    ]),
    columnWidths: [15, 15, 18, 10, 12, 10, 15, 12, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: 'DC2626' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
      conditional: [
        { type: 'colorScale', range: `H2:H${riskPage.rows.length + 1}`, colorScale: { min: { color: 'FEE2E2', type: 'num', value: 0 }, max: { color: '22C55E', type: 'num', value: 100 } } },
        { type: 'colorScale', range: `I2:I${riskPage.rows.length + 1}`, colorScale: { min: { color: 'FEE2E2', type: 'num', value: 0 }, max: { color: '22C55E', type: 'num', value: 100 } } },
      ],
    },
  });

  return sheets;
}

/**
 * 多期对比导出模板
 */
export async function buildMultiPeriodExport(userId: number, centerName?: string, months?: string[]): Promise<ExportSheet[]> {
  const comparison = getMultiPeriodComparison({ userId, centerName, limit: months?.length || 12, months });
  const sheets: ExportSheet[] = [];

  sheets.push({
    name: '多期对比-概览',
    headers: ['统计月', '校区', '学生总数', '预存人数', '到期人数', '续费人数', '流失人数', '预存率', '到期率', '续费率', '流失率'],
    rows: comparison.periods.map(p => [
      p.statMonth,
      p.centerName,
      p.totalStudents,
      p.prepaidCount,
      p.expiredCount,
      p.renewedCount,
      p.lostCount,
      p.prepaidRate.toFixed(1) + '%',
      p.expiredRate.toFixed(1) + '%',
      p.renewedRate.toFixed(1) + '%',
      p.lostRate.toFixed(1) + '%',
    ]),
    columnWidths: [12, 15, 12, 12, 12, 12, 12, 12, 12, 12, 12],
    styles: {
      header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '4F46E5' }, alignment: { horizontal: 'center' } },
      body: { alignment: { horizontal: 'center' } },
      conditional: [
        { type: 'colorScale', range: `H2:H${comparison.periods.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: '10B981', type: 'num', value: 100 } } },
        { type: 'colorScale', range: `J2:J${comparison.periods.length + 1}`, colorScale: { min: { color: 'FEF3C7', type: 'num', value: 0 }, max: { color: '10B981', type: 'num', value: 100 } } },
      ],
    },
  });

  // 按学管多期
  if (comparison.periods.length > 0 && comparison.periods[0].byManager.length > 0) {
    const managers = comparison.periods[0].byManager.map(m => m.managerName);
    const headers = ['学管', ...comparison.periods.flatMap(p => [`${p.statMonth}-预存率`, `${p.statMonth}-续费率`])];
    const rows = managers.map(manager => {
      const row: (string | number)[] = [manager];
      for (const period of comparison.periods) {
        const m = period.byManager.find(x => x.managerName === manager);
        row.push(m?.prepaidRate !== undefined ? m.prepaidRate.toFixed(1) + '%' : '—', m?.renewRate !== undefined ? m.renewRate.toFixed(1) + '%' : '—');
      }
      return row;
    });
    sheets.push({
      name: '多期对比-按学管',
      headers,
      rows,
      columnWidths: [15, ...Array(comparison.periods.length * 2).fill(12)],
      styles: {
        header: { font: { bold: true, color: 'FFFFFF', size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: '7C3AED' }, alignment: { horizontal: 'center' } },
        body: { alignment: { horizontal: 'center' } },
      },
    });
  }

  return sheets;
}

/**
 * 主导出函数 - 根据模板生成导出数据
 */
export async function buildExport(options: ExportOptions): Promise<ExportSheet[]> {
  const { reportId, userId, template = 'standard' } = options;

  switch (template) {
    case 'standard':
      return buildStandardExport(reportId, userId);
    case 'detailed':
      return buildDetailedExport(reportId, userId);
    case 'matrix':
      return buildMatrixExport(reportId);
    case 'funnel':
      return buildFunnelExport(reportId);
    case 'risk':
      return buildRiskExport(reportId);
    case 'executive':
      // 高管视图：只包含概览、学管业绩、多期对比
      const standardSheets = await buildStandardExport(reportId, userId);
      const multiPeriodSheets = await buildMultiPeriodExport(userId);
      return [...standardSheets.slice(0, 2), ...standardSheets.slice(-2), ...multiPeriodSheets];
    default:
      return buildStandardExport(reportId, userId);
  }
}

export { getTeacherStats, getGroupComparison, getManagerPerf, getFunnel, getRiskStudentsPage, getStudentStatusSummary, getMentorMatrix, getTeacherGradeMatrix, getGroupGradeMatrix, getRateOverview, getMultiPeriodComparison, getAvailableStatMonths, getAvailableCenters, getCellDetail } from './analytics.js';
