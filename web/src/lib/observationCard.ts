/**
 * 听评课报告 → 可下载的图片卡片（PNG）。
 *
 * 纯前端 canvas 实现，不写库。校长 / 教研组要一份能直接转发或打印的
 * 评课结果时，不用去 Word 里排版。
 */
import { parseObservationBlocks } from './observation';
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

export interface ObservationCardInput {
  /** 顶部标题，默认 "听评课报告" */
  title?: string;
  /** 报告正文（AI 生成的纯文本），自动按 8 项 + 综合评价四块拆段 */
  content: string;
  /** 被听课老师，如 "王老师" */
  teacherName?: string;
  /** 课题 */
  topic?: string;
  /** 听课日期文字，如 "2026-10-17" */
  dateLabel?: string;
  /** 总体评价等级（优秀 / 良好 / …），显示在顶部信息行 */
  gradeLabel?: string;
  /** 页脚小字（水印） */
  watermark?: string;
}

/* 字号与行高（高度计算与实际绘制共用，避免页脚/末行被裁切） */
const TITLE_FONT = '600 30px ' + FONT;
const META_FONT = '400 22px ' + FONT;
const BLOCK_FONT = '600 28px ' + FONT;
const ITEM_LABEL_FONT = '600 24px ' + FONT;
const ITEM_BODY_FONT = '400 24px ' + FONT;

const TITLE_H = 40;
const META_H = 28;
const BLOCK_HEADING_H = 40;
const ITEM_LABEL_H = 30;
const ITEM_BODY_LINE = 32;
const ITEM_GAP = 12;
const BLOCK_GAP = 26;

/** 计算一个大块（标题 + 若干"标签 + 内容"）的渲染高度 */
function blockHeight(ctx: CanvasRenderingContext2D, block: { items: { value: string }[] }, maxWidth: number): number {
  let h = BLOCK_HEADING_H;
  for (const item of block.items) {
    h += ITEM_LABEL_H;
    h += wrapText(ctx, item.value, maxWidth, ITEM_BODY_FONT).length * ITEM_BODY_LINE;
    h += ITEM_GAP;
  }
  return h + (block.items.length ? -ITEM_GAP + BLOCK_GAP : 0);
}

/** 把评课报告卡片画到指定 canvas（不缩放，1080 宽） */
export function drawObservationCard(canvas: HTMLCanvasElement, input: ObservationCardInput): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const blocks = parseObservationBlocks(input.content);
  const maxWidth = CARD_WIDTH - PAD * 2;

  const titleLine = [input.title ?? '听评课报告', input.teacherName].filter(Boolean).join(' · ');
  const metaParts = [
    input.dateLabel,
    input.topic,
    input.gradeLabel ? '等级 ' + input.gradeLabel : '',
  ].filter(Boolean);

  // 顶部占位镜像下方实际绘制
  let topHeight = RULE_BEFORE + RULE_AFTER;
  topHeight += TITLE_H;
  if (metaParts.length) topHeight += META_H;

  let contentHeight = 0;
  for (const block of blocks) contentHeight += blockHeight(ctx, block, maxWidth);

  const H = PAD + topHeight + contentHeight + FOOTER_HEIGHT;
  canvas.width = CARD_WIDTH;
  canvas.height = H;
  ctx.clearRect(0, 0, CARD_WIDTH, H);

  paintChrome(ctx, H);

  // —— 顶部 ——
  let cy = PAD;
  ctx.textBaseline = 'top';
  ctx.font = TITLE_FONT;
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(titleLine || '听评课报告', PAD, cy, maxWidth);
  cy += TITLE_H;

  if (metaParts.length) {
    ctx.font = META_FONT;
    ctx.fillStyle = COLORS.sub;
    ctx.fillText(metaParts.join('  ·  '), PAD, cy, maxWidth);
    cy += META_H;
  }

  cy += RULE_BEFORE;
  drawRule(ctx, cy);
  cy += RULE_AFTER;

  // —— 各大块 ——
  for (const block of blocks) {
    ctx.font = BLOCK_FONT;
    ctx.fillStyle = COLORS.ink;
    ctx.textBaseline = 'top';
    ctx.fillText('【' + block.heading + '】', PAD, cy, maxWidth);
    cy += BLOCK_HEADING_H;

    for (const item of block.items) {
      ctx.font = ITEM_LABEL_FONT;
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(item.label, PAD + 10, cy, maxWidth - 10);
      cy += ITEM_LABEL_H;

      ctx.font = ITEM_BODY_FONT;
      ctx.fillStyle = COLORS.sub;
      const lines = wrapText(ctx, item.value, maxWidth - 10, ITEM_BODY_FONT);
      for (const line of lines) {
        ctx.fillText(line, PAD + 10, cy, maxWidth - 10);
        cy += ITEM_BODY_LINE;
      }
      cy += ITEM_GAP;
    }
    cy += BLOCK_GAP - ITEM_GAP;
  }

  // —— 页脚 ——
  paintFooter(ctx, H, input.watermark ?? '星火个性化教学 · 听评课报告');
}

/** 渲染为 dataURL（PNG） */
export function renderObservationCardToDataUrl(input: ObservationCardInput): string {
  const canvas = document.createElement('canvas');
  drawObservationCard(canvas, input);
  return canvas.toDataURL('image/png');
}

/** 直接触发浏览器下载 */
export function downloadObservationCard(
  input: ObservationCardInput,
  filename = '听评课_报告.png'
): void {
  const url = renderObservationCardToDataUrl(input);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
