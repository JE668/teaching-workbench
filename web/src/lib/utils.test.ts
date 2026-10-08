import { describe, it, expect, vi, afterEach } from 'vitest';
import { cn, countWords, formatDate, relativeTime, copyText } from './utils';

describe('cn', () => {
  it('合并类名', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('忽略假值', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('后者覆盖前者的冲突类（tailwind-merge）', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-slate-500', 'text-brand-600')).toBe('text-brand-600');
  });
});

describe('countWords（字数统计口径：不含空白与标点）', () => {
  it('中文标点不计入', () => {
    expect(countWords('你好，世界！')).toBe(4);
  });

  it('中文方括号不计入', () => {
    expect(countWords('【课堂内容】')).toBe(4);
  });

  it('空白与换行不计入', () => {
    expect(countWords('a b\nc\td')).toBe(4);
  });

  it('中英文与数字混合', () => {
    expect(countWords('完成第12页的1到8题')).toBe(11);
  });

  it('空字符串为 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });

  it('与后端口径一致：典型回访文本', () => {
    const text = '【课堂内容】本节课重点讲解了通分的原理与步骤。';
    // 【】与。不计入；课堂内容(4) + 本节课重点讲解了通分的原理与步骤(16) = 20
    expect(countWords(text)).toBe(20);
  });
});

describe('formatDate', () => {
  it('转换为中文日期并去掉前导零', () => {
    expect(formatDate('2026-10-08 12:30:00')).toBe('2026年10月8日');
  });

  it('个位月份与日期', () => {
    expect(formatDate('2026-01-05 00:00:00')).toBe('2026年1月5日');
  });

  it('空值返回占位符', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('格式异常时原样返回', () => {
    expect(formatDate('不是日期')).toBe('不是日期');
  });
});

describe('relativeTime', () => {
  const ago = (ms: number) => {
    const d = new Date(Date.now() - ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    );
  };

  it('一分钟内显示"刚刚"', () => {
    expect(relativeTime(ago(10 * 1000))).toBe('刚刚');
  });

  it('分钟级', () => {
    expect(relativeTime(ago(5 * 60 * 1000))).toBe('5分钟前');
  });

  it('小时级', () => {
    expect(relativeTime(ago(3 * 60 * 60 * 1000))).toBe('3小时前');
  });

  it('天级', () => {
    expect(relativeTime(ago(2 * 24 * 60 * 60 * 1000))).toBe('2天前');
  });

  it('超过 30 天回退为绝对日期', () => {
    const old = ago(60 * 24 * 60 * 60 * 1000);
    expect(relativeTime(old)).toMatch(/年.*月.*日/);
  });

  it('空值返回占位符', () => {
    expect(relativeTime(null)).toBe('-');
    expect(relativeTime(undefined)).toBe('-');
  });
});

describe('copyText', () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
  });

  function setClipboard(value: any) {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  }

  it('安全上下文下使用 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    // jsdom 默认 isSecureContext 可能为 false，这里显式模拟
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    const ok = await copyText('要复制的内容');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('要复制的内容');
  });

  it('Clipboard API 抛错时返回 false（不崩）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not allowed'));
    setClipboard({ writeText });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    const ok = await copyText('内容');
    expect(ok).toBe(false);
  });

  it('无 Clipboard API 时回退到 execCommand', async () => {
    setClipboard(undefined);
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    (document as any).execCommand = exec;

    const ok = await copyText('回退内容');

    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // 临时 textarea 应被清理
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });
});
