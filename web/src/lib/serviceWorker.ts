/**
 * 生产环境注册 Service Worker，让应用可以"添加到主屏幕"离线使用。
 *
 * 只在 main.tsx 里于 `import.meta.env.PROD` 为真时调用 ——
 * 开发环境不注册，避免 vite dev server 被 SW 的缓存干扰。
 */

/** 有新版本并已激活时派发的窗口事件 */
export const APP_UPDATED_EVENT = 'tw:app-updated';

interface ServiceWorkerScope {
  controller: unknown;
  addEventListener: (type: string, cb: () => void) => void;
  register: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * 监听 SW 版本切换。
 *
 * 只有"本来就有 SW 在控制当前页面"时，controllerchange 才算
 * 「新版本上线了」；首次注册时 controller 由 null 变为 worker，
 * 只是正常激活，不该弹窗打扰用户。
 */
export function watchControllerChange(scope: ServiceWorkerScope, notify: () => void): void {
  const hadController = !!scope.controller;
  scope.addEventListener('controllerchange', () => {
    if (hadController) notify();
  });
}

/** 订阅"有新版本"事件，返回取消订阅函数 */
export function onAppUpdated(notify: () => void): () => void {
  const handler = () => notify();
  window.addEventListener(APP_UPDATED_EVENT, handler);
  return () => window.removeEventListener(APP_UPDATED_EVENT, handler);
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const scope = navigator.serviceWorker;
  watchControllerChange(scope, () => window.dispatchEvent(new CustomEvent(APP_UPDATED_EVENT)));
  scope.register('/sw.js', { scope: '/' }).catch(() => {
    // 非 HTTPS 等不安全上下文会抛 SecurityError：静默忽略，只是没有离线能力
  });
}
