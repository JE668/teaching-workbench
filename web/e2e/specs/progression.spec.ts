import { test, expect } from '@playwright/test';
import { loginViaApi, seedStudent, seedFollowUp } from './helpers';

/**
 * 学生掌握程度走势。
 *
 * 老师最想知道的一件事：这个孩子是进步了，还是退步了。
 * 不需要额外填任何字段，直接从已有回访里算出来。
 */
test.describe('掌握程度走势', () => {
  test('掌握程度从差到好时，展示进步判定与走势条', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, 'e2e走势-进步');

    // 先录"需加强"，再录"优秀"：同一天的两条记录按录入顺序判先后
    await seedFollowUp(page, {
      studentId,
      studentName: 'e2e走势-进步',
      topic: 'e2e走势-初次',
      mastery: 'needs_improvement',
    });
    await seedFollowUp(page, {
      studentId,
      studentName: 'e2e走势-进步',
      topic: 'e2e走势-复查',
      mastery: 'excellent',
    });

    await page.goto('/students/' + studentId);

    const card = page.getByTestId('progression-card');
    await expect(card).toBeVisible();

    // 跨三档（需加强 → 优秀），判定为明显提升
    await expect(card.getByText('明显提升')).toBeVisible();

    // 两条走势条，先低后高
    const bars = card.getByTestId('progression-bar');
    await expect(bars).toHaveCount(2);
    const h0 = await bars.nth(0).evaluate((el) => parseInt(el.style.height, 10));
    const h1 = await bars.nth(1).evaluate((el) => parseInt(el.style.height, 10));
    expect(h0).toBeLessThan(h1);

    // 首尾对照行点出两次掌握程度
    await expect(card.getByText('首次回访')).toBeVisible();
    await expect(card.getByText('最近一次')).toBeVisible();
  });

  test('掌握程度从好到差时，展示下滑判定', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, 'e2e走势-下滑');

    await seedFollowUp(page, {
      studentId,
      studentName: 'e2e走势-下滑',
      topic: 'e2e走势-前一次',
      mastery: 'excellent',
    });
    await seedFollowUp(page, {
      studentId,
      studentName: 'e2e走势-下滑',
      topic: 'e2e走势-这一次',
      mastery: 'needs_improvement',
    });

    await page.goto('/students/' + studentId);

    await expect(page.getByTestId('progression-card').getByText('明显下滑')).toBeVisible();
  });

  test('只有一条回访时不展示走势卡片，不硬凑趋势', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, 'e2e走势-单条');
    await seedFollowUp(page, { studentId, studentName: 'e2e走势-单条', topic: 'e2e走势-仅一次' });

    await page.goto('/students/' + studentId);
    await expect(page.locator('main').getByRole('heading', { name: 'e2e走势-单条', exact: true })).toBeVisible();

    await expect(page.getByTestId('progression-card')).toHaveCount(0);
  });
});
