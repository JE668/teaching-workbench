import ExcelJS from 'exceljs';

/**
 * BI 看板 → Excel（.xlsx）导出。
 *
 * 设计原则：**扁平可筛选**。一行一个数据点，所有维度都是独立列，
 * 拿到手能直接在 Excel 里再排序、再分组、再打印，避免「合并单元格 + 小标题」那种
 * 人好看但机器没法处理的版式。
 *
 * 每种导出类型对应 BI 看板的一个 tab：续科率（老师/科组）、续生率（学管）、
 * 预存（校区）、激励差额（mentor/科组/年级）、月度总览。
 */

const GREEN = 'FFC3EAD5'; // 标题行
const YELLOW = 'FFFFEEAD'; // 表头
const BLACK = 'FF000000';
const FONT_NAME = '微软雅黑';
const BODY_SIZE = 10;
const HEADING_SIZE = 11;
const TITLE_HEIGHT = 20;
const BODY_HEIGHT = 22;

function thinBorder(): ExcelJS.Borders {
  const side = { style: 'thin' as const, color: { argb: 'FF999999' } };
  return { top: side, bottom: side, left: side, right: side } as ExcelJS.Borders;
}

function colName(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface BiExcelInput {
  title: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  colWidths?: number[];
  filename: string;
}

/** 通用 xlsx 生成：标题行 + 表头 + 明细 */
export async function buildBiXlsx(input: BiExcelInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '教学工作台';
  wb.created = new Date();

  const ws = wb.addWorksheet('BI 报表');
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = (input.colWidths ?? input.headers.map(() => 14)).map((w) => ({ width: w }));

  // 第 1 行：标题
  const COLS = input.headers.length;
  ws.mergeCells('A1:' + colName(COLS) + '1');
  const titleCell = ws.getCell('A1');
  titleCell.value = input.title;
  titleCell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true, color: { argb: BLACK } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  ws.getRow(1).height = TITLE_HEIGHT;

  // 第 2 行：表头
  const header = ws.getRow(2);
  header.height = 30;
  input.headers.forEach((name, i) => {
    const cell = header.getCell(i + 1);
    cell.value = name;
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true, color: { argb: BLACK } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    cell.border = thinBorder();
  });

  // 第 3 行起：明细
  let rowNo = 3;
  for (const r of input.rows) {
    const row = ws.getRow(rowNo);
    row.height = BODY_HEIGHT;
    r.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: FONT_NAME, size: BODY_SIZE, color: { argb: BLACK } };
      cell.alignment = { horizontal: typeof v === 'number' ? 'right' : 'left', vertical: 'middle' };
      cell.border = thinBorder();
    });
    rowNo++;
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1 };
  (ws.properties as ExcelJS.WorksheetProperties & { pageSetUpPr?: { fitToPage?: boolean } }).pageSetUpPr = { fitToPage: true };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ==== 每种导出类型的表头 + 行转换 ====

export interface XukeRateRow {
  teacher_no: string;
  teacher_name: string;
  subject_group: string | null;
  base_count: number;
  renewed_count: number;
  rate: number;  // 0-100
}

export function xukeRowsToBi(input: { title: string; rows: XukeRateRow[]; groupBy: string }): BiExcelInput {
  const byGroup = input.groupBy === 'subject_group';
  return {
    title: input.title,
    filename: '续科率 ' + (byGroup ? '科组' : '老师') + ' ' + new Date().toISOString().slice(0, 10) + '.xlsx',
    headers: byGroup ? ['科组', '基数', '续科数', '续科率'] : ['老师', '基数', '续科数', '续科率'],
    rows: input.rows.map((r) => [
      byGroup ? (r.subject_group ?? '') : r.teacher_name,
      r.base_count,
      r.renewed_count,
      r.rate.toFixed(1) + '%',
    ]),
    colWidths: [20, 10, 10, 12],
  };
}

export interface XushengRateRow {
  mentor_name: string;
  base_count: number;
  renewed_count: number;
  rate: number;  // 0-100
}

export function xushengRowsToBi(input: { title: string; rows: XushengRateRow[] }): BiExcelInput {
  return {
    title: input.title,
    filename: '续生率 学管 ' + new Date().toISOString().slice(0, 10) + '.xlsx',
    headers: ['学管师', '基数', '续生数', '续生率'],
    rows: input.rows.map((r) => [r.mentor_name, r.base_count, r.renewed_count, r.rate.toFixed(1) + '%']),
    colWidths: [16, 10, 10, 12],
  };
}

export interface PreSaleRow {
  branch_company: string;
  learning_center: string;
  valid_voucher_count: number;
  presale_student_count: number;
  total_amount: number;
}

export function presaleRowsToBi(input: { title: string; rows: PreSaleRow[] }): BiExcelInput {
  return {
    title: input.title,
    filename: '预存 校区 ' + new Date().toISOString().slice(0, 10) + '.xlsx',
    headers: ['分公司', '校区', '有效券数', '预存学生数', '总金额（元）'],
    rows: input.rows.map((r) => [
      r.branch_company,
      r.learning_center,
      r.valid_voucher_count,
      r.presale_student_count,
      r.total_amount,
    ]),
    colWidths: [16, 24, 12, 14, 14],
  };
}

export interface IncentiveRow {
  scope: string;
  scope_value: string;
  target_rate: number;  // 0-100
  base_count: number;
  target_count: number;
  renewed_count: number;
  gap: number;
}

const SCOPE_LABEL: Record<string, string> = {
  mentor: '学管师',
  subject_group: '科组',
  grade_stage: '年级段',
  branch: '分公司',
  learning_center: '学习中心',
};

export function incentiveRowsToBi(input: { title: string; rows: IncentiveRow[] }): BiExcelInput {
  return {
    title: input.title,
    filename: '激励差额 ' + new Date().toISOString().slice(0, 10) + '.xlsx',
    headers: ['维度', '对象', '目标比例', '基数', '目标数', '已完成', '差额'],
    rows: input.rows.map((r) => [
      SCOPE_LABEL[r.scope] ?? r.scope,
      r.scope_value,
      r.target_rate.toFixed(0) + '%',
      r.base_count,
      r.target_count,
      r.renewed_count,
      r.gap,
    ]),
    colWidths: [12, 16, 10, 10, 10, 10, 10],
  };
}

export interface MonthlyReport {
  month: string | null;
  xuke: { total_base: number; total_renewed: number; overall_rate: number; teacher_count: number };
  xusheng: { total_base: number; total_renewed: number; overall_rate: number; mentor_count: number };
  presale: { total_vouchers: number; total_students: number; total_amount: number; learning_center_count: number };
  incentive: { entries: number; total_gap: number };
}

export function monthlyReportToBi(report: MonthlyReport): BiExcelInput {
  return {
    title: 'BI 月度总览' + (report.month ? '（' + report.month + '）' : ''),
    filename: 'BI 月度总览 ' + (report.month ?? '最新') + '.xlsx',
    headers: ['指标', '基数', '完成', '比例', '备注'],
    rows: [
      ['续科率', report.xuke.total_base, report.xuke.total_renewed, report.xuke.overall_rate.toFixed(1) + '%', report.xuke.teacher_count + ' 位老师'],
      ['续生率', report.xusheng.total_base, report.xusheng.total_renewed, report.xusheng.overall_rate.toFixed(1) + '%', report.xusheng.mentor_count + ' 位学管师'],
      ['预存', '-', report.presale.total_students, '-', report.presale.total_vouchers + ' 张有效券 / ' + report.presale.total_amount + ' 元 / ' + report.presale.learning_center_count + ' 个校区'],
      ['激励差额', '-', report.incentive.entries, '-', '总差额 ' + report.incentive.total_gap],
    ],
    colWidths: [12, 10, 10, 12, 40],
  };
}
