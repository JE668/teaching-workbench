import ExcelJS from 'exceljs';
import { COLUMN_LABELS, COLUMN_ORDER } from './constants.js';
import type { StoredFetch, TeachingCell, TeachingRow } from './types.js';

const MODEL_NAMES = { feedback: '课后反馈', tutorplan: '课后辅导', evaluate_analysis: '阶段评估', prepare: '课前备课' } as const;
const DEPT_NAMES = { math: '数学组', science: '理综组', arts: '文科组', all: '全部科组' } as const;
const TERM_NAMES = { '1': '春季', '2': '暑假', '3': '秋季', '4': '寒假' } as const;
const EXAM_NAMES = { '1': '期中', '2': '期末', '': '' } as const;
const RATE_NAMES = { must_upload_num: '考核率', total_must_upload_num: '覆盖率' } as const;
const COURSE_TAG_NAMES = ['体验课', '促销课', '课展课', '测评课'];

function cleanFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n\0]/g, '_').trim() || '未命名';
}

function localDateStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' + pad(date.getHours()) + pad(date.getMinutes());
}

export function exportFilename(stored: StoredFetch): { pretty: string; ascii: string } {
  const { meta } = stored;
  const parts: string[] = [MODEL_NAMES[meta.modelType], DEPT_NAMES[meta.dept]];
  if (meta.modelType === 'evaluate_analysis') {
    const colType = meta.colType || 'must_upload_num';
    parts.push(colType === 'both' ? '考核率+覆盖率' : (RATE_NAMES[colType as keyof typeof RATE_NAMES] || colType));
    if (meta.schoolYear) parts.push(meta.schoolYear);
    if (meta.term) parts.push(TERM_NAMES[meta.term]);
    if (meta.examType) parts.push(EXAM_NAMES[meta.examType]);
  } else {
    if (meta.startDate) parts.push(meta.startDate);
    if (meta.endDate) parts.push(meta.endDate);
    if (meta.modelType === 'prepare' && meta.courseTags?.length) {
      parts.push(...COURSE_TAG_NAMES.filter((_, index) => meta.courseTags!.includes(index)));
    }
  }
  parts.push(localDateStamp());
  return {
    pretty: parts.map(cleanFilePart).join('_') + '.xlsx',
    ascii: 'teaching-data-' + localDateStamp() + '.xlsx',
  };
}

export function contentDisposition(stored: StoredFetch): string {
  const { pretty, ascii } = exportFilename(stored);
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'\'' + encodeURIComponent(pretty);
}

function labelFor(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  return COLUMN_LABELS[camel] || key;
}

function orderedColumns(rows: TeachingRow[]): Array<{ key: string; label: string }> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const mapped = keys.map((key, index) => ({ key, label: labelFor(key), index }));
  const rank = (label: string) => {
    const index = COLUMN_ORDER.indexOf(label);
    return index < 0 ? COLUMN_ORDER.length : index;
  };
  mapped.sort((a, b) => rank(a.label) - rank(b.label) || a.index - b.index);
  return mapped.map(({ key, label }) => ({ key, label }));
}

function safeExcelCell(value: TeachingCell | undefined): TeachingCell {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  let text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g, '');
  // 制表符前缀让 Excel/WPS 把 = + - @ 开头的内容当文本，包括前置空白绕过。
  if (/^\s*[=+\-@]/.test(text)) text = '\t' + text;
  return text.slice(0, 32_767);
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: TeachingRow[], columnSource: TeachingRow[]): void {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const columns = orderedColumns(columnSource);
  sheet.addRow(columns.map((column) => column.label));
  for (const row of rows) sheet.addRow(columns.map((column) => safeExcelCell(row[column.key])));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const length = String(cell.value ?? '').length;
      const column = sheet.getColumn(columnNumber);
      column.width = Math.min(50, Math.max(column.width || 10, length + 2, 10));
    });
  });
}

export async function createWorkbookBuffer(stored: StoredFetch): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Teaching Workbench';
  const both = stored.meta.modelType === 'evaluate_analysis' && (stored.meta.colType || 'must_upload_num') === 'both';
  if (both) {
    addSheet(workbook, '考核率统计', stored.rows.filter((row) => row['统计口径'] === 'must_upload_num'), stored.rows);
    addSheet(workbook, '覆盖率统计', stored.rows.filter((row) => row['统计口径'] === 'total_must_upload_num'), stored.rows);
  } else {
    addSheet(workbook, 'Sheet1', stored.rows, stored.rows);
  }
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}