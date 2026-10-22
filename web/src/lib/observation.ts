/**
 * 听评课报告（纯文本）的复制/导出工具。
 *
 * 报告由 AI 生成，结构为：
 *   【听课人评价】
 *   一、… 二、… 八、…
 *   【综合评价与建议】
 *   · 亮点 / 待优化 / 建议 / 总体评价等级
 * 这里只做"切块"，供前端按需复制进 Word；切不出就退化为整份。
 */

/** 把报告拆成"听课人评价"（8 项）与"综合评价与建议"两大块。 */
export function splitReport(report: string): { head: string; tail: string } {
  const idx = report.indexOf('【综合评价与建议】');
  const rawHead = idx >= 0 ? report.slice(0, idx) : report;
  const head = rawHead.replace('【听课人评价】', '').trim();
  const tail = idx >= 0 ? report.slice(idx).trim() : '';
  return { head, tail };
}

/** 文档标题（与 Word 导出的大标题、文件名前缀一致） */
export const DOCX_DOC_TITLE = '星火个性化教学听评课表';

/** 导出文件名：星火个性化教学听评课表 10.17 周江凌.txt
 *
 * 第三段是**被听课老师**的姓名，不是评课人签名；日期取听课日期的 MM.DD。
 * txt / png / docx 三种导出统一用这个命名（docx 由后端生成，这里只在
 * 后端没给文件名时兜底，口径必须一致）。
 */
export function buildReportFilename(teacher: string, observedAt: string, ext = 'txt'): string {
  const date = dateForFilename(observedAt);
  const who = cleanForFilename(teacher) || '被听课老师';
  return DOCX_DOC_TITLE + (date ? ' ' + date : '') + ' ' + who + '.' + ext;
}

function cleanForFilename(s: string): string {
  return String(s || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 听课日期 → 文件名里的 10.17；解析不出返回空串（不硬塞空格） */
export function dateForFilename(raw: string): string {
  const m = String(raw || '')
    .trim()
    .split(/\s+/)[0]
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return '';
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return p(mo) + '.' + p(d);
}

/* ─────────── 评课报告图片卡片：结构化切块 ─────────── */

/** AI 评课的 8 个评价维度（顺序与提示词一致） */
export const OBSERVATION_DIMENSIONS: readonly string[] = [
  '教学目标',
  '教学内容',
  '教学方法',
  '学生参与度与学习状态',
  '教学过程',
  '教师素养',
  '教学效果',
  '特色与创新',
];

/** 【综合评价与建议】里的四块标签，顺序与提示词一致 */
const TAIL_LABELS: readonly string[] = ['本节课亮点', '有待优化', '教学建议', '总体评价等级'];

export interface CardBlockItem {
  /** 项标签，如「教学目标」「本节课亮点」 */
  label: string;
  /** 项内容（纯文本，已压缩空白） */
  value: string;
}

export interface CardBlock {
  /** 大块标题，如「听课人评价」「综合评价与建议」 */
  heading: string;
  items: CardBlockItem[];
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 去掉值末尾"下一块"的编号尾巴（如 "...内容 二、" → "...内容"） */
function stripTailNum(s: string): string {
  return s.replace(/\s*[一二三四五六七八九十]+\s*[、.]\s*$/, '').trim();
}

/** 在 hay 里从 from 开始找"下一个出现过的标签"的位置；一个都没有返回 -1 */
function findNextLabel(hay: string, from: number, labels: readonly string[]): number {
  let best = -1;
  for (const label of labels) {
    const at = hay.indexOf(label, from);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

/**
 * 取 text 里"标签名之后的冒号"到 end 之间的值。
 * end 传 -1 表示取到文本末尾；冒号越界时退化为直接取原文。
 */
function sliceValue(text: string, label: string, after: number, end: number): string {
  const stop = end >= 0 ? end : text.length;
  const cFull = text.indexOf('：', after);
  const cHalf = text.indexOf(':', after);
  const colon = cFull < 0 ? cHalf : cHalf < 0 ? cFull : Math.min(cFull, cHalf);
  const vstart = colon >= 0 && colon < stop ? colon + 1 : after;
  return norm(text.slice(vstart, stop));
}

/**
 * 把 AI 纯文本评课报告切成卡片用的大块（容错：缺项跳过、切不出就退化，
 * 保证不丢内容也不抛错）。
 */
export function parseObservationBlocks(report: string): CardBlock[] {
  const text = report || '';
  const idx = text.indexOf('【综合评价与建议】');
  const head = idx >= 0 ? text.slice(0, idx) : text;
  const tail = idx >= 0 ? text.slice(idx) : '';

  const blocks: CardBlock[] = [];

  // —— 8 项评价维度 ——
  const items: CardBlockItem[] = [];
  for (let i = 0; i < OBSERVATION_DIMENSIONS.length; i++) {
    const label = OBSERVATION_DIMENSIONS[i];
    const at = head.indexOf(label);
    if (at < 0) continue;
    // 找"后面真正出现过的维度"，缺项不会把下一项的正文吞进来
    const next = findNextLabel(head, at + label.length, OBSERVATION_DIMENSIONS.slice(i + 1));
    let value = sliceValue(head, label, at, next < 0 ? -1 : next);
    if (next >= 0) value = stripTailNum(value);
    if (value) items.push({ label, value });
  }
  const cleanHead = head.replace(/【[^】]*】/g, '').trim();
  if (!items.length && cleanHead) items.push({ label: '听课人评价', value: cleanHead });
  if (items.length) blocks.push({ heading: '听课人评价', items });

  // —— 综合评价与建议 ——
  const tailItems: CardBlockItem[] = [];
  for (let i = 0; i < TAIL_LABELS.length; i++) {
    const label = TAIL_LABELS[i];
    const at = tail.indexOf(label);
    if (at < 0) continue;
    // 找"后面真正出现过的标签"，缺项不会把下一块的正文吞进来
    const next = findNextLabel(tail, at + label.length, TAIL_LABELS.slice(i + 1));
    let value = sliceValue(tail, label, at, next < 0 ? -1 : next);
    if (next >= 0) value = stripTailNum(value);
    if (value) tailItems.push({ label, value });
  }
  const cleanTail = tail.replace(/【[^】]*】/g, '').trim();
  if (!tailItems.length && cleanTail) tailItems.push({ label: '综合评价', value: cleanTail });
  if (tailItems.length) blocks.push({ heading: '综合评价与建议', items: tailItems });

  // —— 整份都切不出来时，退化为一个大块，保证图上不空 ——
  if (!blocks.length && text.trim()) {
    blocks.push({ heading: '评课报告', items: [{ label: '报告内容', value: text.trim() }] });
  }
  return blocks;
}
