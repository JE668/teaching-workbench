import { describe, it, expect, vi, afterEach } from 'vitest';
import { cn, countWords, formatDate, relativeTime, copyText, localDateStr, localNowISO } from './utils';

describe('localDateStr / localNowISO', () => {
  it('按本地年月日取值（用本地分量构造，任何时区下结论都一致）', () => {
    for (const hour of [0, 1, 5, 12, 23]) {
      expect(localDateStr(new Date(2026, 9, 18, hour, 0, 0))).toBe('2026-10-18');
    }
    expect(localDateStr(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
    expect(localDateStr(new Date(2025, 11, 31, 23, 59, 59))).toBe('2025-12-31');
  });

  it('回归：不能用 toISOString 取日期（那在本地凌晨会退回前一天）', () => {
    // 只有在「本地 00:00 之后、UTC 仍是前一天」的时区，两者才会分歧。
    // 硬编码本地 01:00 只在东时区（UTC+8 等）成立；西时区（如 UTC-5）那时 UTC
    // 已经是当天，断言必挂。所以按当前时区偏移动态挑一个「必然分歧」的本地时刻。
    const offsetMin = new Date().getTimezoneOffset();
    if (offsetMin === 0) return; // UTC 环境无从体现，跳过而不是假装通过

    // 东时区：本地凌晨（UTC 尚在前一天）；西时区：本地深夜（UTC 已到次日）
    const hour = offsetMin > 0 ? 23 : 1;
    const d = new Date(2026, 9, 18, hour, 0, 0);

    // 本地日期稳定取当天，与 toISOString 的 UTC 口径无关
    expect(localDateStr(d)).toBe('2026-10-18');
    // 且确实与该本地时刻的 UTC 日期不同（证明我们没用 toISOString 的日截断）
    expect(d.toISOString().slice(0, 10)).not.toBe(localDateStr(d));
  });

  it('默认取当前时刻', () => {
    expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('localNowISO 输出与库里 datetime(now) 一致的格式', () => {
    expect(localNowISO()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('localNowISO 不含 T / Z / 毫秒（relativeTime 按本地解析，带这些会算错）', () => {
    const s = localNowISO();
    expect(s).not.toContain('T');
    expect(s).not.toContain('Z');
    expect(s).not.toContain('.');
  });

  it('localNowISO 与当前时间一致（按本地解析）', () => {
    const drift = Math.abs(Date.now() - new Date(localNowISO().replace(' ', 'T')).getTime());
    expect(drift).toBeLessThan(60_000);
  });
});

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
  // 生成【北京时间挂钟串】——这正是后端 datetime('now','+8 hours') 的存储格式。
  // 不能用 getHours() 取本地时间：CI runner 是 UTC，本地时间会与北京差 8 小时，
  // 断言就成了「在哪个时区跑测试决定结果」，而不是钉住被测函数的口径。
  const ago = (ms: number) => {
    const d = new Date(Date.now() - ms + 8 * 3600 * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds())
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

  it('把无时区串钉死按北京时间解析（与运行环境时区无关）', () => {
    // 后端存的是 datetime('now','+8 hours') 挂钟串。若哪天有人把它改回
    // new Date(str)（按浏览器本地时区解析），东八区本地的测试仍然会绿 ——
    // 只有这条断言能锁住口径。
    const now = new Date();
    // 取「此刻的北京时间」精确到秒，写成后端格式
    const bj = new Date(now.getTime() + 8 * 3600 * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    const bjStr =
      bj.getUTCFullYear() + '-' + p(bj.getUTCMonth() + 1) + '-' + p(bj.getUTCDate()) + ' ' +
      p(bj.getUTCHours()) + ':' + p(bj.getUTCMinutes()) + ':' + p(bj.getUTCSeconds());

    // 与当前时刻只差几秒 → 必须是「刚刚」；任何偏离 8 小时的解析都会落进小时/天级
    expect(relativeTime(bjStr)).toBe('刚刚');
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
