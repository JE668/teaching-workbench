import { describe, it, expect, vi } from 'vitest';
import { drawReportCard, downloadReportCard, mmdd, entryText } from './reportCard';

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

const FULL = {
  title: '一可',
  meta: '秋季初二物理 · 2026年10月',
  blocks: [
    {
      heading: '9月总结',
      intro: '9月整体学习情况：出勤正常，笔记整理完成。',
      entries: [
        { date: '2026-09-06', text: '平面镜成像规律和透镜认识' },
        { date: '2026-09-13', text: '凸透镜成像的规律探究' },
      ],
    },
    {
      heading: '10月规划',
      intro: '国庆期间安排3节课，巩固透镜的规律应用。',
      entries: [
        { date: '2026-10-01', text: '凸透镜成像的规律应用' },
        { date: '2026-10-07', text: '秋季度第一次阶测安排', highlight: true },
        { date: '2026-10-18', text: '质量和体积的测量和关系' },
      ],
    },
  ],
  farewell: '感谢一可一整个学期的坚持和努力，继续保持！',
};

describe('mmdd', () => {
  it('标准日期转成 MM.DD', () => {
    expect(mmdd('2026-09-06')).toBe('09.06');
    expect(mmdd('2026-12-25')).toBe('12.25');
  });

  it('单位数补零', () => {
    expect(mmdd('2026-1-5')).toBe('01.05');
  });

  it('拿不到日期就返回空串', () => {
    expect(mmdd('')).toBe('');
    expect(mmdd(undefined)).toBe('');
    expect(mmdd('2026年9月6日')).toBe('');
  });
});

describe('entryText', () => {
  it('课程行用「· 日期  内容」', () => {
    expect(entryText({ date: '2026-09-06', text: '凸透镜成像' })).toBe('· 09.06  凸透镜成像');
  });

  it('阶测行用 ★ 前缀', () => {
    expect(entryText({ date: '2026-10-07', text: '第一次阶测', highlight: true })).toBe(
      '★ 10.07  第一次阶测'
    );
  });

  it('没有日期时只留前缀和内容', () => {
    expect(entryText({ text: '阶段测试' })).toBe('· 阶段测试');
  });

  it('空内容返回空串，不画空行', () => {
    expect(entryText({ date: '2026-10-01', text: '' })).toBe('');
    expect(entryText({ text: '   ' })).toBe('');
  });
});

describe('drawReportCard', () => {
  it('宽度固定 1080，内容越多卡片越高', () => {
    const c1 = document.createElement('canvas');
    stubContext(c1);
    drawReportCard(c1, FULL);
    expect(c1.width).toBe(1080);
    const h1 = c1.height;

    const c2 = document.createElement('canvas');
    stubContext(c2);
    drawReportCard(c2, { title: '一可', blocks: [{ heading: '9月总结', entries: [{ text: '一节课' }] }] });
    expect(c2.height).toBeGreaterThan(0);
    expect(c2.height).toBeLessThan(h1);
  });

  it('标题、信息行、两大块、条目和寄语全部上画布', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    drawReportCard(canvas, FULL);

    const text = drawnText(calls);
    expect(text).toContain('一可');
    expect(text).toContain('秋季初二物理 · 2026年10月');
    expect(text).toContain('【9月总结】');
    expect(text).toContain('【10月规划】');
    expect(text).toContain('出勤正常');
    expect(text).toContain('· 09.06  平面镜成像规律和透镜认识');
    expect(text).toContain('★ 10.07  秋季度第一次阶测安排');
    expect(text).toContain('感谢一可一整个学期的坚持和努力，继续保持！');
    expect(text).toContain('星火个性化教学');
  });

  it('空的 entries 不会画出「· 」空行', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    drawReportCard(canvas, {
      blocks: [{ heading: '10月规划', entries: [{ date: '', text: '' }, { date: '2026-10-01', text: '真内容' }] }],
    });
    const text = drawnText(calls);
    expect(text).toContain('· 10.01  真内容');
    expect(text).not.toContain('· \n');
    expect(calls.map((a) => a[0]).filter((t) => t === '· ' || t === '· \n')).toHaveLength(0);
  });

  it('两块都空时仍然画出可用的卡片，不报错', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    expect(() => drawReportCard(canvas, { title: '空学生', blocks: [] })).not.toThrow();
    expect(drawnText(calls)).toContain('空学生');
  });

  it('寄语在页脚之上（量高漏算块间距会把寄语挤出页脚下面）', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    drawReportCard(canvas, FULL);
    const yOf = (t: string) => calls.find((c) => c[0] === t)?.[2] as number;

    const farewellY = yOf('感谢一可一整个学期的坚持和努力，继续保持！');
    const footerY = yOf('星火个性化教学 · 月度总结与课程规划');
    const lastEntryY = yOf('· 10.18  质量和体积的测量和关系');

    expect(lastEntryY).toBeLessThan(farewellY);
    expect(farewellY).toBeLessThan(footerY);
    // 寄语到页脚还留得出一行高的空隙，不会挤在一起
    expect(footerY - farewellY).toBeGreaterThanOrEqual(30);
  });

  it('长文本会折行，行高按折行结果累加', () => {
    const canvas = document.createElement('canvas');
    const { calls } = stubContext(canvas);
    drawReportCard(canvas, { blocks: [{ heading: '总结', intro: '长'.repeat(80) }] });
    // 每行最多约 40 字（968 / 12），80 字至少折成 2 行
    const introLines = calls.map((a) => a[0]).filter((t) => typeof t === 'string' && t.startsWith('长'));
    expect(introLines.length).toBeGreaterThanOrEqual(2);
  });

  it('没有 2d 上下文时安全返回，不抛错', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(() => drawReportCard(canvas, FULL)).not.toThrow();
  });
});

describe('downloadReportCard', () => {
  it('触发下载，文件名与 PNG dataURL 都设置好，用完即清理锚点', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA');
    const anchors: any[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: any) {
      anchors.push(this);
    });

    downloadReportCard(FULL, '一可 10月月度报告.png');

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('一可 10月月度报告.png');
    expect(anchors[0].href).toBe('data:image/png;base64,AAA');
    expect(document.body.querySelectorAll('a').length).toBe(0);
  });
});
