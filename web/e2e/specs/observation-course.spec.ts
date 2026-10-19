import { test, expect } from '@playwright/test';
import { loginViaApi, getToken, importCatalog } from './helpers';
import { buildCatalogFixture } from './catalog-fixture';

/** Modal 没标 role="dialog"，用外层遮罩定位当前弹窗 */
const dialog = (page: any) => page.locator('div.fixed.inset-0.z-50').last();

const FIXTURE = {
  // 特意避开物理 / 化学：其它用例按学科筛目录，撞了会把行数断言带跑
  sheet: '初一数学',
  term: '秋季',
  courses: [
    [1, '整式的加减', '同步', '★★★'],
    [2, '一元一次方程', '专题', '★★'],
  ] as [number, string, string, string][],
  textbook: '北师大版（听评课接目录专用）',
  filename: '听评课接目录校验.xlsx',
};

/** 导入这批专属课程；重复执行不会重复灌库，所以每个用例都能安全调 */
async function setupCatalog(page: any) {
  await loginViaApi(page);
  const fixture = await buildCatalogFixture(FIXTURE);
  await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });
}

/**
 * 听评课接目录。
 *
 * 老师旁听的其实是「目录里的某一节课」。补上这层关联之后：
 *  - 评课表多一个「关联目录课时」栏：搜得到、点得选、清得掉；课题手输时留空
 *  - 目录页这门课多出「听课」数，点开能看见几节课被旁听过
 *  - 目录里查不到的课题不强求关联，不影响评课保存
 */
test.describe('听评课接目录', () => {
  test('评课表搜到并选目录课时，保存后关联生效', async ({ page }) => {
    await setupCatalog(page);
    await page.goto('/observations/new');

    await page.getByPlaceholder(/如：分数加减法运算/).fill('一元一次方程');

    // 关联目录课时：搜关键词 → 点选 → 换成已选卡片，搜框收起
    await page.getByPlaceholder(/搜课程内容 \/ 章节 /).fill('方程');
    await page.getByRole('button', { name: /一元一次方程/ }).click();
    await expect(page.getByPlaceholder(/搜课程内容 \/ 章节 /)).toHaveCount(0);
    await expect(page.locator('div.border-brand-200').getByText('清除')).toBeVisible();

    await page.getByRole('button', { name: /保存记录/ }).click();
    await expect(page.getByText('听课记录已保存')).toBeVisible();

    const token = await getToken(page);
    const res = await page.request.get('/api/observations', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const list = ((await res.json()) as any).observations;
    const mine = list.find((o: any) => o.topic === '一元一次方程' && o.courseId);
    expect(mine, '保存下来的记录应带上 course_id').toBeTruthy();
    expect(mine.courseId).toBeGreaterThan(0);
  });

  test('关联之后目录页这门课显示听课数，明细标出（听课）', async ({ page }) => {
    await setupCatalog(page);
    const token = await getToken(page);
    const auth = { Authorization: 'Bearer ' + token };

    // 拿这门课的 id，直接在库里补一条旁听记录（UI 那条已在上面一个用例验过）
    const list = await page.request.get('/api/catalog/courses?limit=5000', { headers: auth });
    const course = ((await list.json()) as any).courses.find(
      (c: any) => c.textbook === FIXTURE.textbook && c.content === '整式的加减'
    );
    expect(course, '专属课程应导入成功').toBeTruthy();

    const obs = await page.request.post('/api/observations', {
      headers: auth,
      data: {
        topic: '整式的加减',
        courseId: course.id,
        observedAt: '2026-10-20',
        studentName: '听课同学',
      },
    });
    expect(obs.ok(), '建旁听记录失败').toBeTruthy();
    expect((await obs.json()).observation.courseId).toBe(course.id);

    // 用搜索词把范围锁死在这批课上，不受共享后端里其它用例的数据干扰
    await page.goto('/catalog?q=' + encodeURIComponent('整式的加减'));
    const chip = page
      .getByRole('table')
      .first()
      .locator('tbody tr')
      .filter({ hasText: '整式的加减' })
      .getByRole('button', { name: /听课1/ });
    await expect(chip).toBeVisible();

    await chip.click();
    const dlg = dialog(page);
    await expect(dlg.getByText('「整式的加减」上过哪些课')).toBeVisible();
    await expect(dlg.getByText('听课 1 次')).toBeVisible();
    await expect(dlg.getByText('（听课）')).toBeVisible();
    await expect(dlg.getByText('听课同学')).toBeVisible();
  });

  test('课题手输、目录里没有对应课时：留空也能正常保存', async ({ page }) => {
    await setupCatalog(page);
    await page.goto('/observations/new');

    await page.getByPlaceholder(/如：分数加减法运算/).fill('临时加的自习课');
    await page.getByRole('button', { name: /保存记录/ }).click();
    await expect(page.getByText('听课记录已保存')).toBeVisible();

    const token = await getToken(page);
    const res = await page.request.get('/api/observations', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const mine = ((await res.json()) as any).observations.find((o: any) => o.topic === '临时加的自习课');
    expect(mine).toBeTruthy();
    expect(mine.courseId).toBeNull();
  });
});
