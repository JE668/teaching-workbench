import { test, expect } from '@playwright/test';
import { loginViaApi, getToken, importCatalog } from './helpers';
import { buildCatalogFixture } from './catalog-fixture';

/**
 * 课程目录这条链路的端到端验证：
 * 上传真实版式的 Excel → 仅预览不落库 → 正式导入 → 列表展示 → 就地设掌握星级
 * → 重复上传不重复灌库。
 *
 * 目录数据是「月度总结/课程规划」的上游取数来源，这条链断了后面两个页面都空。
 */

const FIXTURE = {
  sheet: '初二物理',
  term: '秋季',
  courses: [
    [1, '声现象', '同步', '★★'],
    [2, '物态变化', '专题', '★★★'],
    [3, '光现象', '同步', '★★'],
  ] as [number, string, string, string][],
  sectionLabel: '秋季第一次阶段性测试',
  secondTerm: '春季',
  secondCourses: [
    [4, '透镜及其应用', '同步', '★★★'],
    [5, '电学入门', '预习', '★★★★'],
  ] as [number, string, string, string][],
  filename: '全年课程体系目录.xlsx',
};

/** Modal 没标 role="dialog"，用外层遮罩定位当前弹窗 */
const dialog = (page: any) => page.locator('div.fixed.inset-0.z-50').last();

test.describe('课程目录导入', () => {
  test('上传 Excel → 仅预览不落库 → 导入 → 列表展示 → 就地设掌握星级', async ({ page }) => {
    const fixture = await buildCatalogFixture({ ...FIXTURE });
    await loginViaApi(page);
    const token = await getToken(page);
    const courses = async () => {
      const res = await page.request.get('/api/catalog/courses?limit=20000', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return (((await res.json()) as any).courses as any[]).map((c) => ({
        content: c.content as string,
        grade: c.grade as string,
        subject: c.subject as string,
        mastery_star: c.mastery_star as number,
      }));
    };
    const titlesOf = (rows: { content: string }[]) => rows.map((r) => r.content);

    await page.goto('/catalog');
    await expect(page.getByRole('button', { name: '导入目录' }).first()).toBeVisible();

    // —— 导入前库里没有这些课程 ——
    for (const t of fixture.titles) expect(titlesOf(await courses())).not.toContain(t);

    // —— 打开导入弹窗 ——
    await page.getByRole('button', { name: '导入目录' }).first().click();
    const dlg = dialog(page);
    await expect(dlg.getByText('导入全年课程体系目录')).toBeVisible();

    await dlg.getByLabel('学段').selectOption('小初');
    await dlg.getByTestId('catalog-file-input').setInputFiles({
      name: fixture.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fixture.buffer,
    });
    await expect(dlg.getByText(new RegExp('已选择 ' + fixture.filename))).toBeVisible();

    // —— 仅预览：只解析，不落库 ——
    await dlg.getByRole('button', { name: '仅预览' }).click();
    await expect(dlg.getByText('预览结果')).toBeVisible();
    await expect(dlg.getByText('5 条课程')).toBeVisible();
    await expect(dlg.getByText('全部 sheet 解析成功')).toBeVisible();
    for (const t of fixture.titles) {
      const present = titlesOf(await courses()).includes(t);
      expect(present, '仅预览后不应落库: ' + t).toBe(false);
    }

    // —— 正式导入 ——
    await dlg.getByRole('button', { name: '导入', exact: true }).click();
    await expect(page.getByText(/导入完成，新增 5 条课程/)).toBeVisible();
    await expect(dlg.getByText('导入结果')).toBeVisible();
    await expect(dlg.getByText('新增 5')).toBeVisible();

    // —— 列表展示 ——
    await dlg.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('声现象')).toBeVisible();
    await expect(page.getByText('透镜及其应用')).toBeVisible();
    await expect(page.getByText('电学入门')).toBeVisible();
    // 教材版本要归一化：原表「人教版（2024）」→「人教版」（每行都有，取第一处即可）
    await expect(page.getByText('人教版').first()).toBeVisible();

    // —— 就地设掌握星级（保存是静默乐观更新，成功不弹 toast，所以验 UI 态 + 接口值）——
    const row = page.locator('tr', { hasText: '声现象' }).first();
    const editor = row.locator('[data-testid="star-editor"]');
    await expect(editor.locator('button[title="点击设为 4 星"] svg')).toHaveAttribute('fill', 'none');
    await editor.locator('button[title="点击设为 4 星"]').click();
    // 设成 4 星后，前 4 颗都要是实心
    await expect(editor.locator('button[title="点击设为 4 星"] svg')).toHaveAttribute('fill', 'currentColor');
    await expect(editor.locator('button[title="点击设为 1 星"] svg')).toHaveAttribute('fill', 'currentColor');

    const starred = (await courses()).filter((c) => c.content === '声现象');
    expect(starred.length).toBeGreaterThan(0);
    expect(starred[0].mastery_star).toBe(4);
  });

  test('同一份文件重复上传不会重复灌库', async ({ page }) => {
    // 用一组独立的课程名 —— 用例之间共享同一个后端与数据库，
    // 如果跟第一个用例内容相同，这里的"首次导入"会变成"全部重复"，断言就错了
    const fixture = await buildCatalogFixture({
      ...FIXTURE,
      filename: '重复导入校验.xlsx',
      courses: [
        [1, '声现象（去重校验）', '同步', '★★'],
        [2, '物态变化（去重校验）', '专题', '★★★'],
        [3, '光现象（去重校验）', '同步', '★★'],
      ] as [number, string, string, string][],
      secondCourses: [
        [4, '透镜及其应用（去重校验）', '同步', '★★★'],
        [5, '电学入门（去重校验）', '预习', '★★★★'],
      ] as [number, string, string, string][],
    });
    await loginViaApi(page);

    const first = await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });
    const second = await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });

    expect(first.coursesImported).toBe(5);
    expect(first.coursesDuplicated ?? 0).toBe(0);
    expect(second.coursesImported).toBe(0);
    expect(second.coursesDuplicated).toBe(5);

    // 库里始终只有 5 条
    const token = await getToken(page);
    const res = await page.request.get('/api/catalog/courses?limit=20000', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const hits = ((await res.json()) as any).courses.filter((c: any) =>
      fixture.titles.includes(c.content) && c.grade === '初二' && c.subject === '物理'
    );
    expect(hits.length).toBe(5);
  });
});
