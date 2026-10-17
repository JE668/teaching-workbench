import { describe, it, expect, vi } from 'vitest';
import { drawFollowUpCard } from './followupCard';

/**
 * jsdom 的 canvas.getContext('2d') 默认返回 null，
 * 这里用一个只记录调用的 2d 上下文替身，验证：
 *   - 布局不崩、宽度固定 1080
 *   - 高度随正文段数增长
 *   - 三个段落标题都被绘制
 */
function stubContext(canvas: HTMLCanvasElement) {
  const calls: any[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textBaseline: 'top',
    font: '',
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn((...args: any[]) => calls.push(args)),
    measureText: vi.fn(() => ({ width: 12 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as any);
  return { ctx, calls };
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  return canvas;
}

describe('drawFollowUpCard', () => {
  it('宽度固定 1080，高度随段数增长', () => {
    const c1 = makeCanvas();
    stubContext(c1);
    const content1 = '【课堂内容】a\n【学生收获】b\n【课后任务】c';
    drawFollowUpCard(c1, { content: content1 });
    expect(c1.width).toBe(1080);
    const h1 = c1.height;
    expect(h1).toBeGreaterThan(0);

    // 单段正文 → 更矮
    const c2 = makeCanvas();
    stubContext(c2);
    drawFollowUpCard(c2, { content: '【课堂内容】只有课堂内容这一段' });
    expect(c2.height).toBeLessThan(h1);
  });

  it('三段标题都会画到画布上', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    const content = '【课堂内容】讲了分数\n【学生收获】会通分了\n【课后任务】做 5 题';
    drawFollowUpCard(canvas, { content, studentName: '小明', grade: '小学三年级', subject: '数学' });

    const text = calls.map((a) => a[0]).join('\n');
    expect(text).toContain('【课堂内容】');
    expect(text).toContain('【学生收获】');
    expect(text).toContain('【课后任务】');
    expect(text).toContain('小明');
    expect(text).toContain('数学');
    expect(text).toContain('小学三年级');
  });

  it('没有段落标记时整段正文作为"回访内容"展示', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    drawFollowUpCard(canvas, { content: '今天讲了分数加减法。' });
    const text = calls.map((a) => a[0]).join('\n');
    expect(text).toContain('【回访内容】');
  });
});
