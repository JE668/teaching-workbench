import type ExcelJS from 'exceljs';

/**
 * 全年课程体系目录解析器。
 *
 * 输入是老师手维护的 Excel（高中 / 小初各一份，一个 sheet = 一个「年级+学科」）。
 * 表是人工维护的，列布局**不统一**，实测有 6 种：
 *
 *   - 单轨无分值：教材版本|序号|辅导内容|课程类型|学习难度|对后续课程影响程度
 *   - 单轨带分值：教材版本|序号|辅导内容|课程类型|期末考分值占比|学习难度
 *   - 单轨高考/中考分值：…|高考分值占比|… / …|中考分值占比|…
 *   - 双轨分值型：教材版本|序号|【基础进阶】内容|课程类型|分值占比|难度|【拓展拔尖】内容|课程类型|分值占比|难度
 *   - 双轨影响型：教材版本|序号|基础课程内容|课程类型|难度|影响程度|进阶课程内容|课程类型|难度|影响程度
 *   - 双轨辅导版：教材版本|序号|辅导内容（基础版）|…|辅导内容（进阶版）|…
 *
 * 所以**列号不能写死**：靠表头文字识别列语义，再按「内容列」把后续列归成轨。
 *
 * 其他坑（全部踩过）：
 *  - 每个分区都重复一遍两行表头，表头文字会漏进数据里
 *   - 合并单元格在 exceljs 里会自动把左上角的值填充到整个区，不用自己向下填充
 *   - 教材版本在 A 列纵向合并 20+ 行，只有左上角有值
 *   - **分节行（阶测位置）在双轨 sheet 里常常只覆盖其中一轨**，
 *     另一轨同一行还有正常课程 —— 所以分节状态必须按轨独立维护
 *   - 有的分节行把分节名也写进了序号列，所以判断数据行的依据是「序号必须是数字」
 */

export type Band = '高中' | '小初';

export interface ParsedCourse {
  band: Band;
  /** 学期：暑假/秋季/寒假/春季；高三用 一轮复习/二轮复习/三轮复习 */
  term: string;
  grade: string;
  subject: string;
  /** 轨：基础 / 进阶 / 拓展拔尖；单轨为空 */
  track: string;
  /** 原表序号 */
  seq: number;
  /** 辅导内容 */
  content: string;
  /** 课程类型：专题/同步/预习/复习/一轮复习/二轮复习/复习+预习/复习衔接 */
  type: string;
  /** 期末考/高考/中考分值占比，原样保留（"3-5"、"10-15分"、"5~10"） */
  score: string;
  /** 学习难度，★ 数量 */
  difficulty: string;
  /** 对后续课程影响程度，★ 数量 */
  impact: string;
  /** 归一化后的教材版本 */
  textbook: string;
  /** 所属分节（第一次阶段性测试 / 期中阶测 / 一轮复习 …），无则为空 */
  section: string;
  /** 原表 sheet 名 */
  sheet: string;
  /** 原表行号，便于追溯 */
  sourceRow: number;
}

export interface ParsedSheetSummary {
  sheet: string;
  grade: string;
  subject: string;
  columnCount: number;
  rowCount: number;
  trackCount: number;
  courses: number;
  error?: string;
}

export interface ParseResult {
  band: Band;
  courses: ParsedCourse[];
  sheets: ParsedSheetSummary[];
  /** 解析不出的 sheet 名 */
  failedSheets: string[];
}

// ============ 教材版本归一化 ============

const PUBLISHER_ALIAS: Record<string, string> = {
  '人教pep版': '人教版',
  '人教PEP版': '人教版',
  '人教pep': '人教版',
  '人教PEP': '人教版',
};

/** "人教版（2024）" / "2024年人教版" / "人教pep版" / "人教版（2017版）" → "人教版" */
export function normalizeTextbook(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (PUBLISHER_ALIAS[s]) s = PUBLISHER_ALIAS[s];
  // 括号里只有年份 / 版 / 空白 → 整段是年份标注，连括号一起去掉
  // （注意不能连「（基础版）」这种轨标注一起删，所以字符集里不放汉字字母）
  s = s.replace(/[（(][\s\d年版]*[)）]/g, '');
  s = s.replace(/\d{4}\s*年?/g, '');
  s = s.replace(/\s+/g, '');
  return s;
}

// ============ 轨名归一化 ============

/**
 * 轨名列头写法很多：【基础进阶】内容 / 基础课程内容 / 辅导内容（基础版）。
 * 判断顺序很讲究：先「拓展拔尖」，再「基础」，再「进阶」，
 * 因为【基础进阶】同时含「基础」和「进阶」两个字，先判「基础」才归得对。
 */
export function trackLabel(header: string, index: number, isDual: boolean): string {
  const h = String(header || '').replace(/\s+/g, '');
  if (h.includes('拓展') || h.includes('拔尖')) return '拓展拔尖';
  if (h.includes('基础')) return '基础';
  if (h.includes('进阶')) return '进阶';
  return isDual ? (index === 0 ? '基础' : '进阶') : '';
}

// ============ 单元格读取 ============

/** exceljs 的单元格值形态很杂：string / number / richText / hyperlink / formula / error */
function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = ws.getCell(row, col).value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: string }).text);
    if ('result' in v) return String((v as { result: unknown }).result);
    if ('error' in v) return '';
    return String(v);
  }
  return String(v);
}

interface MergeModel {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** exceljs 把合并区存在内部属性上，公开 API 没有对应的读取方法 */
function mergeModels(ws: ExcelJS.Worksheet): MergeModel[] {
  const raw = (ws as unknown as { _merges?: Record<string, { model: MergeModel }> })._merges;
  if (!raw) return [];
  return Object.values(raw).map((v) => v.model).filter(Boolean);
}

/** A 列起整行合并的跨度；不是这类行返回 0 */
function rowAMergeSpan(ws: ExcelJS.Worksheet, row: number): number {
  for (const m of mergeModels(ws)) {
    if (m.top !== row || m.bottom !== row || m.left !== 1) continue;
    return m.right - m.left + 1;
  }
  return 0;
}

/** 单元格 (row,col) 所在合并区的横向跨度；未合并返回 1 */
function hSpanOf(ws: ExcelJS.Worksheet, row: number, col: number): number {
  for (const m of mergeModels(ws)) {
    if (m.top !== row || m.bottom !== row) continue;
    if (col >= m.left && col <= m.right) return m.right - m.left + 1;
  }
  return 1;
}

// ============ 学期 / 年级 / 学科 ============

/**
 * 学期写法不统一：普通年级用季节，高三用复习轮次。
 * 高三原表里出现过「一轮复习」「一轮 复习」「一轮」三种写法。
 */
export function extractTerm(title: string): string {
  const season = title.match(/(暑假|秋季|寒假|春季)/);
  if (season) return season[1];
  // 注意：整段「复习」都要可选，写成 复习? 只让「习」可选、「复」仍必需，
  // 于是「生物一轮  课程目录」这种写法就匹配不上了
  const round = title.match(/([一二三])\s*轮(?:\s*复习)?/);
  if (round) return round[1] + '轮复习';
  return '';
}

function gradeOf(sheetName: string): string {
  const m = sheetName.match(/([一二三四五六]年级|高一|高二|高三|初一|初二|初三|小[一二三四五六])/);
  return m ? m[1] : sheetName;
}

function subjectOf(sheetName: string): string {
  const m = sheetName.match(/(语文|数学|英语|物理|化学|生物|地理|生地)/);
  return m ? m[1] : '';
}

/** 「星火教育个性化」开头的整行合并行 = 分区标题 */
function isSectionTitleRow(aText: string, span: number): boolean {
  return span >= 3 && aText.trim().startsWith('星火教育个性化');
}

/** 【XX月课程规划】…【XX月学情总结】… 的填写指引行 */
function isInstructionRow(aText: string, span: number): boolean {
  return span >= 3 && (aText.includes('课程规划') || aText.includes('学情总结'));
}

// ============ 列语义 ============

type ColKind = 'content' | 'type' | 'score' | 'difficulty' | 'impact' | 'textbook' | 'seq' | null;

const COL_RULES: Array<[string, Exclude<ColKind, null>]> = [
  ['内容', 'content'],
  ['课程类型', 'type'],
  ['分值占比', 'score'],
  ['难度', 'difficulty'],
  ['影响程度', 'impact'],
  ['教材版本', 'textbook'],
  ['序号', 'seq'],
];

function classifyColumn(header: string): ColKind {
  const h = String(header || '').replace(/\s+/g, '');
  for (const [kw, kind] of COL_RULES) if (h.includes(kw)) return kind;
  return null;
}

interface Track {
  /** 该轨「内容」列的列号 */
  contentCol: number;
  label: string;
  fields: Partial<Record<Exclude<ColKind, null>, number>>;
}

/** 定位表头行：A 列是「教材版本」且 B 列是「序号」 */
function findHeaderRow(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    if (cellText(ws, r, 1).includes('教材版本') && cellText(ws, r, 2).includes('序号')) return r;
  }
  return 0;
}

/** 每个「内容」列开启一条轨，后续列归属上一条轨 */
function buildTracks(ws: ExcelJS.Worksheet, headerRow: number): Track[] {
  const ncols = ws.columnCount;
  const colKind: ColKind[] = [];
  for (let c = 1; c <= ncols; c++) colKind.push(classifyColumn(cellText(ws, headerRow, c)));

  const tracks: Track[] = [];
  for (let i = 0; i < colKind.length; i++) {
    if (colKind[i] === 'content') {
      tracks.push({ contentCol: i + 1, label: '', fields: { content: i + 1 } });
    } else if (tracks.length && colKind[i]) {
      tracks[tracks.length - 1].fields[colKind[i] as Exclude<ColKind, null>] = i + 1;
    }
  }
  const isDual = tracks.length > 1;
  tracks.forEach((t, i) => {
    t.label = trackLabel(cellText(ws, headerRow, t.contentCol), i, isDual);
  });
  return tracks;
}

/** 数据行的序号一定是数字；不是数字说明这行是插进来的分节标题行 */
const SEQ_RE = /^\d+$/;

function parseSheet(ws: ExcelJS.Worksheet, band: Band): { courses: ParsedCourse[]; error?: string; trackCount: number } {
  const sheetName = String(ws.name);
  const courses: ParsedCourse[] = [];
  const headerRow = findHeaderRow(ws);
  if (!headerRow) return { courses, error: '未找到表头行（教材版本 / 序号）', trackCount: 0 };

  const tracks = buildTracks(ws, headerRow);
  if (!tracks.length) return { courses, error: '未识别到内容列', trackCount: 0 };

  const seqCol = (() => {
    for (let c = 1; c <= ws.columnCount; c++) if (classifyColumn(cellText(ws, headerRow, c)) === 'seq') return c;
    return 2;
  })();

  const grade = gradeOf(sheetName);
  const subject = subjectOf(sheetName);

  // 首个分区标题在表头之上（暑假那段），要先取出来
  let term = '';
  for (let r = 1; r < headerRow; r++) {
    const t = extractTerm(cellText(ws, r, 1));
    if (t) term = t;
  }

  // 分节状态按轨独立：双轨 sheet 里左右两轨的阶测落在不同的课程位置
  const sectionOf = tracks.map(() => '');

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const seqRaw = cellText(ws, r, seqCol).trim();
    const span = rowAMergeSpan(ws, r);
    const aText = cellText(ws, r, 1);

    if (isSectionTitleRow(aText, span)) {
      const t = extractTerm(aText);
      if (t) term = t;
      sectionOf.fill('');
      continue;
    }
    if (isInstructionRow(aText, span)) continue;
    // 表头在每个分区都会重复一遍
    if (seqRaw === '序号' || aText.trim() === '教材版本') continue;

    // 某轨的内容单元格被横向合并 = 这轨在这行插了分节标题
    const isSectionCell = tracks.map((t) => hSpanOf(ws, r, t.contentCol) >= 2);
    if (isSectionCell.some(Boolean)) {
      tracks.forEach((t, i) => {
        if (isSectionCell[i]) sectionOf[i] = cellText(ws, r, t.contentCol).trim();
      });
    }

    // 序号必须是数字才算正常数据行；不是数字时，只有当这行确实带了分节标记
    // （某轨内容单元格被横向合并）才继续 —— 因为双轨 sheet 里分节行往往序号列是空的，
    // 而另一轨同一行还有正常课程，不能整行丢掉。
    // 实测：真实目录里有 458 条这种「序号为空的分节行」，之前的写法把另一轨的课程全丢了。
    const hasSeq = SEQ_RE.test(seqRaw);
    if (!hasSeq && !isSectionCell.some(Boolean)) continue;

    const seqNum = hasSeq ? Number(seqRaw) || 0 : 0;

    tracks.forEach((t, i) => {
      if (isSectionCell[i]) return;
      const content = cellText(ws, r, t.contentCol).trim();
      if (!content) return;
      courses.push({
        band,
        term,
        grade,
        subject,
        track: t.label,
        seq: seqNum,
        content,
        type: t.fields.type ? cellText(ws, r, t.fields.type).trim() : '',
        score: t.fields.score ? cellText(ws, r, t.fields.score).trim() : '',
        difficulty: t.fields.difficulty ? cellText(ws, r, t.fields.difficulty).trim() : '',
        impact: t.fields.impact ? cellText(ws, r, t.fields.impact).trim() : '',
        textbook: normalizeTextbook(cellText(ws, r, 1)),
        section: sectionOf[i],
        sheet: sheetName,
        sourceRow: r,
      });
    });
  }
  return { courses, trackCount: tracks.length };
}

// ============ 入口 ============

export async function parseCatalogWorkbook(
  buffer: Uint8Array,
  band: Band,
  loadWorkbook: (buffer: Uint8Array) => Promise<ExcelJS.Workbook>,
): Promise<ParseResult> {
  const result: ParseResult = { band, courses: [], sheets: [], failedSheets: [] };
  const wb = await loadWorkbook(buffer);

  for (const ws of wb.worksheets) {
    const { courses, error, trackCount } = parseSheet(ws, band);
    const sheetName = String(ws.name);
    result.sheets.push({
      sheet: sheetName,
      grade: gradeOf(sheetName),
      subject: subjectOf(sheetName),
      columnCount: ws.columnCount,
      rowCount: ws.rowCount,
      trackCount,
      courses: courses.length,
      error,
    });
    if (error) {
      result.failedSheets.push(sheetName);
      continue;
    }
    for (const c of courses) result.courses.push(c);
  }
  return result;
}
