import { describe, it, expect, vi } from 'vitest';
import { wrapText } from './canvasCard';

/** jsdom 没有真实 canvas，用一个只按字数算宽度的替身上下文 */
function ctx(widthPerChar = 12): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: vi.fn((t: string) => ({ width: t.length * widthPerChar })),
  } as unknown as CanvasRenderingContext2D;
}

describe('wrapText', () => {
  it('按宽度折行，折完不丢字', () => {
    // 每字 10px、容器 40px → 每行 4 个字
    const lines = wrapText(ctx(10), '一二三四五六七八九十', 40, 'x');
    expect(lines).toEqual(['一二三四', '五六七八', '九十']);
  });

  it('拉丁/数字连成一组，不在组内折断', () => {
    const input = '一二三四五 1234567890 六七八';
    const lines = wrapText(ctx(10), input, 30, 'x');
    expect(lines.join('')).toBe(input); // 不丢字
    expect(lines.some((l) => l.includes('1234567890'))).toBe(true); // 整串数字不被拆开
  });

  it('保留原文已有的换行', () => {
    expect(wrapText(ctx(1), '第一段\n第二段', 100, 'x')).toEqual(['第一段', '第二段']);
  });

  it('超长单行也能折完', () => {
    const lines = wrapText(ctx(10), '一二三四五六七八九十', 20, 'x');
    expect(lines.join('')).toBe('一二三四五六七八九十');
    expect(lines.length).toBe(5);
  });

  it('空文本返回一个空行（高度计算不至于算成 0 段）', () => {
    expect(wrapText(ctx(1), '', 100, 'x')).toEqual(['']);
  });
});
