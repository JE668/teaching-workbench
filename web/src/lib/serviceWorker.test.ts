import { describe, it, expect, vi } from 'vitest';
import { APP_UPDATED_EVENT, watchControllerChange, onAppUpdated, registerServiceWorker } from './serviceWorker';

function makeScope(controller: unknown = null) {
  const onControllerChange: Array<() => void> = [];
  return {
    controller,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      if (type === 'controllerchange') onControllerChange.push(cb);
    }),
    register: vi.fn().mockResolvedValue({}),
    fire: () => onControllerChange.forEach((cb) => cb()),
  };
}

describe('watchControllerChange', () => {
  it('本来就有 SW 在控制页面 → controllerchange 视为新版本，触发通知', () => {
    const scope = makeScope({ scriptURL: 'https://x.example/sw.js' });
    const notify = vi.fn();

    watchControllerChange(scope, notify);
    expect(scope.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));

    scope.fire();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('首次注册（controller 为 null）→ 正常激活不算新版本，不打扰用户', () => {
    const scope = makeScope(null);
    const notify = vi.fn();

    watchControllerChange(scope, notify);
    scope.fire();

    expect(notify).not.toHaveBeenCalled();
  });
});

describe('onAppUpdated', () => {
  it('收到窗口事件时回调；取消订阅后不再回调', () => {
    const notify = vi.fn();
    const off = onAppUpdated(notify);

    window.dispatchEvent(new CustomEvent(APP_UPDATED_EVENT));
    expect(notify).toHaveBeenCalledTimes(1);

    off();
    window.dispatchEvent(new CustomEvent(APP_UPDATED_EVENT));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('registerServiceWorker', () => {
  it('环境不支持 Service Worker 时静默返回，不抛错', () => {
    expect(() => registerServiceWorker()).not.toThrow();
  });
});
