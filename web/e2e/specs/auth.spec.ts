import { test, expect } from '@playwright/test';
import { login, loginViaApi, ADMIN_USER, ADMIN_PASS } from './helpers';

test.describe('登录', () => {
  test('使用正确凭据可进入工作台', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    await expect(page.locator('main').getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  });

  test('错误密码给出提示且停留在登录页', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/用户名/).fill(ADMIN_USER);
    await page.getByLabel(/密码/).fill('wrong-password');
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText('用户名或密码错误').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('未登录访问受保护页面会跳转到登录页', async ({ page }) => {
    await page.goto('/students');
    await expect(page).toHaveURL(/\/login/);
  });

  test('退出登录后回到登录页且登录态被清除', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: '退出登录' }).click();

    await expect(page).toHaveURL(/\/login/);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeNull();
  });
});

test.describe('深链接（回归）', () => {
  /**
   * 回归：AuthContext 曾在 useEffect 中异步恢复登录态，
   * 导致首帧判定为未登录并把子页面重定向回首页。
   * 表现是"刷新或直接访问子页面 URL 会被踢回工作台"。
   */
  test('已登录时直接访问子页面不会被重定向', async ({ page }) => {
    await loginViaApi(page);

    for (const [path, heading] of [
      ['/students', '学生管理'],
      ['/followups', '课后回访'],
      ['/followups/history', '回访历史'],
    ] as const) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
      await expect(page.locator('main').getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('已登录时刷新页面仍停留在当前页', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: '学生管理' })).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/students$/);
    await expect(page.getByRole('heading', { name: '学生管理' })).toBeVisible();
  });
});
