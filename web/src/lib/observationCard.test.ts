import { describe, it, expect, vi } from 'vitest';
import { drawObservationCard, downloadObservationCard } from './observationCard';

const REPORT = [
  '【听课人评价】',
  '一、教学目标：目标清晰，聚焦通分能力。',
  '二、教学内容：容量适中。',
  '【综合评价与建议】',
  '一、本节课亮点：节奏把控好。',
  '二、总体评价等级：良好',
].join('\n');

/** jsdom 的 canvas.getContext('2d') 返回 null，这里用只记录调用的替身上下文 */
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
    measureText: vi.fn((t: string) => ({ width: t.length * 12 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as any);
  return { ctx, calls };
}

function drawnText(calls: any[]): string {
  return calls.map((a) => a[0]).join('\n');
}

describe('drawObservationCard', () => {
  it('宽度固定 1080，内容越长卡片越高', () => {
    const c1 = document.createElement('canvas');
    stubContext(c1);
    drawObservationCard(c1, { content: REPORT, teacherName: '王老师', dateLabel: '2026-10-17' });
    expect(c1.width).toBe(1080);
    const h1 = c1.height;

    const c2 = document.createElement('canvas');
    stubContext(c2);
    drawObservationCard(c2, { content: '【听课人评价】\n一、教学目标：好' });
    expect(c2.height).toBeGreaterThan(0);
    expect(c2.height).toBeLessThan(h1);
  });

  it('两大块标题、项标签、顶部信息全部上画布', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    drawObservationCard(canvas, {
      content: REPORT,
      teacherName: '王老师',
      topic: '分数的加法',
      dateLabel: '2026-10-17',
      gradeLabel: '良好',
    });

    const text = drawnText(calls);
    expect(text).toContain('听评课报告 · 王老师');
    expect(text).toContain('2026-10-17');
    expect(text).toContain('分数的加法');
    expect(text).toContain('等级 良好');
    expect(text).toContain('【听课人评价】');
    expect(text).toContain('【综合评价与建议】');
    expect(text).toContain('教学目标');
    expect(text).toContain('本节课亮点');
    expect(text).toContain('总体评价等级');
    expect(text).toContain('星火个性化教学');
  });

  it('切不出结构时仍画出报告原文，不留空图', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    drawObservationCard(canvas, { content: '今天听了一节课，讲得不错。' });
    const text = drawnText(calls);
    expect(text).toContain('【听课人评价】');
    expect(text).toContain('听课人评价');
    expect(text).toContain('今天听了一节课，讲得不错。');
  });

  it('没有 2d 上下文时安全返回，不抛错', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(() => drawObservationCard(canvas, { content: REPORT })).not.toThrow();
  });
});

describe('downloadObservationCard', () => {
  it('触发下载，文件名与 PNG dataURL 都设置好，用完即清理锚点', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA');
    const anchors: any[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: any) {
      anchors.push(this);
    });

    downloadObservationCard(
      { content: REPORT, teacherName: '王老师' },
      '听评课_王老师_分数的加法.png'
    );

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('听评课_王老师_分数的加法.png');
    expect(anchors[0].href).toBe('data:image/png;base64,AAA');
    expect(document.body.querySelectorAll('a').length).toBe(0);
  });
});
