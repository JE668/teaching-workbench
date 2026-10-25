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

  test('AI 生成后编辑中的内容不会被另一台设备冲掉', async ({ browser }) => {
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
      await expect(b.getByTestId('sync-status')).toContainText(/跨设备同步|已连接/, {
        timeout: 15_000,
      });

      // A 端填最小表单并生成（mock AI 流式返回）
      await a.getByLabel(/学生姓名/).fill('同步编辑测试');
      await a.getByLabel(/课程主题/).fill('分数加减法');
      await a.getByLabel(/课堂表现/).fill('专注度较高，能主动回答问题');
      await a.getByRole('button', { name: /生成课后回访内容/ }).click();

      // 生成完成的标志：右上角出现「编辑」按钮
      await expect(a.getByRole('button', { name: '编辑' })).toBeVisible({ timeout: 30_000 });
      // B 端也实时收到了生成内容（同步链路活着）
      await expect(b.getByTestId('generated-content')).toBeVisible({ timeout: 15_000 });

      // 从现在起 A 端的草稿推送一律失败：模拟网络抖动 / 切后台。
      // A 接下来的编辑只存在于本地，服务端和 B 端都还停留在生成原文——
      // 这是真实丢内容的链路：B 一动表单，推送带回来的就是旧 draft
      await a.route('**/api/draft', async (route) => {
        if (route.request().method() === 'PUT') return route.abort();
        return route.continue();
      });

      // A 点编辑，改写正文（保持焦点在正文框里）
      await a.getByRole('button', { name: '编辑' }).click();
      const editor = a.getByLabel('课后回访内容');
      await editor.click();
      await editor.fill('A 正在编辑的回访内容，任何远端都不许覆盖');

      // B 端动表单触发一次推送：它带的 draft 是 A 没能推上去的生成原文
      await b.getByLabel(/课堂表现/).fill('B 端修改的课堂表现');
      await a.waitForTimeout(2500);

      // A 的编辑保住了；B 改的课堂表现同步过来了（同步本身还活着，不是断线）
      await expect(editor).toHaveValue('A 正在编辑的回访内容，任何远端都不许覆盖');
      await expect(a.getByLabel(/课堂表现/)).toHaveValue('B 端修改的课堂表现');
    } finally {
      await aCtx.close();
      await bCtx.close();
    }
  });
});
