import ExcelJS from 'exceljs';
import { ExportSheet } from './exportService.js';
import * as fs from 'fs';

/**
 * 将导出数据写入 ExcelJS 工作簿
 */
export async function writeExportToWorkbook(sheets: ExportSheet[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Teaching Workbench';
  workbook.created = new Date();
  workbook.modified = new Date();

  for (const sheetData of sheets) {
    const worksheet = workbook.addWorksheet(sheetData.name, {
      properties: { tabColor: { argb: '4F46E5' } },
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
    });

    // 设置列宽
    if (sheetData.columnWidths) {
      sheetData.columnWidths.forEach((width, idx) => {
        worksheet.getColumn(idx + 1).width = width;
      });
    }

    // 写入表头
    const headerRow = worksheet.addRow(sheetData.headers);
    if (sheetData.styles?.header) {
      applyStyle(headerRow, sheetData.styles.header);
    }
    headerRow.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'medium', color: { argb: '4F46E5' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      };
    });

    // 冻结首行
    worksheet.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];

    // 写入数据行
    for (let i = 0; i < sheetData.rows.length; i++) {
      const rowData = sheetData.rows[i];
      const row = worksheet.addRow(rowData);
      
      if (sheetData.styles?.body) {
        applyStyle(row, sheetData.styles.body);
      }
      
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'E2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
          left: { style: 'thin', color: { argb: 'E2E8F0' } },
          right: { style: 'thin', color: { argb: 'E2E8F0' } },
        };
        
        // 交替行背景
        if (i % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
        }
      });
    }

    // 自动筛选
    if (sheetData.rows.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: sheetData.rows.length + 1, column: sheetData.headers.length },
      };
    }

    // 条件格式 - 暂时禁用以避免 API 兼容性问题
    // if (sheetData.styles?.conditional) {
    //   for (const cf of sheetData.styles.conditional) {
    //     applyConditionalFormat(worksheet, cf, sheetData.rows.length + 1);
    //   }
    // }
  }

  return workbook;
}

function applyStyle(row: ExcelJS.Row, style: Partial<{ font?: { bold?: boolean; color?: string; size?: number; name?: string }; fill?: { type: 'pattern'; pattern: 'solid'; fgColor: string }; alignment?: { horizontal?: 'left' | 'center' | 'right'; vertical?: 'top' | 'middle' | 'bottom'; wrapText?: boolean }; border?: { top?: any; bottom?: any; left?: any; right?: any }; numFmt?: string }>) {
  row.eachCell(cell => {
    if (style.font) {
      cell.font = {
        bold: style.font.bold ?? false,
        color: style.font.color ? { argb: style.font.color.replace('#', '') } : { argb: '1E293B' },
        size: style.font.size ?? 10,
        name: style.font.name ?? 'Microsoft YaHei',
      };
    }
    if (style.fill) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: style.fill.fgColor.replace('#', '') },
      };
    }
    if (style.alignment) {
      cell.alignment = {
        horizontal: style.alignment.horizontal ?? 'left',
        vertical: style.alignment.vertical ?? 'middle',
        wrapText: style.alignment.wrapText ?? false,
      };
    }
    if (style.border) {
      cell.border = {
        top: style.border.top ?? { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: style.border.bottom ?? { style: 'thin', color: { argb: 'E2E8F0' } },
        left: style.border.left ?? { style: 'thin', color: { argb: 'E2E8F0' } },
        right: style.border.right ?? { style: 'thin', color: { argb: 'E2E8F0' } },
      };
    }
    if (style.numFmt) {
      cell.numFmt = style.numFmt;
    }
  });
}



/**
 * 生成导出文件并返回 Buffer
 */
export async function generateExportBuffer(options: { reportId: number; userId: number; template?: string; centerName?: string; months?: string[] }): Promise<Buffer> {
  const { buildExport } = await import('./exportService.js');
  const sheets = await buildExport(options as any);
  const workbook = await writeExportToWorkbook(sheets);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * 生成导出文件并保存到磁盘
 */
export async function generateExportFile(options: { reportId: number; userId: number; template?: string; centerName?: string; months?: string[] }, outputPath: string): Promise<void> {
  const buffer = await generateExportBuffer(options);
  await fs.promises.writeFile(outputPath, buffer);
}

