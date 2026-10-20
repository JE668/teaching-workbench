import { test, expect } from '@playwright/test';
import { loginViaApi, getToken, importCatalog } from './helpers';
import { buildCatalogFixture } from './catalog-fixture';

/**
 * 课程目录这条链路的端到端验证：
 * 上传真实版式的 Excel → 仅预览不落库 → 正式导入 → 列表展示 → 重复上传不重复灌库。
 * 目录页只做筛选 / 展示 / 打印 / 导出，所以顺带验一下：
 * 掌握星级、AI 定档、分节标记这些辅助信息都不再出现在页面上。
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
  test('上传 Excel → 仅预览不落库 → 导入 → 列表展示（页面上没有掌握星级 / 分节标记）', async ({ page }) => {
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
    // 教材版本要归一化：原表「人教版（2024）」→「人教版」（每行都有，取第一处即可）。
    // 限定在表格里找：「全部教材版本」下拉里也有同名 option，是隐藏元素。
    await expect(page.getByRole('table').getByText('人教版').first()).toBeVisible();

    // —— 目录页只做筛选 / 展示 / 打印 / 导出 ——
    // 掌握星级编辑器、AI 定档入口、分节标记（秋季第一次阶段性测试）这一批辅助信息都已拿掉；
    // 「轨」这个内部叫法在界面上叫教案版本
    const row = page.locator('tr', { hasText: '声现象' }).first();
    await expect(row.locator('[data-testid="star-editor"]')).toHaveCount(0);
    await expect(page.getByText(/阶段性测试/)).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '掌握' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '按教案版本筛选' })).toBeVisible();
    await expect(page.getByText('全部轨')).toHaveCount(0);
  });

  test('教材版本可以搜，筛选条件同步地址栏，分组可分页', async ({ page }) => {
    // 同一组 14 条 + 独占的教材版本：既测分页，又能把搜索范围精确锁在这批课上，
    // 不受同一后端里其它用例留下的数据干扰
    const TEXTBOOK = '北师大版（查找浏览专用）';
    const rows = Array.from({ length: 14 }, (_, i) =>
      [i + 1, '查找浏览课 ' + (i + 1), i % 2 === 0 ? '同步' : '专题', '★★'] as [number, string, string, string]
    );
    const fixture = await buildCatalogFixture({
      sheet: '初二物理',
      term: '秋季',
      courses: rows,
      textbook: TEXTBOOK,
      filename: '查找浏览校验.xlsx',
    });
    await loginViaApi(page);
    expect((await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer })).coursesImported).toBe(14);

    await page.goto('/catalog');

    const search = page.getByPlaceholder(/搜索辅导内容/);
    const table = page.getByRole('table').first();

    // 教材版本进了搜索范围（之前只搜辅导内容和分节，教材搜不到）
    await search.fill('北师大');
    await expect(table.getByText('查找浏览课 1', { exact: true })).toBeVisible();
    // 搜索词同步写进地址栏
    expect(new URL(page.url()).searchParams.get('q')).toBe('北师大');

    // 分组分页：先露 12 条，第 13 条还在外面
    expect(await table.locator('tbody tr').count()).toBe(12);
    expect(await table.getByText('查找浏览课 13').count()).toBe(0);
    await page.getByRole('button', { name: /还有 2 条/ }).click();
    expect(await table.locator('tbody tr').count()).toBe(14);
    await expect(table.getByText('查找浏览课 13')).toBeVisible();
    await expect(page.getByRole('button', { name: '收起' })).toBeVisible();

    // 教材版本下拉筛选，条件同样落进地址栏
    await search.fill('');
    await page.getByRole('combobox', { name: '按教材版本筛选' }).selectOption(TEXTBOOK);
    expect(await table.locator('tbody tr').count()).toBe(14);
    expect(new URL(page.url()).searchParams.get('textbook')).toBe(TEXTBOOK);
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

test.describe('批量删除导入', () => {
  test('勾选两份用户目录一次清空，不影响别的导入', async ({ page }) => {
    await loginViaApi(page);

    const a = await buildCatalogFixture({
      sheet: '初二物理',
      term: '秋季',
      courses: [
        [1, '批量删除甲课', '同步', '★★'],
        [2, '批量删除甲课二', '专题', '★★★'],
      ] as [number, string, string, string][],
      filename: '批量删除甲.xlsx',
    });
    const b = await buildCatalogFixture({
      sheet: '初二物理',
      term: '秋季',
      courses: [
        [1, '批量删除乙课', '同步', '★★'],
        [2, '批量删除乙课二', '专题', '★★★'],
      ] as [number, string, string, string][],
      filename: '批量删除乙.xlsx',
    });
    expect((await importCatalog(page, { name: a.filename, buffer: a.buffer })).coursesImported).toBe(2);
    expect((await importCatalog(page, { name: b.filename, buffer: b.buffer })).coursesImported).toBe(2);

    const token = await getToken(page);
    const importsOf = async () => {
      const res = await page.request.get('/api/catalog/imports', {
        headers: { Authorization: 'Bearer ' + token },
      });
      return ((await res.json()) as any).imports as any[];
    };

    const mine = (await importsOf()).filter((i) => i.filename === a.filename || i.filename === b.filename);
    expect(mine.length).toBe(2);
    const ids = mine.map((i) => i.id);

    await page.goto('/catalog');

    // 不点「全选」：用例之间共享同一个库，全选会把别的用例导的目录一起删掉
    await page.getByTestId('pick-import-' + ids[0]).check();
    await page.getByTestId('pick-import-' + ids[1]).check();
    await expect(page.getByRole('button', { name: '删除选中（2）' })).toBeEnabled();

    await page.getByRole('button', { name: '删除选中（2）' }).click();
    await expect(page.getByText('删除选中的导入？')).toBeVisible();
    await expect(page.getByText(/将删除选中的 2 次导入、共 4 条课程/)).toBeVisible();

    await page.getByRole('button', { name: '全部删除' }).click();
    await expect(page.getByText(/已删除 2 次导入、4 条课程/)).toBeVisible();

    // 两条导入记录都没了
    const left = (await importsOf()).filter((i) => i.id === ids[0] || i.id === ids[1]);
    expect(left.length).toBe(0);

    // 课程也真的清掉了，不只是历史记录消失
    const res = await page.request.get('/api/catalog/courses?limit=20000', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const titles = ((await res.json()) as any).courses.map((c: any) => c.content);
    for (const t of [...a.titles, ...b.titles]) expect(titles).not.toContain(t);
  });
});
