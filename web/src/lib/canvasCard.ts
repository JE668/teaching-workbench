/**
 * 图片卡片的画布公共层：尺寸、字体、品牌色、CJK 折行、顶部装饰与页脚。
 *
 * 课后回访卡片与听评课卡片共用这一层——两处各写一份 wrapText 很容易
 * 出现"同一份内容、两张图排版不一致"，所以抽到这里。
 */

/** 画布宽度（1080 适合手机全屏显示 + 微信转发不糊） */
export const CARD_WIDTH = 1080;
export const PAD = 56;
export const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans CJK SC",sans-serif';

/** 顶部渐变色带高度（纯装饰） */
export const BAND_HEIGHT = 220;

/** 顶部信息与正文之间的分隔线上下留白 */
export const RULE_BEFORE = 20;
export const RULE_AFTER = 24;

/** 页脚高度（高度计算里要镜像占位，保证末行不被裁切） */
export const FOOTER_HEIGHT = 56;

/** 品牌色（与 Web 端视觉一致） */
export const COLORS = {
  accent: '#2563eb',
  accentSoft: '#eff6ff',
  ink: '#1e293b',
  sub: '#64748b',
  rule: '#e2e8f0',
  bg: '#ffffff',
  band: '#f8fafc',
};

/** 按给定宽度对文本换行（CJK 逐字 + 拉丁词成组，避免把 "123" 折断） */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
): string[] {
  ctx.font = font;
  const lines: string[] = [];
  // 先按已有的 \n 拆段，段内再按宽度折行
  for (const paragraph of text.split('\n')) {
    let line = '';
    let col = 0;
    for (let i = 0; i < paragraph.length; i++) {
      const ch = paragraph[i];
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
      if (ch === ' ') col += ctx.measureText(' ').width;
    }
    lines.push(line);
  }
  return lines;
}

/** 白底 + 顶部渐变色带 + 左侧品牌竖条 */
export function paintChrome(ctx: CanvasRenderingContext2D, height: number): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  const grad = ctx.createLinearGradient(0, 0, 0, BAND_HEIGHT);
  grad.addColorStop(0, COLORS.accentSoft);
  grad.addColorStop(1, COLORS.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_WIDTH, BAND_HEIGHT);

  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, 8, height);
}

/** 画一条顶部分隔线 */
export function drawRule(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(CARD_WIDTH - PAD, y);
  ctx.stroke();
}

/** 画页脚小字（水印） */
export function paintFooter(ctx: CanvasRenderingContext2D, height: number, watermark: string): void {
  ctx.font = '400 20px ' + FONT;
  ctx.fillStyle = COLORS.sub;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(watermark, PAD, height - 28, CARD_WIDTH - PAD * 2);
}
