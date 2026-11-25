export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

/** 避免把用户/表格文本当作 Excel 公式执行；数值列仍保留真实负数。 */
function excelText(value: string): string {
  return /^[=+@]/.test(value) || /^-D/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : excelText(String(value));
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function serializeCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  return lines.join('\r\n');
}

export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const blob = new Blob(['\ufeff', serializeCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
