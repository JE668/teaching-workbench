import { describe, it, expect, vi } from 'vitest';
import { getOnline, listenOnlineState } from './network';

describe('getOnline', () => {
  it('跟随 navigator.onLine', () => {
    expect(getOnline()).toBe(true);

    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(getOnline()).toBe(false);
    spy.mockRestore();
  });
});

describe('listenOnlineState', () => {
  it('订阅时立刻回调一次当前状态', () => {
    const spy = vi.fn();
    listenOnlineState(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(true);
  });

  it('收到 online / offline 事件时回调，取消订阅后不再回调', () => {
    const spy = vi.fn();
    const off = listenOnlineState(spy);

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(spy).toHaveBeenLastCalledWith(false);

    off();
    window.dispatchEvent(new Event('online'));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('事件名只是信号，回读的是真实状态而不是事件名', () => {
    const spy = vi.fn();
    listenOnlineState(spy);

    // 浏览器派发 offline 事件时 onLine 可能还没来得及变成 false，
    // 此时必须以真实状态为准，否则会出现"提示在线、其实离线"
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('offline'));

    expect(spy).toHaveBeenLastCalledWith(true);
  });
});
