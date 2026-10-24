/**
 * 月度总结与课程规划 → 可下载的图片卡片（PNG）。
 *
 * 纯前端 canvas 实现，复用 canvasCard 的画布公共层。
 * 老师填完一块报告后，可以出一张能直接转发给家长的长图：
 * 上月上了什么、下月怎么排、老师寄语，都在一张图里。
 *
 * 高度计算和实际绘制共用同一份「段落」数据结构，
 * 先量高再画，避免页脚或末行被裁掉。
 */
import {
  CARD_WIDTH,
  PAD,
  FONT,
  COLORS,
  wrapText,
  RULE_BEFORE,
  RULE_AFTER,
  FOOTER_HEIGHT,
  paintChrome,
  drawRule,
  paintFooter,
} from './canvasCard';

/** 一条课程 / 阶测文案（版面上不再有课程日期，条目只留文字） */
export interface ReportCardEntry {
  text: string;
  /** 阶测等需要强调的条目，用红色 + ★ 前缀 */
  highlight?: boolean;
}

export interface ReportCardBlock {
  heading: string;
  intro?: string;
  entries?: ReportCardEntry[];
}

export interface ReportCardInput {
  /** 顶部标题，通常就是学生姓名 */
  title?: string;
  /** 标题下的信息行，如「秋季初二物理 · 2026年10月」 */
  meta?: string;
  blocks: ReportCardBlock[];
  /** 结尾寄语，单独隔一条分隔线放在最下面 */
  farewell?: string;
  /** 页脚小字（水印） */
  watermark?: string;
}

/* 字号与行高（量高与绘制共用） */
const TITLE_FONT = '600 34px ' + FONT;
const META_FONT = '400 22px ' + FONT;
const HEADING_FONT = '600 28px ' + FONT;
const BODY_FONT = '400 24px ' + FONT;
const ENTRY_FONT = '400 24px ' + FONT;
const FAREWELL_FONT = '500 24px ' + FONT;

const TITLE_H = 44;
const META_H = 28;
const HEADING_H = 42;
const LINE_H = 34;
const PARA_GAP = 14;
const BLOCK_GAP = 30;
const INDENT = 12;
const FAREWELL_COLOR = '#dc2626';
const ENTRY_COLOR = '#475569';

interface Para {
  text: string;
  color: string;
  font: string;
  indent: number;
  lines: string[];
}

/** 条目渲染成一行文本：`· 课程内容` / `★ 阶测安排` */
export function entryText(entry: ReportCardEntry): string {
  const body = (entry.text || '').trim();
  if (!body) return '';
  return (entry.highlight ? '★ ' : '· ') + body;
}

function blockParas(block: ReportCardBlock): Para[] {
  const paras: Para[] = [];
  const intro = (block.intro || '').trim();
  if (intro) {
    paras.push({ text: intro, color: COLORS.sub, font: BODY_FONT, indent: INDENT, lines: [] });
  }
  for (const entry of block.entries || []) {
    const text = entryText(entry);
    if (!text) continue;
    paras.push({
      text,
      color: entry.highlight ? FAREWELL_COLOR : ENTRY_COLOR,
      font: ENTRY_FONT,
      indent: INDENT,
      lines: [],
    });
  }
  return paras;
}

function measure(ctx: CanvasRenderingContext2D, paras: Para[], maxWidth: number): { paras: Para[]; height: number } {
  const measured = paras.map((p) => ({ ...p, lines: wrapText(ctx, p.text, maxWidth - p.indent, p.font) }));
  const height = measured.reduce(
    (h, p, i) => h + p.lines.length * LINE_H + (i < measured.length - 1 ? PARA_GAP : 0),
    0
  );
  return { paras: measured, height };
}

function drawParas(ctx: CanvasRenderingContext2D, paras: Para[], cy: number, maxWidth: number): number {
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    ctx.font = p.font;
    ctx.fillStyle = p.color;
    ctx.textBaseline = 'top';
    for (const line of p.lines) {
      ctx.fillText(line, PAD + p.indent, cy, maxWidth - p.indent);
    }
    cy += p.lines.length * LINE_H;
    if (i < paras.length - 1) cy += PARA_GAP;
  }
  return cy;
}

/** 把月度报告卡片画到指定 canvas（不缩放，1080 宽） */
export function drawReportCard(canvas: HTMLCanvasElement, input: ReportCardInput): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const maxWidth = CARD_WIDTH - PAD * 2;
  const measuredBlocks = input.blocks.map((b) => ({
    heading: b.heading,
    ...measure(ctx, blockParas(b), maxWidth),
  }));
  const farewellText = (input.farewell || '').trim();
  const farewellParas = farewellText
    ? [{ text: farewellText, color: FAREWELL_COLOR, font: FAREWELL_FONT, indent: 0, lines: [] }]
    : [];
  const measuredFarewell = farewellParas.length
    ? measure(ctx, farewellParas, maxWidth)
    : { paras: [], height: 0 };

  const titleLine = input.title || '月度总结与规划';
  const metaParts = (input.meta || '').split(' · ').filter(Boolean);

  // 每块的总高：标题 + 段落 + 块后间距（最后一块不加间距）。
  // 量高与绘制必须用同一份数组，否则两边会越走越偏。
  const blockTall = measuredBlocks.map(
    (b, i) => HEADING_H + b.height + (i < measuredBlocks.length - 1 ? BLOCK_GAP : 0)
  );

  // —— 量高：顶部占位必须镜像下面实际绘制 ——
  let H = PAD;
  H += TITLE_H + (metaParts.length ? META_H : 0);
  H += RULE_BEFORE + RULE_AFTER;
  for (const tall of blockTall) H += tall;
  if (measuredFarewell.paras.length) H += RULE_BEFORE + RULE_AFTER + measuredFarewell.height;
  H += FOOTER_HEIGHT;

  canvas.width = CARD_WIDTH;
  canvas.height = H;
  ctx.clearRect(0, 0, CARD_WIDTH, H);
  paintChrome(ctx, H);

  // —— 顶部 ——
  let cy = PAD;
  ctx.textBaseline = 'top';
  ctx.font = TITLE_FONT;
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(titleLine, PAD, cy, maxWidth);
  cy += TITLE_H;

  if (metaParts.length) {
    ctx.font = META_FONT;
    ctx.fillStyle = COLORS.sub;
    ctx.fillText(metaParts.join(' · '), PAD, cy, maxWidth);
    cy += META_H;
  }

  cy += RULE_BEFORE;
  drawRule(ctx, cy);
  cy += RULE_AFTER;

  // —— 各大块 ——
  measuredBlocks.forEach((block, i) => {
    ctx.font = HEADING_FONT;
    ctx.fillStyle = COLORS.ink;
    ctx.textBaseline = 'top';
    ctx.fillText('【' + block.heading + '】', PAD, cy, maxWidth);
    cy += HEADING_H;
    cy = drawParas(ctx, block.paras, cy, maxWidth);
    if (i < measuredBlocks.length - 1) cy += BLOCK_GAP;
  });

  // —— 寄语 ——
  if (measuredFarewell.paras.length) {
    cy += RULE_BEFORE;
    drawRule(ctx, cy);
    cy += RULE_AFTER;
    cy = drawParas(ctx, measuredFarewell.paras, cy, maxWidth);
  }

  // —— 页脚 ——
  paintFooter(ctx, H, input.watermark ?? '星火个性化教学 · 月度总结与课程规划');
}

/** 渲染为 dataURL（PNG） */
export function renderReportCardToDataUrl(input: ReportCardInput): string {
  const canvas = document.createElement('canvas');
  drawReportCard(canvas, input);
  return canvas.toDataURL('image/png');
}

/** 直接触发浏览器下载 */
export function downloadReportCard(input: ReportCardInput, filename = '月度报告.png'): void {
  const url = renderReportCardToDataUrl(input);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
