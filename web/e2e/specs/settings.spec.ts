import { test, expect } from '@playwright/test';
import { loginViaApi } from './helpers';

/**
 * 设置页回归测试。
 *
 * 这两条对应用户真实反馈：
 *  1) 「模型名称依然不是下拉选项」—— 模型必须是 <select>，不能是手输框
 *  2) 「保存失败：认证令牌无效或已过期」—— 令牌失效时不能只丢一句
 *     无从下手的错误，而应清掉登录态并明确告知重新登录
 */
test.describe('设置页', () => {
  test('模型与思考等级都是下拉框（不是手输框）', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/settings');

    const model = page.getByLabel('模型', { exact: true });
    await expect(model).toBeVisible();
    expect(await model.evaluate((el) => el.tagName)).toBe('SELECT');

    // 内置目录里的默认模型必须可选（无 API Key 时用内置列表兜底，下拉照样出现）
    await expect(model.locator('option[value="sensenova-6.8-flash-lite"]')).toHaveCount(1);
    // 保留手填入口
    await expect(model.locator('option[value="__custom__"]')).toHaveCount(1);

    const effort = page.getByLabel('思考等级', { exact: true });
    await expect(effort).toBeVisible();
    expect(await effort.evaluate((el) => el.tagName)).toBe('SELECT');

    // 不应再出现"模型名称"手输框
    await expect(page.getByLabel('模型名称', { exact: true })).toHaveCount(0);
  });

  test('切换到"自定义模型…"后出现手输框，可返回下拉', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/settings');

    const model = page.getByLabel('模型', { exact: true });
    await expect(model).toBeVisible();

    await model.selectOption('__custom__');
    await expect(page.getByLabel('模型名称', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /返回下拉选择/ }).click();
    await expect(page.getByLabel('模型', { exact: true })).toBeVisible();
  });

  test('令牌失效时自动跳回登录页并说明原因', async ({ page }) => {
    // 先访问一次，确保能写 localStorage
    await page.goto('/login');

    // 伪造失效令牌：签名不符/过期都会走同一条 401 处理路径
    await page.evaluate(() => {
      localStorage.setItem('token', 'invalid.token.value');
      localStorage.setItem('user', JSON.stringify({ id: 1, username: 'ghost' }));
    });

    await page.goto('/settings');

    // 关键：被送回登录页，而不是停在设置页报一句看不懂的错
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('登录已过期，请重新登录')).toBeVisible();

    // 本地登录态已被清理
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });
});
