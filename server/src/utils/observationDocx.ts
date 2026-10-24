import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { OBSERVATION_DIMENSIONS } from '../services/observation.js';

/**
 * 听评课 Word 导出。
 *
 * 套用用户提供的「星火个性化教学听评课表」模板
 * （server/templates/observation-template.docx，各填值格预埋 {{tag}} 占位符），
 * 把 AI 评课报告解析成 8 项 + 综合评价三块 + 等级 + 签名 后填充，保留模板原样字体与边框。
 *
 * 等级不是填空：模板里是「优秀（  ）良好（  ）合格（  ）有待提高（  ）」四个勾选位，
 * 命中的那个填「✓」，其余保留空格 —— 所以没有 {{grade}}，而是四个 grade_* 占位符。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cachedTemplate: Buffer | null = null;

/** 文档标题（文件名前缀，与模板大标题一致） */
export const DOCX_DOC_TITLE = '星火个性化教学听评课表';

/**
 * 编译产物落在 dist/utils/ 下，模板在 server/templates/。
 * 这条相对路径依赖 Dockerfile 把 templates/ 一并 COPY 进生产镜像 ——
 * 漏掉它时本地和测试环境都有文件、测试照样全绿，只有线上会 ENOENT，
 * 所以这里给出能直接定位原因的报错，而不是一个裸的 ENOENT。
 */
function templatePath(): string {
  return path.resolve(__dirname, '../../templates/observation-template.docx');
}

function loadTemplateBuffer(): Buffer {
  if (!cachedTemplate) {
    const p = templatePath();
    if (!fs.existsSync(p)) {
      throw new Error(
        'Word 模板缺失：' + p +
          '。请确认部署产物包含 server/templates/ 目录' +
          '（Dockerfile 需要 COPY --from=build /app/templates ./templates 这一步）。'
      );
    }
    cachedTemplate = fs.readFileSync(p);
  }
  return cachedTemplate;
}

// ====== 日期与文件名 ======

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 解析 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS' → { y, m, d }，解析不出返回 null。
 * 按位置切、不强依赖完整格式（库里偶有只写日期的老记录）。
 */
function splitDate(raw: string): { y: number; m: number; d: number } | null {
  const m = String(raw || '').trim().split(/\s+/)[0].match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!(y >= 1000 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return { y, m: mo, d };
}

/** 听课时间格：2026-10-17 → 26.10.17（两位年份） */
export function formatObservedAt(raw: string): string {
  const dt = splitDate(raw);
  if (!dt) return String(raw || '').trim();
  return String(dt.y % 100).padStart(2, '0') + '.' + pad2(dt.m) + '.' + pad2(dt.d);
}

/** 文件名里的日期：2026-10-17 → 10.17 */
export function formatDateForFilename(raw: string): string {
  const dt = splitDate(raw);
  return dt ? pad2(dt.m) + '.' + pad2(dt.d) : '';
}

/** 清掉 Windows 不接受的文件名字符（盘符、路径分隔符、通配符、引号等） */
function cleanForFilename(s: string): string {
  return String(s || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 文件名：星火个性化教学听评课表 10.17 周江凌.docx —— 第三段是**被听课老师**，不是评课人签名 */
export function buildDocxFilename(observedAt: string, teacherName: string): string {
  const date = formatDateForFilename(observedAt);
  const who = cleanForFilename(teacherName) || '被听课老师';
  return DOCX_DOC_TITLE + (date ? ' ' + date : '') + ' ' + who + '.docx';
}

// ====== 报告解析 ======

/** 压成一行（8 项评价、签名这类单行内容用） */
function norm(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** 保留段落换行：行内压空白，行与行之间保留，空行丢弃 */
function normLines(s: string): string {
  return String(s || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .replace(/^\s*|\s*$/g, '');
}

/** 行首编号：1. / 1、 / 一、 / (1) / （1）—— 每点独立成段后编号就多余了 */
const LEADING_NUM =
  /^\s*(?:[（(]\s*[0-9]{1,2}\s*[）)]|[0-9]{1,2}\s*[、.．)）]|[一二三四五六七八九十]{1,2}\s*[、.．])\s*/;

function stripLeadingNum(line: string): string {
  return line.replace(LEADING_NUM, '').trim();
}

export interface ParsedObservationReport {
  /** 8 项，顺序同 OBSERVATION_DIMENSIONS */
  items: string[];
  highlight: string;
  optimize: string;
  suggest: string;
  /** 解析出的中文等级（优秀/良好/合格/有待提高），解析不出为 '' */
  grade: string;
}

/** 把 AI 纯文本评课报告解析为可填模板的结构化字段（容错：缺项留空，不抛错） */
export function parseObservationReport(report: string): ParsedObservationReport {
  const text = report || '';
  const tailIdx = text.indexOf('【综合评价与建议】');
  const head = tailIdx >= 0 ? text.slice(0, tailIdx) : text;
  const tail = tailIdx >= 0 ? text.slice(tailIdx) : '';

  // 8 项：按维度名切片（值从该维度名后的冒号，到下一个维度名之前）
  const dims = OBSERVATION_DIMENSIONS as readonly string[];
  const items: string[] = dims.map((dim, i) => {
    const start = head.indexOf(dim);
    if (start < 0) return '';
    const afterName = start + dim.length;
    const cFull = head.indexOf('：', afterName);
    const cHalf = head.indexOf(':', afterName);
    const colon =
      cFull < 0 ? cHalf : cHalf < 0 ? cFull : Math.min(cFull, cHalf);
    const valueStart = colon >= 0 ? colon + 1 : afterName;
    const nextDim = i + 1 < dims.length ? head.indexOf(dims[i + 1]) : -1;
    const valueEnd = nextDim >= 0 ? nextDim : head.length;
    return norm(head.slice(valueStart, valueEnd));
  });

  // 综合三块：在尾段按标签名切片（值 = 本标签到下一标签之间，去掉尾部下一项的编号）
  const stripTailNum = (s: string) => s.replace(/\s*[一二三四1-9]\s*[、.]\s*$/, '').trim();
  const between = (a: string, b: string | null): string => {
    const ia = tail.indexOf(a);
    if (ia < 0) return '';
    const after = ia + a.length;
    let vstart = after;
    const cFull = tail.indexOf('：', after);
    const cHalf = tail.indexOf(':', after);
    const colon = cFull < 0 ? cHalf : cHalf < 0 ? cFull : Math.min(cFull, cHalf);
    if (colon >= 0) vstart = colon + 1;
    const ib = b ? tail.indexOf(b, after) : -1;
    const vend = ib >= 0 ? ib : tail.length;
    return stripTailNum(normLines(tail.slice(vstart, vend)));
  };

  const highlight = between('本节课亮点', '有待优化');
  const optimize = between('有待优化', '教学建议');
  const suggest = between('教学建议', '总体评价等级');

  const gmatch = tail.match(/总体评价等级[：:]\s*(优秀|良好|合格|有待提高)/);
  const grade = gmatch ? gmatch[1] : '';

  return { items, highlight, optimize, suggest, grade };
}

// ====== 填充 ======

/** 小五 = 9pt，OOXML 用半磅存储 */
const SMALL_FIVE = '18';

/** 勾选位未命中时保留的空格，视觉上与手写表一致 */
const UNCHECKED = '\u00a0';

export interface ObservationDocxData {
  teacher: string;
  /** 原始日期串（'YYYY-MM-DD'），内部格式化成 26.10.17 */
  time: string;
  topic: string;
  type: string;
  evals: string[];
  highlight: string;
  optimize: string;
  suggest: string;
  /** 等级代码：excellent / good / pass / needs_work */
  grade: string;
  signature: string;
}

/** 给 rPr 强制小五字号：先删掉已有的 sz/szCs 再插回，插入点在 w:u / w:lang / w:vertAlign
 * 之前以符合 rPr 子元素顺序；不动 rFonts，所以字体保持模板原样。 */
function forceSize(rpr: string): string {
  const sz = '<w:sz w:val="' + SMALL_FIVE + '"/><w:szCs w:val="' + SMALL_FIVE + '"/>';
  const stripped = rpr
    .replace(/<w:szCs w:val="\d+"\/>/g, '')
    .replace(/<w:sz w:val="\d+"\/>/g, '');
  const at = Math.min(
    stripped.indexOf('<w:u '),
    stripped.indexOf('<w:lang'),
    stripped.indexOf('<w:vertAlign')
  );
  return at < 0 ? stripped + sz : stripped.slice(0, at) + sz + stripped.slice(at);
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 在 run 内部强制小五，run 里的其它内容原样保留 */
function forceSizeInRun(run: string): string {
  const m = run.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/);
  if (!m) return run;
  const head = (m[0].match(/^<w:rPr\b[^>]*>/) || ['<w:rPr>'])[0];
  const inner = m[0].replace(/^<w:rPr\b[^>]*>/, '').replace(/<\/w:rPr>$/, '');
  return run.replace(m[0], head + forceSize(inner) + '</w:rPr>');
}

function runBounds(out: string, at: number): { s: number; e: number } | null {
  const s = Math.max(out.lastIndexOf('<w:r>', at), out.lastIndexOf('<w:r ', at));
  const e = out.indexOf('</w:r>', at);
  return s < 0 || e < 0 ? null : { s, e: e + '</w:r>'.length };
}

/** 取段落属性块（可能没有） */
function paraProps(para: string): string {
  const m = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  return m ? m[0] : '';
}

function paraBounds(out: string, at: number): { s: number; e: number } | null {
  const s = Math.max(out.lastIndexOf('<w:p>', at), out.lastIndexOf('<w:p ', at));
  const e = out.indexOf('</w:p>', at);
  return s < 0 || e < 0 ? null : { s, e: e + '</w:p>'.length };
}

/**
 * 就地替换：把 {{tag}} 换掉，保留同一 run / 同一段落里的其它文本。
 *
 * 等级勾选位必须走这条路 —— 「优秀（{{grade_excellent}}）良好（{{grade_good}}）」
 * 和整行说明文字挤在同一个 run 里，替换整个段落会把那行字一起删掉。
 */
function injectInline(out: string, tag: string, value: string): string {
  const marker = '{{' + tag + '}}';
  let guard = 0;
  while (out.indexOf(marker) >= 0 && guard++ < 64) {
    const i = out.indexOf(marker);
    const r = runBounds(out, i);
    if (!r) break;
    const run = forceSizeInRun(out.slice(r.s, r.e)).replace(marker, esc(value));
    out = out.slice(0, r.s) + run + out.slice(r.e);
  }
  return out;
}

/**
 * 拆段落：单行原位替换，多行拆成多个并列段落 —— 每点一段，
 * 不用「1、…2、…」硬挤在同一行。
 *
 * 只用于 {{highlight}} / {{optimize}} / {{suggest}}：模板里这三个占位符
 * 都独占一个段落、所在段落也只有这一个 run，所以可以用「段落属性 + 单个 run」重建。
 */
function injectParagraph(out: string, tag: string, lines: string[]): string {
  const marker = '{{' + tag + '}}';
  let guard = 0;
  while (out.indexOf(marker) >= 0 && guard++ < 64) {
    const i = out.indexOf(marker);
    const r = runBounds(out, i);
    const p = paraBounds(out, i);
    if (!r || !p) break;

    const run = out.slice(r.s, r.e);
    const rprMatch = run.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/);
    const head = (rprMatch && rprMatch[0].match(/^<w:rPr\b[^>]*>/)) || ['<w:rPr>'];
    const rprInner = rprMatch
      ? rprMatch[0].replace(/^<w:rPr\b[^>]*>/, '').replace(/<\/w:rPr>$/, '')
      : '';
    const runXml = (text: string) =>
      '<w:r>' + head[0] + forceSize(rprInner) + '</w:rPr>' +
      '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';

    const ppr = paraProps(out.slice(p.s, p.e));
    const paras = lines.length
      ? lines.map((line) => '<w:p>' + ppr + runXml(line) + '</w:p>')
      : ['<w:p>' + ppr + '</w:p>'];

    out = out.slice(0, p.s) + paras.join('') + out.slice(p.e);
  }
  return out;
}

/** 一行文本 → 「每点一段」的段落列表；空内容给空数组 */
function toLines(s: string): string[] {
  const raw = normLines(s);
  if (!raw) return [];
  return raw
    .split(/\n/)
    .map(stripLeadingNum)
    .filter((l) => l.length > 0);
}

/** 段落里没有任何 run（只有段落属性）→ 在 Word 里就是一行空白 */
function isEmptyPara(para: string): boolean {
  return !/<w:r[ >]/.test(para);
}

/** from 处或之后的第一个段落边界；from 正好落在段落起点时才会被后续调用采纳 */
function paraAt(s: string, from: number): { s: number; e: number } | null {
  const bare = s.indexOf('<w:p>', from);
  const attr = s.indexOf('<w:p ', from);
  const st = bare < 0 ? attr : attr < 0 ? bare : Math.min(bare, attr);
  if (st < 0) return null;
  const en = s.indexOf('</w:p>', st);
  return en < 0 ? null : { s: st, e: en + '</w:p>'.length };
}

/**
 * 删掉占位符段落某一侧紧挨着的空段落。
 *
 * 模板是人工在 Word 里排的，两类格子都残留了空段落（解压看 XML 才看得见）：
 *  - {{eval1}}~{{eval8}}：占位符**上方**各多一个空段落 → 填完每格顶部空一行
 *  - {{highlight}} / {{optimize}} / {{suggest}}：占位符**下方**各多两个空段落
 *    → 亮点、优化、建议三块之间被空行撑开
 *
 * 只认「与占位符同一个 <w:tc>、紧贴占位符段落、且里面没有任何 run」的段落；
 * 带文字的段落（三块上方的红色提示语、区块标题）一律不动，模板没有空段落时原样返回。
 *
 * 注意：不要用一个正则去匹配「空段落」——<w:pPr> 里的 [\s\S]*? 会在 pPr 之后
 * 紧跟不了 </w:p> 时继续向后扩张，越过段落边界把整段正文一起吞掉。
 * 这里按段落边界逐个取段、逐段判定，正则只用来数 run。
 */
function dropAdjacentEmptyParagraphs(
  out: string,
  marker: string,
  side: 'before' | 'after',
  keepEmpty: boolean = false
): string {
  const at = out.indexOf(marker);
  if (at < 0) return out;

  const tcStart = Math.max(out.lastIndexOf('<w:tc>', at), out.lastIndexOf('<w:tc ', at));
  const tcEnd = out.indexOf('</w:tc>', at);
  if (tcStart < 0 || tcEnd <= at) return out;

  const cell = out.slice(tcStart, tcEnd);
  const local = at - tcStart;
  const pStart = Math.max(cell.lastIndexOf('<w:p>', local), cell.lastIndexOf('<w:p ', local));
  if (pStart < 0) return out;

  if (side === 'before') {
    // 从占位符段落往前，逐个检查上一个段落是否为空
    let keepFrom = pStart;
    for (;;) {
      const prevEnd = cell.lastIndexOf('</w:p>', keepFrom - 1);
      if (prevEnd < 0) break;
      const prevStart = Math.max(cell.lastIndexOf('<w:p>', prevEnd), cell.lastIndexOf('<w:p ', prevEnd));
      if (prevStart < 0) break;
      if (!isEmptyPara(cell.slice(prevStart, prevEnd + '</w:p>'.length))) break;
      keepFrom = prevStart;
    }
    if (keepFrom === pStart) return out;
    return out.slice(0, tcStart + keepFrom) + out.slice(tcStart + pStart);
  }

  // after：从占位符段落末尾往后，逐个吃掉紧贴着的空段落
  // （keepEmpty 时先让过第一个空段落——那行是块与块之间的视觉留白）
  const pEnd = cell.indexOf('</w:p>', local) + '</w:p>'.length;
  let dropFrom = pEnd;
  if (keepEmpty) {
    const first = paraAt(cell, dropFrom);
    if (first && first.s === dropFrom && isEmptyPara(cell.slice(first.s, first.e))) {
      dropFrom = first.e;
    }
  }
  let dropTo = dropFrom;
  for (;;) {
    const next = paraAt(cell, dropTo);
    if (!next || next.s !== dropTo) break; // 必须紧贴占位符段落，中间不能有别的内容
    if (!isEmptyPara(cell.slice(next.s, next.e))) break;
    dropTo = next.e;
  }
  if (dropTo === dropFrom) return out;
  return out.slice(0, tcStart + dropFrom) + out.slice(tcStart + dropTo);
}

/**
 * 把包含 anchor 的那个 <w:tc> 内**连续的空段落压成一行**（保留一个）。
 *
 * 某个综合块为空时，injectParagraph 会把占位段落换成一个空段落，
 * 它紧跟着上一级留下的那行留白 → 空行翻倍。这里统一收口。
 */
function collapseEmptyRuns(out: string, cellAnchor: string): string {
  const at = out.indexOf(cellAnchor);
  if (at < 0) return out;
  const tcStart = Math.max(out.lastIndexOf('<w:tc>', at), out.lastIndexOf('<w:tc ', at));
  const tcEnd = out.indexOf('</w:tc>', at);
  if (tcStart < 0 || tcEnd <= at) return out;

  const cell = out.slice(tcStart, tcEnd);
  const kept: string[] = [];
  let prevEmpty = false;
  let dropped = false;
  let cursor = 0;
  for (;;) {
    const para = paraAt(cell, cursor);
    if (!para) break;
    const empty = isEmptyPara(cell.slice(para.s, para.e));
    if (empty && prevEmpty) {
      dropped = true; // 连续空行只留第一行
    } else {
      kept.push(cell.slice(para.s, para.e));
    }
    prevEmpty = empty;
    cursor = para.e;
  }
  if (!dropped) return out;
  return out.slice(0, tcStart) + kept.join('') + out.slice(tcEnd);
}

/** 渲染带占位符模板，返回已填充的 .docx（Node Buffer）。 */
export async function buildObservationDocx(d: ObservationDocxData): Promise<Buffer> {
  const zip = await new PizZip().load(loadTemplateBuffer());
  let xml = zip.file('word/document.xml').asText();

  // 模板里残留的空段落先清掉（评价格子上方各多一行、综合三块下方各多两行，
  // 不清就会把表格整体撑高）——详见 dropAdjacentEmptyParagraphs
  (d.evals || []).forEach((_, i) => {
    xml = dropAdjacentEmptyParagraphs(xml, '{{eval' + (i + 1) + '}}', 'before');
  });
  // 综合三块（亮点/优化/建议）之间保留一行空段当视觉留白：全删会挤成一片
  for (const tag of ['highlight', 'optimize', 'suggest']) {
    xml = dropAdjacentEmptyParagraphs(xml, '{{' + tag + '}}', 'after', true);
  }

  // 等级：命中的那个填 ✓，其余保留空格
  const check = (code: string) => (d.grade === code ? '✓' : UNCHECKED);

  const singles: Record<string, string> = {
    teacher: norm(d.teacher),
    time: formatObservedAt(d.time),
    topic: norm(d.topic),
    type: norm(d.type),
    signature: norm(d.signature),
    grade_excellent: check('excellent'),
    grade_good: check('good'),
    grade_pass: check('pass'),
    grade_needs: check('needs_work'),
  };
  (d.evals || []).forEach((v, i) => {
    singles['eval' + (i + 1)] = norm(v);
  });

  for (const [tag, value] of Object.entries(singles)) {
    xml = injectInline(xml, tag, value);
  }

  for (const [tag, lines] of Object.entries({
    highlight: toLines(d.highlight),
    optimize: toLines(d.optimize),
    suggest: toLines(d.suggest),
  })) {
    xml = injectParagraph(xml, tag, lines);
  }

  // 某块为空时会多出一个空段落，和上一级的留白粘成两行 → 压回一行
  xml = collapseEmptyRuns(xml, '综合评价与建议');

  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer' });
}
