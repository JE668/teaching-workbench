import ExcelJS from 'exceljs';

/**
 * 课程目录 → Excel（.xlsx），按当前筛选范围导出一份。
 *
 * 用途：老师要给家长 / 校区留一份「这学期到底上哪些课」的纸质或电子清单，
 * 之前只能整本 Excel 拖下来再自己删，现在筛完直接导出就是那份清单。
 *
 * 版式刻意做成**扁平可筛选**的：一行一门课，所有维度都是独立列，
 * 拿到手能直接在 Excel 里再排序、再分组、再打印。分节保留成整行合并的标题行，
 * 跟原表「第一次阶段性测试」那种分区行长得一样。
 */

/** 表头（跟月度总结模板的前几列对齐，方便两份文件放一起看） */
export const CATALOG_COLUMNS = [
  '年级',
  '学科',
  '学期',
  '轨',
  '序号',
  '分节',
  '课程内容',
  '课程类型',
  '期末考\n分值占比',
  '学习难度',
  '教材版本',
  '掌握星级',
] as const;

/** 列宽（按中文表头长度取，课程内容一列给最宽） */
export const CATALOG_COL_WIDTHS = [7, 7, 8, 9, 6, 15, 34, 9, 9, 11, 15, 9];

/** 配色：沿用月度总结模板的绿色标题 / 黄色表头 */
const GREEN = 'FFC3EAD5'; // 分节标题行
const YELLOW = 'FFFFEEAD'; // 表头
const BLACK = 'FF000000';

const FONT_NAME = '微软雅黑';
const BODY_SIZE = 10;
const HEADING_SIZE = 11;

const COLS = CATALOG_COLUMNS.length;
const HEADER_ROW = 1;
const TITLE_HEIGHT = 20;
const BODY_HEIGHT = 22;

/** 掌握星级 → 中文档位，跟前端文案保持一致 */
export const STAR_LABELS = {
  1: '了解即可',
  2: '了解为主',
  3: '常规掌握',
  4: '重点掌握',
  5: '熟练运用',
} as const;

export function starLabel(star: number | null | undefined): string {
  if (star == null || !Number.isInteger(star) || star < 1 || star > 5) return '';
  return STAR_LABELS[star as keyof typeof STAR_LABELS] || '';
}

export interface CatalogExcelCourse {
  grade: string;
  subject: string;
  term: string;
  track: string;
  seq: number;
  section: string;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  textbook: string;
  mastery_star: number | null;
}

export interface CatalogExcelInput {
  /** 清单标题，写进第一行 */
  title: string;
  courses: CatalogExcelCourse[];
}

/**
 * 文件名：筛选范围收敛到单一「年级+学科+学期」时用它当范围描述，
 * 否则说明这是筛选结果并带上门数，避免文件名假装是一个学期。
 */
export function buildCatalogFilename(input: CatalogExcelInput): string {
  const courses = input.courses;
  if (courses.length) {
    const grades = new Set(courses.map((c) => c.grade));
    const subjects = new Set(courses.map((c) => c.subject));
    const terms = new Set(courses.map((c) => c.term));
    if (grades.size === 1 && subjects.size === 1 && terms.size === 1) {
      const c = courses[0];
      return `课程目录 ${c.grade}${c.subject} ${c.term} 共${courses.length}课.xlsx`;
    }
  }
  return `课程目录 筛选结果 共${courses.length}课.xlsx`;
}

/** 写一张工作表：标题行 + 表头 + 分节标题行 + 课程明细 */
export async function buildCatalogXlsx(input: CatalogExcelInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '教学工作台';
  wb.created = new Date();

  const ws = wb.addWorksheet('课程目录');
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
  ws.columns = CATALOG_COL_WIDTHS.map((width) => ({ width }));

  // 第 1 行：清单标题
  ws.mergeCells(`A1:${colName(COLS)}1`);
  const titleCell = ws.getCell(`A1`);
  titleCell.value = input.title;
  titleCell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true, color: { argb: BLACK } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  ws.getRow(1).height = TITLE_HEIGHT;

  // 第 2 行：表头
  const header = ws.getRow(HEADER_ROW + 1);
  header.height = 30;
  CATALOG_COLUMNS.forEach((name, i) => {
    const cell = header.getCell(i + 1);
    cell.value = name;
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true, color: { argb: BLACK } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    cell.border = thinBorder();
  });

  let rowNo = HEADER_ROW + 2;
  let lastSection = '';
  for (const c of input.courses) {
    // 分节变了就插一行整行合并的分区标题（跟原表的「第一次阶段性测试」分区行同形）
    if (c.section && c.section !== lastSection) {
      lastSection = c.section;
      ws.mergeCells(`A${rowNo}:${colName(COLS)}${rowNo}`);
      const s = ws.getCell(`A${rowNo}`);
      s.value = c.section;
      s.font = { name: FONT_NAME, size: BODY_SIZE, bold: true, color: { argb: BLACK } };
      s.alignment = { horizontal: 'left', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      ws.getRow(rowNo).height = TITLE_HEIGHT;
      rowNo++;
    } else if (!c.section && lastSection) {
      lastSection = '';
    }

    const row = ws.getRow(rowNo);
    row.height = BODY_HEIGHT;
    const values = [
      c.grade,
      c.subject,
      c.term,
      c.track,
      c.seq,
      c.section,
      c.content,
      c.type,
      c.score,
      c.difficulty,
      c.textbook,
      starLabel(c.mastery_star),
    ];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: FONT_NAME, size: BODY_SIZE, color: { argb: BLACK } };
      cell.alignment = {
        horizontal: i === 0 || i === 1 || i === 2 || i === 3 || i === 4 || i === 11 ? 'center' : 'left',
        vertical: 'middle',
        wrapText: i === 6,
      };
      cell.border = thinBorder();
    });
    rowNo++;
  }

  // 打印设置：A4 横向、按宽度缩放到一页宽，直接打印不用再调
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1 };
  // 旧版 exceljs 的类型定义里没有 pageSetUpPr，这里跳过类型检查
  (ws.properties as any).pageSetUpPr = { fitToPage: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 1 → A, 27 → AA */
function colName(n: number): string {
  let s = '';
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

function thinBorder(): any {
  const side = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  return { top: side, bottom: side, left: side, right: side };
}
