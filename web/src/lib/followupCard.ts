/**
 * 把一条回访渲染成可下载的图片卡片（PNG）。
 *
 * 纯前端 canvas 实现，不写库。手机上点一下就能把这条反馈导出成
 * 一张排版好的图，直接发给家长 / 朋友圈存档，省去截图拼字。
 *
 * 画布尺寸、字体、品牌色、折行、色带、页脚统一来自 ./canvasCard。
 */
import { sectionsForCard } from './sections';
import {
  CARD_WIDTH,
  PAD,
  FONT,
  COLORS,
  wrapText,
  RULE_BEFORE,
  RULE_AFTER,
  paintChrome,
  drawRule,
  paintFooter,
} from './canvasCard';

export interface FollowUpCardInput {
  /** 顶部标题，默认 "课后回访" */
  title?: string;
  /** 科目，如 "数学" */
  subject?: string;
  /** 年级，如 "小学三年级" */
  grade?: string;
  /** 学生称呼（1对1 时显示；小组课可留空） */
  studentName?: string;
  /** 课程主题 */
  topic?: string;
  /** 日期文字，如 "2026-10-17" */
  dateLabel?: string;
  /** 回访正文：自动按【课堂内容】【学生收获】【课后任务】拆段 */
  content: string;
  /** 页脚小字（水印），默认 "1对1教学工作台" */
  watermark?: string;
}

/** 段落占位常量（计算高度与实际绘制共用，避免页脚错位） */
const HEADING_LINE = 36; // 段标题行
const BODY_LINE = 40; // 正文行高
const SECTION_GAP = 16; // 段与段间距
// 顶部占位
const TOP_NAME_H = 40; // 称呼行（有称呼时）
const TOP_TITLE_H = 44; // 标题行
const TOP_META_H = 28; // 日期/主题行（有其一即占位）

/** 计算一段标题 + 正文的渲染高度（与绘制循环共用同一套常量） */
function sectionBlockHeight(ctx: CanvasRenderingContext2D, body: string, maxWidth: number): number {
  const lines = wrapText(ctx, body, maxWidth, '400 26px ' + FONT);
  return HEADING_LINE + lines.length * BODY_LINE + SECTION_GAP;
}

/** 把卡片画到指定 canvas（不缩放，1080 宽） */
export function drawFollowUpCard(canvas: HTMLCanvasElement, input: FollowUpCardInput): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const sections = sectionsForCard(input.content);
  const maxWidth = CARD_WIDTH - PAD * 2;

  // 计算总高（顶部占位镜像下方实际绘制，保证页脚/末行不被裁切）
  let topHeight = RULE_BEFORE + RULE_AFTER; // 分隔线（恒定）
  if (input.studentName) topHeight += TOP_NAME_H;
  topHeight += TOP_TITLE_H;
  if (input.dateLabel || input.topic) topHeight += TOP_META_H;

  const y0 = PAD;
  let contentHeight = 0;
  for (const s of sections) {
    contentHeight += sectionBlockHeight(ctx, s.body, maxWidth);
  }

  const H = y0 + topHeight + contentHeight + 56; // 56 = 页脚高度
  canvas.width = CARD_WIDTH;
  canvas.height = H;
  ctx.clearRect(0, 0, CARD_WIDTH, H);

  paintChrome(ctx, H);

  // —— 顶部 ——
  let cy = PAD;
  const titleLine = [input.title ?? '课后回访', input.subject, input.grade].filter(Boolean).join(' · ');
  if (input.studentName) {
    ctx.font = '500 34px ' + FONT;
    ctx.fillStyle = COLORS.ink;
    ctx.textBaseline = 'top';
    ctx.fillText(input.studentName, PAD, cy, maxWidth);
    cy += TOP_NAME_H;
  }
  ctx.font = '600 30px ' + FONT;
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(titleLine || '课后回访', PAD, cy, maxWidth);
  cy += TOP_TITLE_H;

  if (input.dateLabel || input.topic) {
    ctx.font = '400 22px ' + FONT;
    ctx.fillStyle = COLORS.sub;
    const subLine = [input.dateLabel, input.topic].filter(Boolean).join('  ·  ');
    ctx.fillText(subLine, PAD, cy, maxWidth);
    cy += TOP_META_H;
  }

  // 分隔线
  cy += RULE_BEFORE;
  drawRule(ctx, cy);
  cy += RULE_AFTER;

  // —— 各段 ——
  for (const s of sections) {
    // 段标题
    ctx.font = '600 28px ' + FONT;
    ctx.fillStyle = COLORS.ink;
    ctx.textBaseline = 'top';
    ctx.fillText('【' + s.heading + '】', PAD, cy, maxWidth);
    cy += HEADING_LINE;

    // 正文（折行）
    ctx.font = '400 26px ' + FONT;
    ctx.fillStyle = COLORS.sub;
    const lines = wrapText(ctx, s.body, maxWidth, '400 26px ' + FONT);
    for (const ln of lines) {
      ctx.fillText(ln, PAD, cy, maxWidth);
      cy += BODY_LINE;
    }
    cy += SECTION_GAP;
  }

  // —— 页脚 ——
  paintFooter(ctx, H, input.watermark ?? '1对1教学工作台');
}

/** 渲染为 dataURL（PNG） */
export function renderFollowUpCardToDataUrl(input: FollowUpCardInput): string {
  const canvas = document.createElement('canvas');
  drawFollowUpCard(canvas, input);
  return canvas.toDataURL('image/png');
}

/** 直接触发浏览器下载 */
export function downloadFollowUpCard(input: FollowUpCardInput): void {
  const url = renderFollowUpCardToDataUrl(input);
  const a = document.createElement('a');
  a.href = url;
  const stamp = input.studentName ? input.studentName : input.dateLabel ?? 'followup';
  a.download = `${(input.subject ?? '课程')}_${stamp}_${(input.title ?? '回访').slice(0, 8) || 'card'}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
