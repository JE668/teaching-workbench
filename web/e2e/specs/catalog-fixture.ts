import ExcelJS from 'exceljs';

/**
 * 课程目录导入的 E2E 夹具。
 *
 * 版式刻意对齐真实模板（合并单元格 + 分区标题 + 填写指引行 + 教材版本纵向合并），
 * 因为「真实模板能解析」才是导入功能要证明的事；纯扁平表在单测里已经覆盖过了。
 *
 * 用 exceljs 在测试里现造，而不是往仓库里塞二进制 xlsx ——
 * 模板改一列，夹具跟着改一行就行，不会有过期的静态文件。
 */

export interface CatalogFixtureOptions {
  /** 第一个 sheet 名，形如「初二物理」—— 年级/学科都从这里取 */
  sheet: string;
  /** 分区学期，如「秋季」 */
  term: string;
  /** 课程清单：[序号, 辅导内容, 课程类型, 学习难度] */
  courses: [number, string, string, string][];
  /** 第二条分区（换学期）的课程 */
  secondTerm?: string;
  secondCourses?: [number, string, string, string][];
  /** 在第一条分区末尾插一行分节（阶测安排） */
  sectionLabel?: string;
  /** 教材版本原文（A 列纵向合并），默认人教版 */
  textbook?: string;
  filename?: string;
}

const setCell = (ws: ExcelJS.Worksheet, r: number, c: number, v: string) => {
  ws.getCell(r, c).value = v;
};

/** 写一个标准分区：标题行 + 填写指引行 + 两行表头，返回第一条数据行的行号 */
function writeSection(ws: ExcelJS.Worksheet, start: number, title: string): number {
  ws.mergeCells(start, 1, start, 6);
  setCell(ws, start, 1, title);

  // 填写指引行必须被跳过，不能当课程
  ws.mergeCells(start + 1, 1, start + 1, 6);
  setCell(ws, start + 1, 1, '【XX月课程规划】请写出本学期课程的整体安排……');

  const headerRow = start + 2;
  ws.mergeCells(headerRow, 1, headerRow + 1, 1);
  ws.mergeCells(headerRow, 2, headerRow + 1, 2);
  setCell(ws, headerRow, 1, '教材版本');
  setCell(ws, headerRow, 2, '序号');
  setCell(ws, headerRow, 3, '辅导内容');
  setCell(ws, headerRow, 4, '课程类型');
  setCell(ws, headerRow, 5, '学习难度');
  setCell(ws, headerRow, 6, '对后续课程影响程度');

  return headerRow + 2;
}

/** 从 start 行连续写 n 条课程，返回下一条空行的行号 */
function writeCourses(ws: ExcelJS.Worksheet, start: number, rows: [number, string, string, string][], textbook = '人教版（2024）'): number {
  const end = start + rows.length - 1;
  // 教材版本纵向合并，只有左上角有值（真实模板就是这样）
  ws.mergeCells(start, 1, end, 1);
  setCell(ws, start, 1, textbook);

  rows.forEach((r, i) => {
    const row = start + i;
    setCell(ws, row, 2, String(r[0]));
    setCell(ws, row, 3, r[1]);
    setCell(ws, row, 4, r[2]);
    setCell(ws, row, 5, r[3]);
    setCell(ws, row, 6, '★★★');
  });
  return start + rows.length;
}

export interface CatalogFixture {
  /** 用 Buffer（而不是裸 Uint8Array）—— Playwright 的 setInputFiles / page.request
   *  在 multipart 里都要 Node Buffer，喂 Uint8Array 会在 base64 编解码时报
   *  InvalidCharacterError / Unexpected buffer type */
  buffer: Buffer;
  filename: string;
  /** 期望解析出的课程标题，用于断言 */
  titles: string[];
}

export async function buildCatalogFixture(opts: CatalogFixtureOptions): Promise<CatalogFixture> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheet);
  const titles = opts.courses.map((c) => c[1]);

  const firstData = writeSection(ws, 1, `星火教育个性化  ${opts.sheet}  ${opts.term}  课程目录`);
  let next = writeCourses(ws, firstData, opts.courses, opts.textbook);

  if (opts.sectionLabel) {
    // 分节行（整行合并的阶测安排）插在数据中间 —— 必须被识别成分节而不是课程
    ws.mergeCells(next, 3, next, 6);
    setCell(ws, next, 2, String(opts.courses.length));
    setCell(ws, next, 3, opts.sectionLabel);
    next += 1;
  }

  if (opts.secondCourses && opts.secondTerm) {
    const d = writeSection(ws, next, `星火教育个性化  ${opts.sheet}  ${opts.secondTerm}  课程目录`);
    writeCourses(ws, d, opts.secondCourses, opts.textbook);
    titles.push(...opts.secondCourses.map((c) => c[1]));
  }

  // exceljs 的 writeBuffer 返回的 Uint8Array 可能带非零偏移，
  // 用带 offset/length 的 Buffer.from 拷一份，保证拿到的是完整字节
  const bytes = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    buffer,
    filename: opts.filename || opts.sheet + '课程目录.xlsx',
    titles,
  };
}
