import { test, expect } from '@playwright/test';
import { loginViaApi } from './helpers';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * 跨设备实时联动。
 *
 * 用两个独立的浏览器上下文模拟"电脑"与"手机"：
 * 它们有不同的 localStorage、独立的 cookie jar，但连同一个后端、同一个账号。
 * 验证：一端改动，另一端**无需刷新**即可看到。
 */
test.describe('跨设备实时同步', () => {
  test('电脑改文字 / 手机传图，两端实时联动', async ({ browser }) => {
    const desktopCtx = await browser.newContext();
    const phoneCtx = await browser.newContext();
    const desktop = await desktopCtx.newPage();
    const phone = await phoneCtx.newPage();

    try {
      await loginViaApi(desktop);
      await loginViaApi(phone);

      await desktop.goto('/followups');
      await phone.goto('/followups');

      // 两端都应建立同步连接
      await expect(desktop.getByTestId('sync-status')).toContainText(/跨设备同步|已连接/, {
        timeout: 15_000,
      });

      // ===== ① 电脑输入课程主题 =====
      await desktop.getByLabel(/课程主题/).fill('分数加减法运算');

      // 手机端无需刷新即出现
      await expect(phone.getByLabel(/课程主题/)).toHaveValue('分数加减法运算', {
        timeout: 15_000,
      });

      // ===== ② 手机填写课堂表现 =====
      await phone.getByLabel(/课堂表现/).fill('本次课专注度较高');

      await expect(desktop.getByLabel(/课堂表现/)).toHaveValue('本次课专注度较高', {
        timeout: 15_000,
      });

      // ===== ③ 【核心场景】手机上传图片，电脑直接看到 =====
      await phone.getByTestId('file-input').setInputFiles({
        name: 'homework.png',
        mimeType: 'image/png',
        buffer: TINY_PNG,
      });

      // 电脑端出现图片预览（且是真的加载出来了）
      const preview = desktop.locator('img').last();
      await expect(preview).toBeVisible({ timeout: 20_000 });

      await expect
        .poll(async () => preview.evaluate((el: HTMLImageElement) => el.naturalWidth), {
          timeout: 20_000,
        })
        .toBeGreaterThan(0);

      // 两端都应看到"已连接 1 台设备"
      await expect(desktop.getByTestId('sync-status')).toContainText('已连接 1 台设备', {
        timeout: 15_000,
      });
    } finally {
      await desktopCtx.close();
      await phoneCtx.close();
    }
  });

  test('一端归档后，另一端收到草稿清空提示', async ({ browser }) => {
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();

    try {
      await loginViaApi(a);
      await loginViaApi(b);

      await a.goto('/followups');
      await b.goto('/followups');
      await expect(b.getByTestId('sync-status')).toContainText(/跨设备同步|已连接/, {
        timeout: 15_000,
      });

      // a 填点内容，b 应能收到
      await a.getByLabel(/学生姓名/).fill('同步测试' + Date.now());
      await expect(b.getByLabel(/学生姓名/)).not.toHaveValue('', { timeout: 15_000 });

      // b 直接清空服务端草稿（等价于另一端归档）
      await b.evaluate(async () => {
        const token = localStorage.getItem('token');
        await fetch('/api/draft', {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: 'e2e-clearer' }),
        });
      });

      await expect(a.getByText(/另一台设备已归档/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await aCtx.close();
      await bCtx.close();
    }
  });

  test('正在输入的字段不会被远端覆盖', async ({ browser }) => {
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();

    try {
      await loginViaApi(a);
      await loginViaApi(b);
      await a.goto('/followups');
      await b.goto('/followups');

      await expect(a.getByTestId('sync-status')).toContainText(/跨设备同步|已连接/, {
        timeout: 15_000,
      });

      // a 正在输入课堂表现（保持焦点）
      await a.getByLabel(/课堂表现/).click();
      await a.getByLabel(/课堂表现/).fill('A正在输入的内容');

      // 此时 b 修改同一字段
      await b.getByLabel(/课堂表现/).fill('B的内容');
      await b.waitForTimeout(2000);

      // a 的输入不应被冲掉（焦点保护）
      await expect(a.getByLabel(/课堂表现/)).toHaveValue('A正在输入的内容');
    } finally {
      await aCtx.close();
      await bCtx.close();
    }
  });
});
