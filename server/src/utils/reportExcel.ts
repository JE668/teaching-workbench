import ExcelJS from 'exceljs';

/**
 * 月度总结与课程规划 → Excel（.xlsx），每个学生一份文件。
 *
 * 版式 1:1 对齐「2026 年秋季学生月度总结和规划」模板：
 *   第 1 块  {月}月总结：标题行 + 摘要 + 表头 + 课程明细（11 列）
 *   第 2 块  {月}月规划：标题行 + 摘要 + 表头 + 课程明细（阶测行按日期插进课程中间）
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
  '计划上课时间',
  '出勤',
  '笔记整理',
  '错题整理',
  '作业完成',
  '考试情况',
] as const;

/** 列宽（模板实测；第 11 列模板未单独给，取末列量级） */
export const REPORT_COL_WIDTHS = [4.4, 31.6, 9.3, 9.7, 13.8, 13.0, 7.8, 9.7, 9.9, 9.7];

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
  /** 阶测安排，按 scheduledAt 插进规划课程之间 */
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

/** 整行铺样式（11 列全部） */
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

/** 摘要 / 祝福语行高估算：11 列合并宽度约 128 个字符宽，字号 10 时一行约能放 60 个全角字 */
export function estimateWrapHeight(text: string): number {
  let lines = 0;
  for (const para of text.split('\n')) {
    const len = [...para].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55), 0);
    lines += Math.max(1, Math.ceil(len / 60));
  }
  return Math.min(420, 21 * lines + 14);
}

/**
 * 从阶测文案里抠出日期，用来把它排进规划课程的正确位置。
 * 模板里阶测的日期只写在文案中，例如「秋季度第一次阶测安排：时间10月7日」，
 * 没有结构化字段；拿不到就用 yearMonth 补年份。
 */
export function parseExamDate(text: string | undefined, yearMonth: string | undefined): string | undefined {
  const s = String(text || '');
  const ym = String(yearMonth || '');
  const year = /^\d{4}-\d{2}$/.test(ym) ? ym.slice(0, 4) : String(new Date().getFullYear());
  const md = s.match(/(\d{1,2})\s*[月/.]\s*(\d{1,2})/);
  if (!md) return undefined;
  const m = Number(md[1]);
  const d = Number(md[2]);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : undefined;
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
    formatDay(item.scheduledAt),
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

/** '2026-10-07' → '10月7日'；不认识的格式原样返回 */
export function formatDay(iso: string | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : String(iso || '');
}

function dayKey(iso: string | undefined): number {
  const t = Date.parse(String(iso || '').slice(0, 10));
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * 把规划课程与阶测按上课日期合成一条渲染序列。
 * 阶测插在「日期不早于它的第一节课」之前，对齐模板里
 * 「10 月 7 日阶测排在 10 月 3 日课程之后、10 月 18 日课程之前」的写法。
 */
export function mergePlanSequence(
  courses: ReportExcelItem[],
  exams: ReportExcelItem[]
): { kind: 'course' | 'exam'; item: ReportExcelItem }[] {
  const byDate = (a: ReportExcelItem, b: ReportExcelItem) => dayKey(a.scheduledAt) - dayKey(b.scheduledAt);
  const cs = [...courses].sort(byDate);
  const es = [...exams].sort(byDate);

  const out: { kind: 'course' | 'exam'; item: ReportExcelItem }[] = [];
  let ei = 0;
  for (const course of cs) {
    while (ei < es.length && dayKey(es[ei].scheduledAt) < dayKey(course.scheduledAt)) {
      out.push({ kind: 'exam', item: es[ei++] });
    }
    out.push({ kind: 'course', item: course });
  }
  while (ei < es.length) out.push({ kind: 'exam', item: es[ei++] });
  return out;
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
  ws.getColumn(COLS).width = REPORT_COL_WIDTHS[REPORT_COL_WIDTHS.length - 1];

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
    const exams = (input.examItems || []).map((e) => ({
      ...e,
      scheduledAt: e.scheduledAt || parseExamDate(e.content, input.yearMonth),
    }));
    for (const entry of mergePlanSequence(input.planItems || [], exams)) {
      const row = ws.addRow([]);
      if (entry.kind === 'exam') {
        writeExamRow(ws, row, entry.item.content ?? '');
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
