import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft, appendPhrase, PERFORMANCE_PHRASES } from './draft';

const KEY = 'tw:followup-draft:v1';

function blank() {
  return {
    form: { studentName: '', topic: '', performance: '' },
    images: [],
    selectedIds: [],
    content: '',
    draft: '',
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('草稿 · 存取', () => {
  it('保存后能原样读回', () => {
    saveDraft({
      form: { studentName: '李一一', topic: '分数加减法', performance: '专注度高' },
      images: ['1/a.png'],
      selectedIds: [1, 2],
      content: '【课堂内容】…',
      draft: '',
    }, 1);

    const d = loadDraft(1);
    expect(d).not.toBeNull();
    expect(d!.form.studentName).toBe('李一一');
    expect(d!.images).toEqual(['1/a.png']);
    expect(d!.selectedIds).toEqual([1, 2]);
    expect(d!.content).toBe('【课堂内容】…');
  });

  it('全空时不写入（避免占位）', () => {
    saveDraft(blank(), 1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('已有内容时再清空会移除草稿', () => {
    saveDraft({ ...blank(), content: '有内容' }, 1);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    saveDraft(blank(), 1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('超过 7 天的草稿视为过期并清除', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveDraft({ ...blank(), content: '旧草稿' }, 1);

    // 快进 8 天
    vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));

    expect(loadDraft(1)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('脏 JSON 不会抛错', () => {
    localStorage.setItem(KEY, '{ 这不是 json');
    expect(() => loadDraft(1)).not.toThrow();
    expect(loadDraft(1)).toBeNull();
  });

  it('字段类型异常时安全降级', () => {
    // 注意带 ownerId：无主草稿现在直接不恢复（见「跨账号隔离」），
    // 这条用例要验的是【字段类型异常时的降级】，所以得先是一份有效归属的草稿。
    localStorage.setItem(KEY, JSON.stringify({ ownerId: 1, savedAt: Date.now(), images: 'oops', selectedIds: 42, content: 7 }));
    const d = loadDraft(1);
    expect(d!.images).toEqual([]);
    expect(d!.selectedIds).toEqual([]);
    expect(d!.content).toBe('');
  });

  it('clearDraft 清空', () => {
    saveDraft({ ...blank(), content: 'x' }, 1);
    clearDraft();
    expect(loadDraft(1)).toBeNull();
  });

  it('localStorage 不可用时不影响使用', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => saveDraft({ ...blank(), content: 'x' }, 1)).not.toThrow();

    spy.mockRestore();
  });
});

describe('课堂表现快捷短语', () => {
  it('空文本时直接插入短语', () => {
    expect(appendPhrase('', '专注度高')).toBe('专注度高');
    expect(appendPhrase('   ', '专注度高')).toBe('专注度高');
  });

  it('追加时自动补顿号，且不重复添加', () => {
    expect(appendPhrase('专注度高', '主动提问')).toBe('专注度高，主动提问');
    expect(appendPhrase('专注度高，', '主动提问')).toBe('专注度高，主动提问');
    expect(appendPhrase('专注度高', '专注度高')).toBe('专注度高');
    expect(appendPhrase('专注度高，主动提问', '主动提问')).toBe('专注度高，主动提问');
  });

  it('短语列表非空且分为正/负两类', () => {
    expect(PERFORMANCE_PHRASES.length).toBeGreaterThan(0);
    expect(PERFORMANCE_PHRASES.some((p) => p.tone === 'good')).toBe(true);
    expect(PERFORMANCE_PHRASES.some((p) => p.tone === 'warn')).toBe(true);
  });
});

/**
 * 回归：草稿必须按用户隔离。
 *
 * 背景（真实缺陷）：草稿原先存在一个全局 key 里，且退出登录不清。
 * 后果是共用设备上换了账号，新账号一进「课后回访」就能直接看到
 * 上一个账号未保存的学生姓名、课堂表现原文、以及刚生成还没发出去的评语；
 * 图片与分组选中名单同理（那是别人学生的照片和名单）。
 *
 * 这三类内容都不是"设置项"那种可公开的偏好，属于实打实的信息泄露。
 */
describe('草稿 · 跨账号隔离', () => {
  it('A 的草稿不会被 B 读到', () => {
    saveDraft({ ...blank(), form: { ...blank().form, studentName: 'A的学生' }, content: 'A的评语' }, 1);

    // B 登录后读取：拿不到任何内容
    expect(loadDraft(2)).toBeNull();
    // A 自己回来还在
    expect(loadDraft(1)!.content).toBe('A的评语');
  });

  it('B 读不到 A 的草稿，但也不会把 A 的草稿删掉（A 回来仍可续写）', () => {
    saveDraft({ ...blank(), content: 'A的评语' }, 1);
    loadDraft(2); // B 读一次
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(loadDraft(1)!.content).toBe('A的评语');
  });

  it('拿不到用户身份时不恢复任何草稿', () => {
    saveDraft({ ...blank(), content: 'A的评语' }, 1);
    expect(loadDraft(null)).toBeNull();
    expect(loadDraft(undefined)).toBeNull();
  });

  it('旧版本遗留的无主草稿不会被恢复（无法判断归属，宁可让用户重填）', () => {
    // 模拟旧版本写入的、没有 ownerId 的草稿
    localStorage.setItem(KEY, JSON.stringify({
      form: { studentName: '李一一', topic: 't', performance: 'p' },
      images: [], selectedIds: [], content: '旧版本的草稿', draft: '',
      savedAt: Date.now(),
    }));

    expect(loadDraft(1)).toBeNull();
  });

  it('退出登录清掉自己的草稿（下一个账号看不到）', () => {
    saveDraft({ ...blank(), content: 'A的评语' }, 1);

    clearDraft(1); // logout 传当前用户
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadDraft(2)).toBeNull();
  });

  it('退出登录不会误删同设备上另一个账号的草稿', () => {
    saveDraft({ ...blank(), content: 'A的评语' }, 1);

    // B 登出（B 自己没写过草稿，设备上这份是 A 的）
    clearDraft(2);
    expect(loadDraft(1)!.content).toBe('A的评语');
  });

  it('退出登录会清掉无主草稿（留着就是风险）', () => {
    localStorage.setItem(KEY, JSON.stringify({
      form: {}, images: [], selectedIds: [], content: '旧版本残留', draft: '',
      savedAt: Date.now(),
    }));

    clearDraft(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('拿不到身份时保存草稿不落盘（避免写出无主草稿扩散给下一个人）', () => {
    saveDraft({ ...blank(), content: 'x' }, null);
    saveDraft({ ...blank(), content: 'x' }, undefined);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
})
