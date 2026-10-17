/**
 * 把一条回访渲染成可下载的图片卡片（PNG）。
 *
 * 纯前端 canvas 实现，不写库。手机上点一下就能把这条反馈导出成
 * 一张排版好的图，直接发给家长 / 朋友圈存档，省去截图拼字。
 *
 * 用法：
 *   const dataUrl = await renderFollowUpCard(input);
 *   // 或
 *   await downloadFollowUpCard(input);
 */
import { sectionsForCard } from './sections';

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

/** 画布宽度（1080 适合手机全屏显示 + 微信转发不糊） */
const CARD_WIDTH = 1080;
const PAD = 56;
const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans CJK SC",sans-serif';

/** 段落占位常量（计算高度与实际绘制共用，避免页脚错位） */
const HEADING_LINE = 36; // 段标题行
const BODY_LINE = 40; // 正文行高
const SECTION_GAP = 16; // 段与段间距
// 顶部占位
const TOP_NAME_H = 40; // 称呼行（有称呼时）
const TOP_TITLE_H = 44; // 标题行
const TOP_META_H = 28; // 日期/主题行（有其一即占位）
const TOP_RULE_BEFORE = 20; // 分隔线上方留白
const TOP_RULE_AFTER = 24; // 分隔线下方留白

/** 品牌色（与 Web 端视觉一致） */
const COLORS = {
  accent: '#2563eb',
  accentSoft: '#eff6ff',
  ink: '#1e293b',
  sub: '#64748b',
  rule: '#e2e8f0',
  bg: '#ffffff',
  band: '#f8fafc',
};

/** 按给定宽度对文本换行（CJK 逐字 + 拉丁词成组） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  ctx.font = font;
  const lines: string[] = [];
  // 先按已有的 \n 拆段，段内再按宽度折行
  for (const paragraph of text.split('\n')) {
    let line = '';
    let col = 0;
    for (let i = 0; i < paragraph.length; i++) {
      const ch = paragraph[i];
      // 拉丁/数字连成 token 一起测宽，避免把 "123" 折断
      let token = ch;
      if (ch !== ' ' && /[a-zA-Z0-9%]/.test(ch)) {
        let j = i + 1;
        while (j < paragraph.length && /[a-zA-Z0-9.%]/.test(paragraph[j])) {
          token += paragraph[j];
          j++;
        }
        i = j - 1;
      }
      const w = ctx.measureText(token).width;
      if (col + w > maxWidth && line.length > 0) {
        lines.push(line);
        line = token;
        col = w;
      } else {
        line += token;
        col += w;
      }
      // 空格单独占位
      if (ch === ' ') col += ctx.measureText(' ').width;
    }
    lines.push(line);
  }
  return lines;
}

/** 计算一段标题 + 正文的渲染高度（与绘制循环共用同一套常量） */
function sectionBlockHeight(
  ctx: CanvasRenderingContext2D,
  body: string,
  maxWidth: number
): number {
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
  let topHeight = TOP_RULE_BEFORE + TOP_RULE_AFTER; // 分隔线（恒定）
  if (input.studentName) topHeight += TOP_NAME_H;
  topHeight += TOP_TITLE_H;
  if (input.dateLabel || input.topic) topHeight += TOP_META_H;

  const y0 = PAD;
  let contentHeight = 0;
  for (const s of sections) {
    contentHeight += sectionBlockHeight(ctx, s.body, maxWidth);
  }
  const footerHeight = 56;

  const H = y0 + topHeight + contentHeight + footerHeight;
  canvas.width = CARD_WIDTH;
  canvas.height = H;
  ctx.clearRect(0, 0, CARD_WIDTH, H);

  // 背景
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, H);
  // 顶部色带
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, COLORS.accentSoft);
  grad.addColorStop(1, COLORS.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_WIDTH, 220);
  // 左侧品牌竖条
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, 8, H);

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
  cy += TOP_RULE_BEFORE;
  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, cy);
  ctx.lineTo(CARD_WIDTH - PAD, cy);
  ctx.stroke();
  cy += TOP_RULE_AFTER;

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
  ctx.font = '400 20px ' + FONT;
  ctx.fillStyle = COLORS.sub;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(input.watermark ?? '1对1教学工作台', PAD, H - 28, maxWidth);
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
