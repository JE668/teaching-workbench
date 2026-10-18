import { test, expect } from '@playwright/test';
import { loginViaApi, getToken } from './helpers';

/** 本地时区 YYYY-MM-DD，与后端 datetime('now','localtime') 的口径一致 */
function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * 听课覆盖率。
 *
 * 这个页面的价值在于：窗口内一次都没被听过的老师必须**被看见**。
 * 而 /teacher-stats 在带时间过滤时会用 HAVING 把零行剔掉，恰恰看不到这批人。
 */
test.describe('听课覆盖率', () => {
  test('窗外没被听过的老师列在名单里，并区分「从未」与「X 天没听」', async ({ page }) => {
    await loginViaApi(page);
    const token = await getToken(page);
    const auth = { Authorization: 'Bearer ' + token };

    const makeTeacher = async (name: string, subject?: string) => {
      const r = await page.request.post('/api/teachers', { headers: auth, data: { name, subject } });
      expect(r.ok(), '建老师失败: ' + name).toBeTruthy();
      return (await r.json()).teacher.id as number;
    };
    const makeObs = async (teacherId: number, daysAgo: number) => {
      const r = await page.request.post('/api/observations', {
        headers: auth,
        data: { topic: 'e2e覆盖课', teacherId, observedAt: isoDaysAgo(daysAgo) },
      });
      expect(r.ok(), '建听课记录失败').toBeTruthy();
    };

    const fresh = await makeTeacher('e2e覆盖-近期', '数学');
    const stale = await makeTeacher('e2e覆盖-陈旧', '语文');
    const none = await makeTeacher('e2e覆盖-从未');
    await makeObs(fresh, 2);    // 窗内
    await makeObs(stale, 400);  // 窗外

    await page.goto('/observations/stats');

    const card = page.getByTestId('coverage-card');
    await expect(card.getByRole('progressbar')).toBeVisible();

    // 近期被听过的不该出现在"还没被听过"名单里
    await expect(page.getByTestId('coverage-teacher-' + fresh)).toHaveCount(0);

    // 只有窗外记录的、以及从未听过课的，都必须被看见
    const staleChip = page.getByTestId('coverage-teacher-' + stale);
    await expect(staleChip).toContainText('e2e覆盖-陈旧');
    await expect(staleChip).not.toContainText('从未听过'); // 有过历史，不能标成"从未"

    // 从未听过课的标出"从未听过"，区别于只有窗外记录的那位
    const noneChip = page.getByTestId('coverage-teacher-' + none);
    await expect(noneChip).toContainText('e2e覆盖-从未');
    await expect(noneChip).toContainText('从未听过');
  });

  test('切换时间窗：同一位老师可以从「已听课」滑回「未听课」', async ({ page }) => {
    await loginViaApi(page);
    const token = await getToken(page);
    const auth = { Authorization: 'Bearer ' + token };

    const t = await page.request.post('/api/teachers', { headers: auth, data: { name: 'e2e覆盖-滑窗' } });
    const id = (await t.json()).teacher.id as number;
    await page.request.post('/api/observations', {
      headers: auth,
      data: { topic: 'e2e覆盖-滑窗课', teacherId: id, observedAt: isoDaysAgo(60) },
    });

    await page.goto('/observations/stats');
    await expect(page.getByTestId('coverage-card').getByRole('progressbar')).toBeVisible();

    // 近 90 天：60 天前那节在窗内
    await expect(page.getByTestId('coverage-teacher-' + id)).toHaveCount(0);

    // 近 30 天：那节滑到窗外，就进了"还没被听过"名单
    await page.getByLabel('覆盖率时间窗').selectOption('30');
    await expect(page.getByTestId('coverage-teacher-' + id)).toContainText('e2e覆盖-滑窗');
  });
});
