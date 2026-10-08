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
    });

    const d = loadDraft();
    expect(d).not.toBeNull();
    expect(d!.form.studentName).toBe('李一一');
    expect(d!.images).toEqual(['1/a.png']);
    expect(d!.selectedIds).toEqual([1, 2]);
    expect(d!.content).toBe('【课堂内容】…');
  });

  it('全空时不写入（避免占位）', () => {
    saveDraft(blank());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('已有内容时再清空会移除草稿', () => {
    saveDraft({ ...blank(), content: '有内容' });
    expect(localStorage.getItem(KEY)).not.toBeNull();

    saveDraft(blank());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('超过 7 天的草稿视为过期并清除', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveDraft({ ...blank(), content: '旧草稿' });

    // 快进 8 天
    vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));

    expect(loadDraft()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('脏 JSON 不会抛错', () => {
    localStorage.setItem(KEY, '{ 这不是 json');
    expect(() => loadDraft()).not.toThrow();
    expect(loadDraft()).toBeNull();
  });

  it('字段类型异常时安全降级', () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), images: 'oops', selectedIds: 42, content: 7 }));
    const d = loadDraft();
    expect(d!.images).toEqual([]);
    expect(d!.selectedIds).toEqual([]);
    expect(d!.content).toBe('');
  });

  it('clearDraft 清空', () => {
    saveDraft({ ...blank(), content: 'x' });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('localStorage 不可用时不影响使用', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => saveDraft({ ...blank(), content: 'x' })).not.toThrow();

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
