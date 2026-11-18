import ExcelJS from 'exceljs';
import type { Workbook, Worksheet } from 'exceljs';

/**
 * 解析后的行数据：字段名 → 值。
 * 所有值统一为 string | number | null（日期由调用方格式化）。
 */
export type ParsedRow = Record<string, string | number | null>;

export interface ParseResult {
  rows: ParsedRow[];
  headers: string[];              // 第一行的原始表头
  headerRowIndex: number;         // 表头所在行号（1-based）
  totalRows: number;              // 含表头的总行数
}

/**
 * 读取 xlsx 文件的指定 sheet，返回表头 + 数据行。
 *
 * 关键设计（吸取探查阶段教训）：
 *   - 不用 streaming / read_only 模式：xlsx 内部 dimension 声明可能有误
 *     （read_only 模式下 max_row 返回 1 但实际有 240 行）
 *   - 使用 exceljs 的 workbook.xlsx.readFile()，它会完整解析工作簿
 *   - 日期单元格由 exceljs 自动转为 JS Date，这里统一格式化为 ISO 字符串
 */
export async function parseXlsx(
  filePath: string,
  options: {
    sheetName?: string | null;    // null = 第一个 sheet
    headerRow?: number;           // 表头行号（1-based），默认 1
  } = {}
): Promise<ParseResult> {
  const { sheetName = null, headerRow = 1 } = options;

  const workbook: Workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  let sheet: Worksheet | undefined;
  if (sheetName) {
    sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" 不存在。可用 sheets: ${workbook.worksheets.map(s => s.name).join(', ')}`);
    }
  } else {
    sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error('文件没有任何 sheet');
    }
  }

  // 读取表头行
  const headerExcelRow = sheet.getRow(headerRow);
  const headers: string[] = [];
  for (let col = 1; col <= sheet.columnCount; col++) {
    const cell = headerExcelRow.getCell(col);
    const val = cell.value;
    // 表头统一转为 string，去掉首尾空格
    const header = val === null || val === undefined ? '' : String(val).trim();
    headers.push(header);
  }

  // 找到最后一个非空表头的列索引（防止右侧大量空列）
  let lastHeaderCol = 0;
  for (let i = headers.length - 1; i >= 0; i--) {
    if (headers[i] !== '') {
      lastHeaderCol = i;
      break;
    }
  }
  const effectiveHeaders = headers.slice(0, lastHeaderCol + 1);

  // 读取数据行（表头行之后）
  const rows: ParsedRow[] = [];
  for (let rowNum = headerRow + 1; rowNum <= sheet.rowCount; rowNum++) {
    const excelRow = sheet.getRow(rowNum);
    const row: ParsedRow = {};

    let hasData = false;
    for (let col = 1; col <= effectiveHeaders.length; col++) {
      const cell = excelRow.getCell(col);
      const header = effectiveHeaders[col - 1];
      if (header === '') continue;

      const value = formatCellValue(cell);
      row[header] = value;
      if (value !== null && value !== '') hasData = true;
    }

    // 跳过完全空行
    if (hasData) {
      row['__row_number'] = rowNum;
      rows.push(row);
    }
  }

  return {
    rows,
    headers: effectiveHeaders,
    headerRowIndex: headerRow,
    totalRows: sheet.rowCount,
  };
}

/**
 * 格式化单元格值为 string | number | null。
 * 日期统一为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss。
 */
function formatCellValue(cell: ExcelJS.Cell): string | number | null {
  const val = cell.value;

  if (val === null || val === undefined) return null;

  // 富文本
  if (typeof val === 'object' && 'richText' in val) {
    return (val as { richText: { text: string }[] }).richText.map(r => r.text).join('');
  }

  // 公式结果
  if (typeof val === 'object' && 'result' in val) {
    const result = (val as { result: unknown }).result;
    if (result === null || result === undefined) return null;
    if (result instanceof Date) return formatDate(result);
    return typeof result === 'number' ? result : String(result);
  }

  // 超链接
  if (typeof val === 'object' && 'text' in val && 'hyperlink' in val) {
    return String((val as { text: string }).text);
  }

  // 日期
  if (val instanceof Date) {
    return formatDate(val);
  }

  // 基本类型
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;

  return String(val);
}

/**
 * 格式化日期为 YYYY-MM-DD（无时间部分）或 YYYY-MM-DD HH:mm:ss。
 */
function formatDate(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 如果时分秒都是 0，只返回日期
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    return datePart;
  }
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
