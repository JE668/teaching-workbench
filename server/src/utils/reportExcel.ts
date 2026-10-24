import ExcelJS from 'exceljs';

/**
 * 月度总结与课程规划 → Excel（.xlsx），每个学生一份文件。
 *
 * 版式沿用「2026 年秋季学生月度总结和规划」模板，但去掉了「计划上课时间」列
 * （版面上不再需要课程日期），表头变成 10 列：
 *   第 1 块  {月}月总结：标题行 + 摘要 + 表头 + 课程明细
 *   第 2 块  {月}月规划：标题行 + 摘要 + 表头 + 课程明细 + 阶测行
 *   末尾      结尾祝福语
 * 颜色、字号、列宽、行高都按模板实测值取，改样式只需要改下面的常量。
 */

/** 表头（模板里第 11 列有「考试情况 / 学校考试情况」两种写法，这里统一成前者） */
export const REPORT_COLUMNS = [
  '序号',
  '课程内容',
  '课程类型',
  '期末考\n分值占比',
  '学习难度',
  '出勤',
  '笔记整理',
  '错题整理',
  '作业完成',
  '考试情况',
] as const;

/**
 * 列宽（模板实测）。去掉「计划上课时间」后把那 13 个字符宽补给课程内容，
 * 总宽保持 ~128，摘要行的换行高度估算（estimateWrapHeight）才不用跟着改。
 */
export const REPORT_COL_WIDTHS = [4.4, 44.6, 9.3, 9.7, 13.8, 7.8, 9.7, 9.9, 9.7, 9.7];

/** 模板配色 */
const GREEN = 'FFC3EAD5'; // 标题行、序号表头
const YELLOW = 'FFFFEEAD'; // 其余表头
const PURPLE = 'FFFDEBFF'; // 摘要
const MINT = 'FFEAFAF1'; // 结尾祝福语
const EXAM_FILL = 'FFF3E8FF'; // 阶测行（模板用主题色 8，取接近的浅紫）
const EXAM_FONT = 'FFFF0000';
const BLACK = 'FF000000';

const FONT_NAME = '微软雅黑';
const BODY_SIZE = 10;
const HEADING_SIZE = 12;

export const REPORT_HEIGHTS = { title: 18, header: 33, body: 23, exam: 26 } as const;

const COLS = REPORT_COLUMNS.length;

export interface ReportExcelItem {
  content: string;
  type?: string;
  score?: string;
  difficulty?: string;
  /** 只有阶测用它（课程不再有日期列），导出时拼回阶测文案末尾 */
  scheduledAt?: string;
  attendance?: string;
  notesDone?: string;
  mistakesDone?: string;
  homeworkDone?: string;
  exam?: string;
}

export interface ReportExcelInput {
  studentName: string;
  /** 学期，如「秋季」「暑假」「一轮复习」 */
  term?: string;
  grade?: string;
  subject?: string;
  /** 总结块月份标题，如「9月」 */
  summaryMonth?: string;
  /** 规划块月份标题，如「10月」 */
  planMonth?: string;
  /** 机构名，出现在标题行开头 */
  orgName?: string;
  /** 报告所属年月 'YYYY-MM'，给阶测文案里只有「10月7日」的日期补年份 */
  yearMonth?: string;
  /** 两个区块的独立开关，关掉就不出现在导出里（默认都开） */
  summaryEnabled?: boolean;
  planEnabled?: boolean;
  summaryIntro?: string;
  planIntro?: string;
  farewell?: string;
  summaryItems?: ReportExcelItem[];
  planItems?: ReportExcelItem[];
  /** 阶测安排，排在规划课程之后 */
  examItems?: ReportExcelItem[];
}

/* exceljs 的 Style/Font/Alignment 都是全字段必填，这里统一用局部类型 + 一次断言 */
type PStyle = {
  numFmt?: string;
  font?: Partial<ExcelJS.Font>;
  alignment?: Partial<ExcelJS.Alignment>;
  border?: Partial<ExcelJS.Borders>;
  fill?: ExcelJS.Fill;
};

const THIN = { style: 'thin' as const, color: { argb: BLACK } };

function thinBorders(): Partial<ExcelJS.Borders> {
  return { top: THIN, bottom: THIN, left: THIN, right: THIN };
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** 明确「无填充」。不能传 `{}`——exceljs 的样式去重会把空对象撞到上一个 solid fill 上 */
const NO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'none', fgColor: { argb: 'FFFFFFFF' } };

type RowCell = ReturnType<ExcelJS.Row['getCell']>;

function applyStyle(cell: RowCell, style: PStyle): void {
  cell.style = {
    numFmt: style.numFmt ?? 'General',
    font: style.font ?? {},
    alignment: style.alignment ?? {},
    protection: {},
    border: style.border ?? thinBorders(),
    fill: style.fill ?? NO_FILL,
  };
}

/** 整行铺样式（10 列全部） */
function paintRow(row: ExcelJS.Row, style: PStyle, height?: number): void {
  if (height !== undefined) row.height = height;
  for (let c = 1; c <= COLS; c++) {
    const cell = row.getCell(c);
    if (cell.value === undefined) cell.value = '';
    applyStyle(cell, style);
  }
}

/** 标题行 / 阶测行 / 祝福语：11 列合并成一格 */
function mergedBand(ws: ExcelJS.Worksheet, row: ExcelJS.Row, text: string, style: PStyle, height: number): void {
  paintRow(row, style, height);
  ws.getCell(row.number, 1).value = text;
  ws.mergeCells(row.number, 1, row.number, COLS);
}

/** 表头：序号列绿底加粗，其余列浅黄，表头文字自动换行 */
function writeHeader(ws: ExcelJS.Worksheet, row: ExcelJS.Row): void {
  paintRow(row, {
    font: { name: FONT_NAME, size: BODY_SIZE },
    fill: solidFill(YELLOW),
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  }, REPORT_HEIGHTS.header);
  REPORT_COLUMNS.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    applyStyle(cell, {
      font: { name: FONT_NAME, size: BODY_SIZE, bold: i === 0 },
      fill: solidFill(i === 0 ? GREEN : YELLOW),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });
  });
}

/** 摘要行：左对齐顶格、自动换行 */
function writeIntro(ws: ExcelJS.Worksheet, row: ExcelJS.Row, text: string): void {
  const trimmed = (text || '').trim();
  paintRow(row, {
    font: { name: FONT_NAME, size: BODY_SIZE },
    fill: solidFill(PURPLE),
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  }, trimmed ? estimateWrapHeight(trimmed) : 24);
  ws.getCell(row.number, 1).value = trimmed;
  ws.mergeCells(row.number, 1, row.number, COLS);
}

/** 摘要 / 祝福语行高估算：10 列合并宽度约 128 个字符宽，字号 10 时一行约能放 60 个全角字 */
export function estimateWrapHeight(text: string): number {
  let lines = 0;
  for (const para of text.split('\n')) {
    const len = [...para].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55), 0);
    lines += Math.max(1, Math.ceil(len / 60));
  }
  return Math.min(420, 21 * lines + 14);
}

/** 课程明细行。withDetails=false 时清空出勤~考试情况那 5 列（规划块模板里是空的） */
function writeCourse(ws: ExcelJS.Worksheet, row: ExcelJS.Row, seq: number, item: ReportExcelItem, withDetails: boolean): void {
  paintRow(row, {
    font: { name: FONT_NAME, size: BODY_SIZE },
    alignment: { horizontal: 'center', vertical: 'middle' },
  }, REPORT_HEIGHTS.body);
  const values = [
    seq,
    item.content ?? '',
    item.type ?? '',
    item.score ?? '',
    item.difficulty ?? '',
    withDetails ? item.attendance ?? '' : '',
    withDetails ? item.notesDone ?? '' : '',
    withDetails ? item.mistakesDone ?? '' : '',
    withDetails ? item.homeworkDone ?? '' : '',
    withDetails ? item.exam ?? '' : '',
  ];
  values.forEach((v, i) => {
    ws.getCell(row.number, i + 1).value = v;
  });
}

/** 阶测行：浅紫底红字加粗，整行合并 */
function writeExamRow(ws: ExcelJS.Worksheet, row: ExcelJS.Row, text: string): void {
  mergedBand(ws, row, text, {
    font: { name: FONT_NAME, size: HEADING_SIZE, bold: true, color: { argb: EXAM_FONT } },
    fill: solidFill(EXAM_FILL),
    alignment: { horizontal: 'center', vertical: 'middle' },
  }, REPORT_HEIGHTS.exam);
}

/** '2026-10-07' → '10月7日'；空值返回空串 */
export function formatDay(iso: string | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : '';
}

/**
 * 阶测行的导出文案。
 *
 * 页面上阶测的日期是单独一个日期框，表里又没有日期列，所以导出时把它拼回文案末尾，
 * 免得老师填的时间在 Excel 里凭空消失；文案里已经写了日期就不重复拼。
 */
export function examText(item: ReportExcelItem): string {
  const base = (item.content || '').trim();
  const day = formatDay(item.scheduledAt);
  if (!day || /\d{1,2}\s*月\s*\d{1,2}/.test(base)) return base;
  return base ? `${base}（${day}）` : day;
}

/**
 * 规划块的渲染顺序：课程按老师写入的顺序排，阶测统一排在课程之后。
 *
 * 「计划上课时间」列下线之后课程没有日期，阶测没法再按日期插进课程中间，
 * 就老实接在最后——老师扫一眼就知道「课都排完了，最后还有一次阶测」。
 * 阶测自己的日期写在文案里（「时间10月7日」），不单独占一列。
 */
export function mergePlanSequence(
  courses: ReportExcelItem[],
  exams: ReportExcelItem[]
): { kind: 'course' | 'exam'; item: ReportExcelItem }[] {
  return [
    ...courses.map((item) => ({ kind: 'course' as const, item })),
    ...exams.map((item) => ({ kind: 'exam' as const, item })),
  ];
}

function sectionTitle(input: ReportExcelInput, kind: 'summary' | 'plan'): string {
  const parts = [input.orgName, input.studentName].filter(Boolean);
  const core = [input.term, input.grade, input.subject].filter(Boolean).join('');
  if (core) parts.push(core);
  const month = (kind === 'summary' ? input.summaryMonth : input.planMonth) ?? '';
  parts.push(`${month}${kind === 'summary' ? '总结' : '规划'}`);
  return parts.join(' ');
}

/**
 * 文件名：`一可 秋季初二物理 9月总结与10月规划.xlsx`
 * 总结月和规划月语义不同（总结讲本月、规划讲下月），两个都写进名字不会歧义。
 */
export function buildReportFilename(input: ReportExcelInput): string {
  const core = [input.term, input.grade, input.subject].filter(Boolean).join('');
  const parts = [input.studentName, core].filter(Boolean);
  const sm = input.summaryMonth ?? '';
  const pm = input.planMonth ?? '';
  const tail = sm && pm
    ? `${sm}总结与${pm}规划.xlsx`
    : sm
      ? `${sm}总结.xlsx`
      : pm
        ? `${pm}规划.xlsx`
        : '总结与规划.xlsx';
  parts.push(tail);
  return parts.join(' ');
}

/** 按序生成工作簿二进制 */
export async function buildReportXlsx(input: ReportExcelInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = input.studentName || '教学工作台';
  const ws = wb.addWorksheet((input.studentName || '月度报告').slice(0, 28), {
    properties: { defaultRowHeight: REPORT_HEIGHTS.body },
  });
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  ws.views = [{ showGridLines: false }];
  REPORT_COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const titleStyle: PStyle = {
    font: { name: FONT_NAME, size: HEADING_SIZE, bold: true },
    fill: solidFill(GREEN),
    alignment: { horizontal: 'center', vertical: 'middle' },
  };

  // —— 总结块 ——
  if (input.summaryEnabled !== false) {
    mergedBand(ws, ws.addRow([]), sectionTitle(input, 'summary'), titleStyle, REPORT_HEIGHTS.title);
    writeIntro(ws, ws.addRow([]), input.summaryIntro ?? '');
    writeHeader(ws, ws.addRow([]));
    const summaryHeaderRow = ws.rowCount;
    for (const [i, item] of (input.summaryItems || []).entries()) {
      writeCourse(ws, ws.addRow([]), i + 1, item, true);
    }
    applyScoreMerges(ws, summaryHeaderRow, ws.rowCount, []);
  }

  // —— 规划块 ——
  if (input.planEnabled !== false) {
    mergedBand(ws, ws.addRow([]), sectionTitle(input, 'plan'), titleStyle, 16);
    writeIntro(ws, ws.addRow([]), input.planIntro ?? '');
    writeHeader(ws, ws.addRow([]));
    const planHeaderRow = ws.rowCount;
    const examRows: number[] = [];
    let seq = 0;
    const exams = input.examItems || [];
    for (const entry of mergePlanSequence(input.planItems || [], exams)) {
      const row = ws.addRow([]);
      if (entry.kind === 'exam') {
        writeExamRow(ws, row, examText(entry.item));
        examRows.push(row.number);
      } else {
        seq++;
        writeCourse(ws, row, seq, entry.item, false);
      }
    }
    applyScoreMerges(ws, planHeaderRow, ws.rowCount, examRows);
  }

  // —— 结尾祝福语 ——
  const farewell = (input.farewell || '').trim();
  if (farewell) {
    const row = ws.addRow([]);
    mergedBand(ws, row, farewell, {
      font: { name: FONT_NAME, size: BODY_SIZE },
      fill: solidFill(MINT),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }, Math.max(30, estimateWrapHeight(farewell)));
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * 「期末考分值占比」竖向合并：同一个分值连着几节课就合成一格
 * （对齐模板 D4:D6 / D14:D17 的写法）。只在 headerRow 之后、sectionEnd 之前这段范围内做，
 * 跳过节次表头和阶测整行。
 */
function applyScoreMerges(ws: ExcelJS.Worksheet, headerRow: number, sectionEnd: number, skipRows: number[]): void {
  const skip = new Set(skipRows);
  let groupStart = -1;
  /** endExclusive = 分组的最后一行的下一行 */
  const flush = (endExclusive: number) => {
    if (groupStart > 0 && endExclusive - 1 >= groupStart) {
      ws.mergeCells(groupStart, 4, endExclusive - 1, 4);
    }
    groupStart = -1;
  };

  for (let r = headerRow + 1; r <= sectionEnd; r++) {
    if (skip.has(r)) {
      flush(r);
      continue;
    }
    const val = ws.getRow(r).getCell(4).value;
    const has = typeof val === 'string' ? val.trim().length > 0 : !!val;
    if (has) {
      flush(r);
      groupStart = r;
    }
    // 分值列空 → 延续上一格开始的分组
  }
  flush(sectionEnd + 1);
}
