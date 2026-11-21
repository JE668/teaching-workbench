import ExcelJS from 'exceljs';

export const EXCEL_TEMPLATE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EXCEL_TEMPLATE_PREVIEW_ROWS = 30;
export const EXCEL_TEMPLATE_PREVIEW_COLUMNS = 12;

export interface InspectedTemplateCell {
  address: string;
  text: string;
}

export interface ExcelTemplateInspection {
  sheetNames: string[];
  sheetName: string;
  rowCount: number;
  columnCount: number;
  cells: InspectedTemplateCell[];
  truncated: boolean;
  maxRows: number;
  maxColumns: number;
}

export class ExcelTemplateInspectError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ExcelTemplateInspectError';
  }
}

/** Buffer.from 会静默忽略非法字符，因此先校验字符、padding，再比较规范化结果。 */
function decodeFileBase64(input: unknown): Buffer {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ExcelTemplateInspectError('请提供 Excel 文件的 base64 内容');
  }
  const normalized = input.replace(/\s/g, '');
  if (
    normalized.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    || (normalized.includes('=') && normalized.length % 4 !== 0)
  ) {
    throw new ExcelTemplateInspectError('Excel 文件的 base64 格式不正确');
  }
  // 在分配解码后的 Buffer 前先挡住明显超限的请求。
  if (normalized.length > Math.ceil(EXCEL_TEMPLATE_MAX_FILE_BYTES / 3) * 4 + 4) {
    throw new ExcelTemplateInspectError('Excel 文件不能超过 10MB', 413);
  }
  const file = Buffer.from(normalized, 'base64');
  if (file.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new ExcelTemplateInspectError('Excel 文件的 base64 格式不正确');
  }
  if (file.length === 0) throw new ExcelTemplateInspectError('Excel 文件不能为空');
  if (file.length > EXCEL_TEMPLATE_MAX_FILE_BYTES) {
    throw new ExcelTemplateInspectError('Excel 文件不能超过 10MB', 413);
  }
  return file;
}

/** 读取工作簿结构与可视化编辑所需的有限单元格，避免大表撑爆响应。 */
export async function inspectTemplate(
  fileBase64: unknown,
  sheetName?: unknown,
): Promise<ExcelTemplateInspection> {
  const file = decodeFileBase64(fileBase64);
  if (file.length < 2 || file[0] !== 0x50 || file[1] !== 0x4b) {
    throw new ExcelTemplateInspectError('无法读取 Excel 文件，请上传有效的 xlsx 文件');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  } catch {
    throw new ExcelTemplateInspectError('Excel 文件损坏或格式不支持，请上传有效的 xlsx 文件');
  }
  if (workbook.worksheets.length === 0) {
    throw new ExcelTemplateInspectError('Excel 文件中没有任何工作表');
  }
  if (sheetName !== undefined && sheetName !== null && typeof sheetName !== 'string') {
    throw new ExcelTemplateInspectError('工作表名必须是字符串');
  }
  const requestedName = typeof sheetName === 'string' && sheetName ? sheetName : undefined;
  const sheet = requestedName ? workbook.getWorksheet(requestedName) : workbook.worksheets[0];
  if (!sheet) throw new ExcelTemplateInspectError(`未找到工作表：${requestedName}`);

  // 必须在读取预览空格前记录尺寸；getCell 会实例化空单元格，进而改变 rowCount。
  const rowCount = sheet.rowCount;
  const columnCount = sheet.columnCount;
  const cells: InspectedTemplateCell[] = [];
  for (let row = 1; row <= EXCEL_TEMPLATE_PREVIEW_ROWS; row += 1) {
    for (let column = 1; column <= EXCEL_TEMPLATE_PREVIEW_COLUMNS; column += 1) {
      const cell = sheet.getCell(row, column);
      const text = cell.text;
      if (cell.value !== null && cell.value !== undefined && text.trim() !== '') {
        cells.push({ address: cell.address, text });
      }
    }
  }

  return {
    sheetNames: workbook.worksheets.map((item) => item.name),
    sheetName: sheet.name,
    rowCount,
    columnCount,
    cells,
    truncated: rowCount > EXCEL_TEMPLATE_PREVIEW_ROWS || columnCount > EXCEL_TEMPLATE_PREVIEW_COLUMNS,
    maxRows: EXCEL_TEMPLATE_PREVIEW_ROWS,
    maxColumns: EXCEL_TEMPLATE_PREVIEW_COLUMNS,
  };
}
