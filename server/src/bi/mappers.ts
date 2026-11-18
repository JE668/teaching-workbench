import { parseXlsx } from './parserBase.js';

/**
 * 字段映射：源表头（xlsx 第一行）→ 目标字段名（数据库列名）。
 * 未在 mapping 中列出的表头会被丢弃（或收集到 extra）。
 */
export type FieldMapping = Record<string, string>;  // source_header -> target_field

/**
 * 值转换器：把字符串值转换为合适的类型。
 * 返回 null 表示该字段值为空。
 */
export type ValueConverter = (raw: string | number | null) => unknown;

/**
 * 解析错误：单行解析失败时收集的详细信息。
 */
export interface RowError {
  rowNumber: number;
  errorCode: string;
  errorMessage: string;
  rawData: Record<string, unknown>;
}

export interface MapperResult {
  records: Record<string, unknown>[];   // 已映射的目标字段记录（不含错误行）
  errors: RowError[];
  totalSourceRows: number;              // 源文件总行数（含表头）
}

/**
 * 通用字段映射解析。
 *
 * @param filePath       xlsx 路径
 * @param options.sheetName   sheet 名（null = 第一个）
 * @param options.headerRow   表头行号（1-based）
 * @param mapping             源表头 → 目标字段
 * @param converters          字段级值转换（target_field -> fn）
 * @param requiredFields      必填目标字段列表；缺失则该行进 errors
 */
export async function mapRows(
  filePath: string,
  options: {
    sheetName?: string | null;
    headerRow?: number;
    mapping: FieldMapping;
    converters?: Record<string, ValueConverter>;
    requiredFields?: string[];
    collectExtra?: boolean;    // 未在 mapping 中的字段是否收集到 extra (JSON)
  }
): Promise<MapperResult> {
  const {
    sheetName = null,
    headerRow = 1,
    mapping,
    converters = {},
    requiredFields = [],
    collectExtra = true,
  } = options;

  const parsed = await parseXlsx(filePath, { sheetName, headerRow });

  // 反转 mapping: target_field -> source_header，方便按 target 取值
  const targetToSource: Record<string, string> = {};
  for (const [src, tgt] of Object.entries(mapping)) {
    targetToSource[tgt] = src;
  }

  const records: Record<string, unknown>[] = [];
  const errors: RowError[] = [];

  for (const row of parsed.rows) {
    const rowNum = (row['__row_number'] as number) ?? 0;
    const record: Record<string, unknown> = {};
    const extraData: Record<string, unknown> = {};
    let hasError = false;
    let errorMessage = '';

    // 检查必填字段
    for (const req of requiredFields) {
      const src = targetToSource[req];
      const val = src ? row[src] : null;
      if (val === null || val === undefined || val === '') {
        hasError = true;
        errorMessage = `必填字段 "${req}" (源列 "${src}") 为空`;
        break;
      }
    }

    if (hasError) {
      errors.push({
        rowNumber: rowNum,
        errorCode: 'MISSING_FIELD',
        errorMessage,
        rawData: row,
      });
      continue;
    }

    // 按 mapping 提取字段
    const mappedSources = new Set<string>();
    for (const [src, tgt] of Object.entries(mapping)) {
      mappedSources.add(src);
      const rawVal = row[src] ?? null;
      const converter = converters[tgt];
      const converted = converter ? converter(rawVal) : rawVal;
      record[tgt] = converted;
    }

    // 收集未映射的字段到 extra
    if (collectExtra) {
      for (const [header, val] of Object.entries(row)) {
        if (header === '__row_number') continue;
        if (!mappedSources.has(header) && val !== null && val !== '') {
          extraData[header] = val;
        }
      }
      if (Object.keys(extraData).length > 0) {
        record['extra'] = JSON.stringify(extraData);
      } else {
        record['extra'] = null;
      }
    }

    record['__row_number'] = rowNum;
    records.push(record);
  }

  return {
    records,
    errors,
    totalSourceRows: parsed.totalRows,
  };
}

// ============ 通用值转换器 ============

/** 字符串 → 整数；失败返回 null */
export function toInt(raw: string | number | null): number | null {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'number') return Math.trunc(raw);
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

/** 字符串 → 浮点；失败返回 null */
export function toFloat(raw: string | number | null): number | null {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

/** 是/否 → 1/0；其他保留原字符串 */
export function toYesNo(raw: string | number | null): number | string | null {
  if (raw === null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '是' || s === 'yes' || s === 'y' || s === '1') return 1;
  if (s === '否' || s === 'no' || s === 'n' || s === '0') return 0;
  return String(raw);
}

/** 保持字符串（trim + 空字符串转 null） */
export function toStr(raw: string | number | null): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}
