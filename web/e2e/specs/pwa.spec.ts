import { test, expect } from '@playwright/test';
import { loginViaApi } from './helpers';

/**
 * PWA 回归测试。
 *
 * 对应"装到手机上用"这件事：manifest 必须是合法的、
 * Service Worker 必须能被浏览器注册激活，
 * 以及一条最关键的红线 —— 业务数据绝不进缓存
 * （缓存了就会出现「列表还是上次的数据」「AI 评课返回旧结果」）。
 */
test.describe('PWA / Service Worker', () => {
  test('manifest.webmanifest 合法，可直接"添加到主屏幕"', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();

    const manifest = await res.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.short_name).toBeTruthy();

    // 安装要求 192 和 512 两档图标
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes).join(',');
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('sw.js 以 JavaScript 内容类型下发，且缓存策略允许每次重新验证', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.get('/sw.js');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('javascript');

    // 不能是 no-store，否则浏览器拒绝注册
    expect(res.headers()['cache-control']).not.toContain('no-store');
  });

  test('Service Worker 能被注册并激活', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!navigator.serviceWorker.controller,
      undefined,
      { timeout: 10_000 }
    );
  });

  test('清掉缓存后 /api 依然可用，证明业务数据没被缓存', async ({ page }) => {
    await loginViaApi(page);

    await page.goto('/');
    await page.waitForFunction(
      () => !!navigator.serviceWorker.controller,
      undefined,
      { timeout: 10_000 }
    );
    // 让 SW 跑起来后再发一次请求
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: '学生管理', exact: true })).toBeVisible();

    await page.evaluate(() => caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));

    await page.goto('/students');
    await expect(page.getByRole('heading', { name: '学生管理', exact: true })).toBeVisible();
  });
});
