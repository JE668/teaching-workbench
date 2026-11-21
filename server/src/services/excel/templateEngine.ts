import { db } from '../../config/database.js';
import { writeXlsxPreservingPackage, type XlsxCellAssignment } from './xlsxPackageWriter.js';

/**
 * Excel 模板引擎
 *
 * 核心能力：
 * 1. 解析上传的 .xlsx 模板（保留样式、条件格式、数据验证、透视表、公式）
 * 2. 字段映射：单元格地址 → 数据路径（支持循环、条件、嵌套）
 * 3. 数据填充：按映射把报告数据写入模板副本
 * 4. 输出：生成填充后的 .xlsx 二进制
 */

// ========== 类型定义 ==========

export interface ExcelTemplate {
  id: number;
  userId: number;
  name: string;
  fileBlob: Buffer;
  fieldMappings: FieldMappings;
  sheetName: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldMappings {
  [cellAddress: string]: string;
}

export interface ReportData {
  report: {
    id: number;
    student_id: number;
    student_name: string;
    year_month: string;
    term: string;
    grade: string;
    subject: string;
    summary_enabled: number;
    plan_enabled: number;
    summary_intro: string;
    plan_intro: string;
    farewell: string;
    created_at: string;
    updated_at: string;
  };
  items: ReportItem[];
  student: {
    id: number;
    name: string;
    grade: string;
    subject: string;
    phone: string | null;
    notes: string | null;
  };
}

export interface ReportItem {
  id: number;
  report_id: number;
  kind: 'summary' | 'plan' | 'exam';
  seq: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  scheduled_at: string;
  attendance: string;
  notes_done: string;
  mistakes_done: string;
  homework_done: string;
  exam: string;
  sort: number;
  course_id: number | null;
}

// 映射语法解析结果
interface ParsedMapping {
  type: 'static' | 'loop' | 'conditional';
  path: string;           // 数据路径，如 "report.student_name" 或 "report_items[kind=summary]->content"
  filter?: {
    key: string;
    value: string;
  };
  truePath?: string;
  falsePath?: string;
  loopConfig?: {
    sourcePath: string;   // 循环源，如 "report_items"
    filter?: { key: string; value: string };
    itemPath: string;     // 单项路径，如 "content"
    startCell: string;    // 起始单元格，如 "A3"
    direction: 'down' | 'right'; // 扩展方向
  };
}

/**
 * 解析字段映射字符串
 * 支持语法：
 * - 简单路径: "report.student_name"
 * - 循环: "loop:report_items[kind=summary]->content" (向下扩展)
 * - 循环横向: "loop:right:report_items[kind=summary]->content" (向右扩展)
 * - 条件: "if:report.summary_enabled=1->report.summary_intro"
 */
function parseMapping(mapping: string): ParsedMapping {
  // 循环语法: loop[:direction]:source[filter]->itemPath
  const loopMatch = mapping.match(/^loop:(right:)?(\w+)(?:\[(\w+)=([^\]]+)\])?->(.+)$/);
  if (loopMatch) {
    const [, directionPrefix, sourcePath, filterKey, filterValue, itemPath] = loopMatch;
    return {
      type: 'loop',
      path: mapping,
      loopConfig: {
        sourcePath,
        filter: filterKey ? { key: filterKey, value: filterValue } : undefined,
        itemPath,
        startCell: '', // 将在运行时填入
        direction: directionPrefix ? 'right' : 'down',
      },
    };
  }

  // 条件语法: if:condition->truePath[:falsePath]
  const condMatch = mapping.match(/^if:([\w.]+)=(.*?)->([^:]+)(?::(.*))?$/);
  if (condMatch) {
    const [, condKey, condValue, truePath, falsePath] = condMatch;
    return {
      type: 'conditional',
      path: mapping,
      filter: { key: condKey, value: condValue },
      truePath,
      falsePath,
    };
  }

  // 静态路径
  return {
    type: 'static',
    path: mapping,
  };
}

/**
 * 从数据对象按路径取值
 * 支持点号路径: "report.student_name", "student.grade"
 * 支持数组索引: "items[0].content"
 */
function getValueByPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    // 处理数组索引: items[0]
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, prop, index] = arrayMatch;
      current = (current as Record<string, unknown>)[prop];
      if (Array.isArray(current)) {
        current = current[parseInt(index, 10)];
      }
      continue;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * 获取循环源数组
 */
function getLoopSource(data: Record<string, unknown>, sourcePath: string, filter?: { key: string; value: string }): unknown[] {
  const source = getValueByPath(data, sourcePath);
  if (!Array.isArray(source)) return [];

  if (!filter) return source;

  return source.filter(item => {
    const itemObj = item as Record<string, unknown>;
    return String(itemObj[filter.key] ?? '') === filter.value;
  });
}

/**
 * 解析单元格地址 (如 "A1", "BC23") -> { row, col }
 */
function parseCellAddress(address: string): { row: number; col: number } {
  const match = address.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`无效单元格地址: ${address}`);

  const [, colStr, rowStr] = match;
  let col = 0;
  for (const ch of colStr) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(rowStr, 10), col };
}

/**
 * 将 { row, col } 转回单元格地址
 */
function cellAddress(row: number, col: number): string {
  let colStr = '';
  let c = col;
  while (c > 0) {
    c--;
    colStr = String.fromCharCode(65 + (c % 26)) + colStr;
    c = Math.floor(c / 26);
  }
  return `${colStr}${row}`;
}

// ========== 核心类 ==========

export class TemplateEngine {
  private template: ExcelTemplate;

  constructor(template: ExcelTemplate) {
    this.template = template;
  }

  /**
   * 使用模板生成报告 Excel
   */
  async generate(reportData: ReportData): Promise<Buffer> {
    // 直接修补原始 OOXML 包，避免 ExcelJS 重建工作簿时丢失透视表、宏、其他工作表及未知扩展。
    return writeXlsxPreservingPackage(
      this.template.fileBlob,
      this.template.sheetName,
      this.resolveAssignments(reportData),
    );
  }

  /** 将静态、循环、条件映射展开为单元格写入计划。 */
  private resolveAssignments(reportData: ReportData): XlsxCellAssignment[] {
    const data = this.prepareDataContext(reportData);
    const assignments: XlsxCellAssignment[] = [];
    for (const [cellAddr, mappingStr] of Object.entries(this.template.fieldMappings)) {
      const parsed = parseMapping(mappingStr);
      if (parsed.type === 'static') {
        assignments.push({ address: cellAddr, value: getValueByPath(data, parsed.path) });
        continue;
      }
      if (parsed.type === 'conditional') {
        const conditionValue = getValueByPath(data, parsed.filter?.key || '');
        const matches = String(conditionValue ?? '') === parsed.filter?.value;
        const targetPath = matches ? parsed.truePath : parsed.falsePath;
        if (targetPath) assignments.push({ address: cellAddr, value: getValueByPath(data, targetPath) });
        continue;
      }
      const config = parsed.loopConfig;
      if (!config) continue;
      const source = getLoopSource(data, config.sourcePath, config.filter);
      const start = parseCellAddress(cellAddr);
      source.forEach((item, index) => {
        const row = config.direction === 'down' ? start.row + index : start.row;
        const col = config.direction === 'right' ? start.col + index : start.col;
        assignments.push({
          address: cellAddress(row, col),
          value: getValueByPath({ item: item as Record<string, unknown> }, `item.${config.itemPath}`),
          styleSource: cellAddr,
          rowStyleSource: config.direction === 'down' && index > 0 ? start.row : undefined,
        });
      });
    }
    return assignments;
  }

  /**
   * 准备数据上下文，扁平化便于路径访问
   */
  private prepareDataContext(reportData: ReportData): Record<string, unknown> {
    const summaryItems = reportData.items.filter(i => i.kind === 'summary');
    const planItems = reportData.items.filter(i => i.kind === 'plan');
    const examItems = reportData.items.filter(i => i.kind === 'exam');

    return {
      report: {
        id: reportData.report.id,
        student_name: reportData.report.student_name,
        year_month: reportData.report.year_month,
        term: reportData.report.term,
        grade: reportData.report.grade,
        subject: reportData.report.subject,
        summary_enabled: reportData.report.summary_enabled,
        plan_enabled: reportData.report.plan_enabled,
        summary_intro: reportData.report.summary_intro,
        plan_intro: reportData.report.plan_intro,
        farewell: reportData.report.farewell,
        created_at: reportData.report.created_at,
        updated_at: reportData.report.updated_at,
      },
      student: {
        id: reportData.student.id,
        name: reportData.student.name,
        grade: reportData.student.grade,
        subject: reportData.student.subject,
        phone: reportData.student.phone,
        notes: reportData.student.notes,
      },
      report_items: reportData.items.map(item => ({
        id: item.id,
        kind: item.kind,
        seq: item.seq,
        content: item.content,
        type: item.type,
        score: item.score,
        difficulty: item.difficulty,
        scheduled_at: item.scheduled_at,
        attendance: item.attendance,
        notes_done: item.notes_done,
        mistakes_done: item.mistakes_done,
        homework_done: item.homework_done,
        exam: item.exam,
        sort: item.sort,
        course_id: item.course_id,
      })),
      // 便捷分组
      summary_items: summaryItems.map((item, idx) => ({
        ...item,
        row_index: idx + 1,
      })),
      plan_items: planItems.map((item, idx) => ({
        ...item,
        row_index: idx + 1,
      })),
      exam_items: examItems.map((item, idx) => ({
        ...item,
        row_index: idx + 1,
      })),
    };
  }
}

// ========== 数据库操作 ==========

/**
 * 创建模板记录
 */
export function createExcelTemplate(
  userId: number,
  name: string,
  fileBlob: Buffer,
  fieldMappings: FieldMappings,
  sheetName: string = 'Sheet1'
): number {
  const stmt = db.prepare(`
    INSERT INTO excel_templates (user_id, name, file_blob, field_mappings, sheet_name)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, name, fileBlob, JSON.stringify(fieldMappings), sheetName);
  return Number(result.lastInsertRowid);
}

/**
 * 获取用户的所有模板
 */
export function getExcelTemplates(userId: number): ExcelTemplate[] {
  const stmt = db.prepare(`
    SELECT id, user_id as userId, name, file_blob as fileBlob,
           field_mappings as fieldMappings, sheet_name as sheetName,
           created_at as createdAt, updated_at as updatedAt
    FROM excel_templates
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `);
  const rows = stmt.all(userId) as any[];
  return rows.map(row => ({
    ...row,
    fileBlob: row.fileBlob as Buffer,
    fieldMappings: JSON.parse(row.fieldMappings),
  }));
}

/**
 * 根据 ID 获取模板
 */
export function getExcelTemplateById(id: number, userId: number): ExcelTemplate | null {
  const stmt = db.prepare(`
    SELECT id, user_id as userId, name, file_blob as fileBlob,
           field_mappings as fieldMappings, sheet_name as sheetName,
           created_at as createdAt, updated_at as updatedAt
    FROM excel_templates
    WHERE id = ? AND user_id = ?
  `);
  const row = stmt.get(id, userId) as any;
  if (!row) return null;
  return {
    ...row,
    fileBlob: row.fileBlob as Buffer,
    fieldMappings: JSON.parse(row.fieldMappings),
  };
}

/**
 * 更新模板
 */
export function updateExcelTemplate(
  id: number,
  userId: number,
  updates: Partial<Pick<ExcelTemplate, 'name' | 'fileBlob' | 'fieldMappings' | 'sheetName'>>
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.fileBlob !== undefined) {
    fields.push('file_blob = ?');
    values.push(updates.fileBlob);
  }
  if (updates.fieldMappings !== undefined) {
    fields.push('field_mappings = ?');
    values.push(JSON.stringify(updates.fieldMappings));
  }
  if (updates.sheetName !== undefined) {
    fields.push('sheet_name = ?');
    values.push(updates.sheetName);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  values.push(id, userId);

  const stmt = db.prepare(`UPDATE excel_templates SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

/**
 * 删除模板
 */
export function deleteExcelTemplate(id: number, userId: number): boolean {
  const stmt = db.prepare('DELETE FROM excel_templates WHERE id = ? AND user_id = ?');
  const result = stmt.run(id, userId);
  return result.changes > 0;
}
