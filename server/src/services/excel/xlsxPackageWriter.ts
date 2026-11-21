import PizZip from 'pizzip';

export interface XlsxCellAssignment {
  address: string;
  value: unknown;
  /** 新建单元格时复制该单元格的样式。 */
  styleSource?: string;
  /** 新建行时复制该行的行属性和各列样式，但不复制值或公式。 */
  rowStyleSource?: number;
}

interface RowPart { number: number; xml: string }

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
}

function decodeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    const radix = lower.startsWith('&#x') ? 16 : 10;
    const digits = entity.slice(radix === 16 ? 3 : 2, -1);
    return String.fromCodePoint(Number.parseInt(digits, radix));
  });
}

function attributes(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const opening = xml.match(/^<[^>]+>/)?.[0] || xml;
  for (const match of opening.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    result[match[1]] = decodeXml(match[3]);
  }
  return result;
}

function addressParts(address: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`无效单元格地址: ${address}`);
  let col = 0;
  for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(match[2]), col };
}

function columnName(column: number): string {
  let value = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
  }
  return value;
}

function replaceAttribute(opening: string, name: string, value: string | null): string {
  const pattern = new RegExp(`\\s${name}=(["'])(.*?)\\1`);
  const without = opening.replace(pattern, '');
  return value === null ? without : without.replace(/\s*\/?>$/, ending => ` ${name}="${escapeXml(value)}"${ending}`);
}

function cellValueXml(value: unknown): { type: string | null; body: string } {
  if (typeof value === 'number' && Number.isFinite(value)) return { type: 'n', body: `<v>${value}</v>` };
  if (typeof value === 'bigint') return { type: 'n', body: `<v>${value.toString()}</v>` };
  if (typeof value === 'boolean') return { type: 'b', body: `<v>${value ? 1 : 0}</v>` };
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const serial = value.getTime() / 86400000 + 25569;
    return { type: 'n', body: `<v>${serial}</v>` };
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return { type: 'inlineStr', body: `<is><t xml:space="preserve">${escapeXml(text)}</t></is>` };
}

function renderCell(address: string, existingCell: string | null, value: unknown): string {
  const source = existingCell?.match(/^<c\b[^>]*>/)?.[0] || `<c r="${address}"/>`;
  const withAddress = replaceAttribute(source, 'r', address);
  const formula = existingCell?.match(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/)?.[0];
  const rendered = cellValueXml(value);
  // 公式单元格保留 <f>，写入的是与本次映射值一致的缓存结果，而非删除公式。
  // inlineStr 不能作为公式缓存值，字符串公式结果使用 t="str" + <v>。
  const type = formula && rendered.type === 'inlineStr' ? 'str' : rendered.type;
  const body = formula
    ? formula + (rendered.type === 'inlineStr'
      ? `<v>${escapeXml(typeof value === 'object' ? JSON.stringify(value) : String(value))}</v>`
      : rendered.body)
    : rendered.body;
  const withType = replaceAttribute(withAddress, 't', type);
  const openingTag = withType.match(/^<c\b[^>]*>/)?.[0] || `<c r="${address}">`;
  const normalizedOpening = openingTag.replace(/\/>$/, '>');
  return `${normalizedOpening}${body}</c>`;
}

interface SheetExpansion {
  direction: 'down' | 'right';
  origin: number;
  last: number;
}

/** 从循环映射的 styleSource 还原实际扩展区间；同一行/列的多个循环取最大范围。 */
function inferExpansions(assignments: XlsxCellAssignment[]): SheetExpansion[] {
  const expansions = new Map<string, SheetExpansion>();
  for (const assignment of assignments) {
    if (!assignment.styleSource || assignment.value === undefined || assignment.value === null) continue;
    const start = addressParts(assignment.styleSource);
    const target = addressParts(assignment.address);
    let expansion: SheetExpansion | undefined;
    if (start.col === target.col && target.row > start.row) {
      expansion = { direction: 'down', origin: start.row, last: target.row };
    } else if (start.row === target.row && target.col > start.col) {
      expansion = { direction: 'right', origin: start.col, last: target.col };
    }
    if (!expansion) continue;
    const key = `${expansion.direction}:${expansion.origin}`;
    const previous = expansions.get(key);
    expansions.set(key, { ...expansion, last: Math.max(previous?.last || 0, expansion.last) });
  }
  return [...expansions.values()];
}

interface A1Address {
  col: number;
  row: number;
  colAbsolute: boolean;
  rowAbsolute: boolean;
}

function parseA1(address: string): A1Address | null {
  const match = /^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(address);
  if (!match) return null;
  const { col, row } = addressParts(`${match[2]}${match[4]}`);
  return { col, row, colAbsolute: match[1] === '$', rowAbsolute: match[3] === '$' };
}

function formatA1(address: A1Address): string {
  return `${address.colAbsolute ? '$' : ''}${columnName(address.col)}${address.rowAbsolute ? '$' : ''}${address.row}`;
}

const rangeReferencePattern = /(?:(?:'((?:[^']|'')+)'|([\w.\u00a0-\uffff]+))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;

function expandReferenceMatch(
  match: string,
  quotedSheet: string | undefined,
  plainSheet: string | undefined,
  firstAddress: string,
  secondAddress: string | undefined,
  currentSheet: string,
  targetSheet: string,
  expansions: SheetExpansion[],
  allowSingleCell: boolean,
): string {
  const qualifier = quotedSheet !== undefined ? quotedSheet.replace(/''/g, "'") : plainSheet;
  if (qualifier ? qualifier !== targetSheet : currentSheet !== targetSheet) return match;
  if (!secondAddress && !allowSingleCell) return match;
  const first = parseA1(firstAddress);
  const last = secondAddress ? parseA1(secondAddress) : first ? { ...first } : null;
  if (!first || !last) return match;
  for (const expansion of expansions) {
    if (expansion.direction === 'down'
      && first.row <= expansion.origin && last.row >= expansion.origin && last.row < expansion.last) {
      last.row = expansion.last;
    } else if (expansion.direction === 'right'
      && first.col <= expansion.origin && last.col >= expansion.origin && last.col < expansion.last) {
      last.col = expansion.last;
    }
  }
  const prefix = quotedSheet !== undefined ? `'${quotedSheet}'!` : plainSheet !== undefined ? `${plainSheet}!` : '';
  const firstText = formatA1(first);
  const lastText = formatA1(last);
  if (!secondAddress && firstText === lastText) return match;
  return `${prefix}${firstText}:${lastText}`;
}

function expandFormula(
  formula: string,
  currentSheet: string,
  targetSheet: string,
  expansions: SheetExpansion[],
): string {
  // 双引号字符串中的 A1:B2 是文本，不是单元格引用。
  return formula.split(/("(?:[^"]|"")*")/).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(rangeReferencePattern, (match, quoted, plain, first, second) =>
      expandReferenceMatch(match, quoted, plain, first, second, currentSheet, targetSheet, expansions, false));
  }).join('');
}

function expandRangeList(
  value: string,
  currentSheet: string,
  targetSheet: string,
  expansions: SheetExpansion[],
): string {
  return value.split(/(\s+)/).map(part => /\s+/.test(part) ? part : part.replace(
    rangeReferencePattern,
    (match, quoted, plain, first, second) => expandReferenceMatch(
      match, quoted, plain, first, second, currentSheet, targetSheet, expansions, true),
  )).join('');
}

function expandFormulaTags(xml: string, currentSheet: string, targetSheet: string, expansions: SheetExpansion[]): string {
  return xml.replace(/<(f|formula|formula1|formula2|definedName)\b[^>]*>([\s\S]*?)<\/\1>/g,
    (whole, _tag, content: string) => {
      const decoded = decodeXml(content);
      const expanded = expandFormula(decoded, currentSheet, targetSheet, expansions);
      return expanded === decoded ? whole : whole.replace(content, escapeXml(expanded));
    });
}

function expandRangeAttributes(
  xml: string,
  currentSheet: string,
  targetSheet: string,
  expansions: SheetExpansion[],
): string {
  let output = xml;
  for (const [tag, names] of [['mergeCell', ['ref']], ['conditionalFormatting', ['sqref']], ['dataValidation', ['sqref']], ['autoFilter', ['ref']]] as const) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>`, 'g'), opening => {
      let updated = opening;
      for (const name of names) {
        const value = attributes(updated)[name];
        if (!value) continue;
        const expanded = expandRangeList(value, currentSheet, targetSheet, expansions);
        if (expanded !== value) updated = replaceAttribute(updated, name, expanded);
      }
      return updated;
    });
  }
  return output;
}

function expandWorksheetXml(xml: string, currentSheet: string, targetSheet: string, expansions: SheetExpansion[]): string {
  let output = expandFormulaTags(xml, currentSheet, targetSheet, expansions);
  if (currentSheet === targetSheet) output = expandRangeAttributes(output, currentSheet, targetSheet, expansions);
  return output;
}

function expandPivotCacheXml(xml: string, targetSheet: string, expansions: SheetExpansion[]): string {
  return xml.replace(/<worksheetSource\b[^>]*>/g, opening => {
    const attrs = attributes(opening);
    if (attrs.sheet !== targetSheet || !attrs.ref) return opening;
    const expanded = expandRangeList(attrs.ref, targetSheet, targetSheet, expansions);
    return expanded === attrs.ref ? opening : replaceAttribute(opening, 'ref', expanded);
  });
}

function blankCellAtRow(sourceCell: string, row: number): string {
  const oldAddress = attributes(sourceCell).r;
  if (!oldAddress) return sourceCell;
  const col = addressParts(oldAddress).col;
  const opening = sourceCell.match(/^<c\b[^>]*>/)?.[0] || `<c r="${oldAddress}"/>`;
  const updated = replaceAttribute(replaceAttribute(opening, 'r', `${columnName(col)}${row}`), 't', null);
  return updated.endsWith('/>') ? updated : updated.replace(/>$/, '/>');
}

function cloneRowStyle(source: RowPart, targetRow: number): string {
  const opening = source.xml.match(/^<row\b[^>]*>/)?.[0] || `<row r="${source.number}"/>`;
  const targetOpening = replaceAttribute(replaceAttribute(opening, 'r', String(targetRow)), 'spans', null).replace(/\/>$/, '>');
  const cells = [...source.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)]
    .map(match => blankCellAtRow(match[0], targetRow)).join('');
  return `${targetOpening}${cells}</row>`;
}

class SheetEditor {
  private rows: RowPart[] = [];
  private prefix: string;
  private suffix: string;

  constructor(xml: string) {
    const sheetData = xml.match(/<sheetData\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetData>)/);
    if (!sheetData || sheetData.index === undefined) throw new Error('目标工作表缺少 sheetData');
    const whole = sheetData[0];
    const inner = whole.startsWith('<sheetData') && whole.endsWith('/>') ? '' : whole.replace(/^<sheetData\b[^>]*>/, '').replace(/<\/sheetData>$/, '');
    const rowMatches = inner.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];
    for (const rowXml of rowMatches) {
      const rowNumber = Number(attributes(rowXml).r);
      if (Number.isInteger(rowNumber)) this.rows.push({ number: rowNumber, xml: rowXml });
    }
    const open = whole.match(/^<sheetData\b[^>]*>/)?.[0] || '<sheetData>';
    this.prefix = xml.slice(0, sheetData.index) + open;
    this.suffix = '</sheetData>' + xml.slice(sheetData.index + whole.length);
  }

  private row(number: number): RowPart | undefined { return this.rows.find(row => row.number === number); }

  private putRow(part: RowPart): void {
    const index = this.rows.findIndex(row => row.number === part.number);
    if (index >= 0) this.rows[index] = part;
    else this.rows.push(part);
    this.rows.sort((a, b) => a.number - b.number);
  }

  private cell(row: RowPart, address: string): string | undefined {
    return row.xml.match(new RegExp(`<c\\b[^>]*\\br=["']${address}["'][^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0];
  }

  set(assignment: XlsxCellAssignment): void {
    const { row: rowNumber } = addressParts(assignment.address);
    let row = this.row(rowNumber);
    if (!row) {
      const styleRow = assignment.rowStyleSource ? this.row(assignment.rowStyleSource) : undefined;
      row = { number: rowNumber, xml: styleRow ? cloneRowStyle(styleRow, rowNumber) : `<row r="${rowNumber}"></row>` };
    }
    let cell = this.cell(row, assignment.address);
    if (!cell && assignment.styleSource) {
      const sourceAddress = addressParts(assignment.styleSource);
      const sourceRow = this.row(sourceAddress.row);
      const sourceCell = sourceRow && this.cell(sourceRow, assignment.styleSource);
      if (sourceCell) {
        const opening = sourceCell.match(/^<c\b[^>]*>/)?.[0] || `<c r="${assignment.styleSource}"/>`;
        cell = replaceAttribute(opening, 'r', assignment.address);
      }
    }
    const rendered = renderCell(assignment.address, cell || null, assignment.value);
    if (cell) row.xml = row.xml.replace(cell, rendered);
    else {
      const rowOpen = row.xml.match(/^<row\b[^>]*>/)?.[0] || `<row r="${rowNumber}">`;
      const cells = [...row.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(match => match[0]);
      cells.push(rendered);
      cells.sort((a, b) => addressParts(attributes(a).r).col - addressParts(attributes(b).r).col);
      row.xml = rowOpen.replace(/\/>$/, '>') + cells.join('') + '</row>';
    }
    this.putRow(row);
  }

  toString(): string {
    const body = this.rows.map(row => row.xml).join('');
    const output = this.prefix + body + this.suffix;
    const maxRow = Math.max(1, ...this.rows.map(row => row.number));
    const maxCol = Math.max(1, ...this.rows.flatMap(row => [...row.xml.matchAll(/<c\b[^>]*\br=["']([A-Z]+)\d+["']/g)].map(match => addressParts(match[1] + '1').col)));
    return output.replace(/<dimension\b[^>]*\bref=["'][^"']*["'][^>]*\/>/, `<dimension ref="A1:${columnName(maxCol)}${maxRow}"/>`);
  }
}

function resolvePackagePath(baseDirectory: string, target: string): string {
  const normalized = target.replace(/\\/g, '/');
  const path = normalized.startsWith('/') ? normalized.slice(1) : `${baseDirectory}/${normalized}`;
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

function worksheetEntries(workbookXml: string, relsXml: string): { name: string; path: string }[] {
  const relationships = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]);
  return [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map(match => {
    const sheet = match[0];
    const name = attributes(sheet).name;
    const relationId = attributes(sheet)['r:id'] || attributes(sheet).id;
    const relation = relationships.find(xml => attributes(xml).Id === relationId);
    const target = relation ? attributes(relation).Target : '';
    if (!target) throw new Error(`工作表 ${name} 缺少文件关系`);
    return { name, path: resolvePackagePath('xl', target) };
  });
}

function worksheetPath(workbookXml: string, relsXml: string, sheetName: string): string {
  const sheets = worksheetEntries(workbookXml, relsXml);
  const sheet = sheets.find(entry => entry.name === sheetName);
  if (!sheet) throw new Error(`模板中未找到工作表: ${sheetName}`);
  return sheet.path;
}

/** 修改目标单元格及循环影响到的引用范围；宏、媒体和未知扩展等无关 ZIP 部件原样保留。 */
export async function writeXlsxPreservingPackage(
  fileBlob: Buffer,
  sheetName: string,
  assignments: XlsxCellAssignment[],
): Promise<Buffer> {
  const zip = await new PizZip().load(fileBlob);
  const workbook = zip.file('xl/workbook.xml')?.asText();
  const rels = zip.file('xl/_rels/workbook.xml.rels')?.asText();
  if (!workbook || !rels) throw new Error('无效的 xlsx 模板：缺少工作簿关系');
  const sheets = worksheetEntries(workbook, rels);
  const path = worksheetPath(workbook, rels, sheetName);
  const source = zip.file(path)?.asText();
  if (!source) throw new Error(`模板中未找到工作表文件: ${sheetName}`);
  const effectiveAssignments = assignments.filter(assignment => assignment.value !== undefined && assignment.value !== null);
  const expansions = inferExpansions(effectiveAssignments);
  const editor = new SheetEditor(source);
  for (const assignment of effectiveAssignments) editor.set(assignment);
  zip.file(path, expandWorksheetXml(editor.toString(), sheetName, sheetName, expansions));

  if (expansions.length > 0) {
    // 其他工作表只扩展显式指向目标表的公式；本表公式和范围属性已在上面处理。
    for (const sheet of sheets) {
      if (sheet.path === path) continue;
      const xml = zip.file(sheet.path)?.asText();
      if (!xml) continue;
      const expanded = expandWorksheetXml(xml, sheet.name, sheetName, expansions);
      if (expanded !== xml) zip.file(sheet.path, expanded);
    }
    const expandedWorkbook = expandFormulaTags(workbook, '', sheetName, expansions);
    if (expandedWorkbook !== workbook) zip.file('xl/workbook.xml', expandedWorkbook);
    for (const partName of Object.keys((zip as unknown as { files: Record<string, unknown> }).files).filter(name => /^xl\/pivotCache\/pivotCacheDefinition[^/]*\.xml$/.test(name))) {
      const xml = zip.file(partName)?.asText();
      if (!xml) continue;
      const expanded = expandPivotCacheXml(xml, sheetName, expansions);
      if (expanded !== xml) zip.file(partName, expanded);
    }
  }
  return await zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
