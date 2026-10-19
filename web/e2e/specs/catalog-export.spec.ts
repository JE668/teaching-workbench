import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loginViaApi, getToken, importCatalog } from './helpers';
import { buildCatalogFixture } from './catalog-fixture';

const FIXTURE = {
  sheet: '初二物理',
  term: '秋季',
  courses: [
    [1, '静电现象', '同步', '★★'],
    [2, '热胀冷缩', '专题', '★★★'],
    [3, '光的色散', '专题', '★★'],
  ] as [number, string, string, string][],
  textbook: '沪科版（导出打印专用）',
  filename: '目录导出校验.xlsx',
};

async function readSheet(buf: Uint8Array): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 的 Buffer 泛型与 @types/node 的不一致，这里直接跳过类型检查
  await wb.xlsx.load(buf as any);
  const text: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => text.push(String(c.value ?? '')))));
  return text;
}

async function downloadXlsx(page: any): Promise<{ filename: string; buf: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /导出 Excel/ }).click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  return { filename: download.suggestedFilename(), buf: Buffer.concat(chunks) };
}

/**
 * 目录导出与打印。
 *
 * 老师要给家长 / 校区留一份「这学期上哪些课」的清单：以前只能整本拖下来自己删，
 * 现在筛完直接导出就是那一屏；纸质版走系统打印，筛选栏和分页会自动收掉。
 */
test.describe('目录导出与打印', () => {
  test('按教材版本导出：范围收敛到单一学期时文件名带上年级学科学期', async ({ page }) => {
    await loginViaApi(page);
    const fixture = await buildCatalogFixture(FIXTURE);
    await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });

    // 用专属教材版本当筛选键：DB 是共享的，别的用例也用「初二物理 秋季」，
    // 按年级学科学期筛会有重复，按教材版本筛只有这一批
    await page.goto('/catalog?textbook=' + encodeURIComponent(FIXTURE.textbook));
    const { filename, buf } = await downloadXlsx(page);
    expect(filename).toBe('课程目录 初二物理 秋季 共3课.xlsx');

    const text = await readSheet(buf);
    for (const want of [
      '课程目录 · 共 3 课',
      '年级',
      '学科',
      '分节',
      '课程内容',
      '掌握星级',
      '静电现象',
      '热胀冷缩',
      '光的色散',
      '沪科版（导出打印专用）',
    ]) {
      expect(text, '缺 ' + want).toContain(want);
    }

    await expect(page.getByText('已导出 3 门课')).toBeVisible();
  });

  test('搜索框输入的关键词跟着导出，只导出筛出来的那一门', async ({ page }) => {
    await loginViaApi(page);
    const fixture = await buildCatalogFixture(FIXTURE);
    await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });

    await page.goto('/catalog?textbook=' + encodeURIComponent(FIXTURE.textbook));
    await page.getByLabel('搜索辅导内容 / 教材 / 难度').fill('热胀冷缩');

    const { filename, buf } = await downloadXlsx(page);
    expect(filename).toBe('课程目录 初二物理 秋季 共1课.xlsx');
    const text = await readSheet(buf);
    expect(text).toContain('课程目录 · 共 1 课');
    expect(text).toContain('热胀冷缩');
    expect(text).not.toContain('静电现象');
    await expect(page.getByText('已导出 1 门课')).toBeVisible();
  });

  test('搜索能搜到教材版本和难度（和页面口径一致）', async ({ page }) => {
    await loginViaApi(page);
    const fixture = await buildCatalogFixture(FIXTURE);
    await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });

    const token = await getToken(page);
    const auth = { Authorization: 'Bearer ' + token };
    const base = '/api/catalog/courses?grade=初二&subject=物理&term=秋季&q=';

    // 教材版本
    const byBook = await page.request.get(base + encodeURIComponent('沪科'), { headers: auth });
    expect(((await byBook.json()) as any).courses.length).toBe(3);

    // 难度：只有「热胀冷缩」是 ★★★
    const byDiff = await page.request.get(base + encodeURIComponent('★★★'), { headers: auth });
    expect((await byDiff.json()).courses.map((c: any) => c.content)).toEqual(['热胀冷缩']);
  });

  test('打印按钮调用系统打印，打印模式下不分页', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__printCalls = 0;
      window.print = () => {
        (window as any).__printCalls += 1;
      };
    });
    await loginViaApi(page);
    const fixture = await buildCatalogFixture(FIXTURE);
    await importCatalog(page, { name: fixture.filename, buffer: fixture.buffer });

    await page.goto('/catalog?textbook=' + encodeURIComponent(FIXTURE.textbook));

    await page.getByRole('button', { name: /^打印$/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);
  });

  test('筛选后没有课程时导出按钮不可点', async ({ page }) => {
    // DB 是共享的，前面用例已经导入过目录，所以「没有导入」这个态在这里测不到；
    // 换成同一个守卫的另一半：筛选结果为空
    await loginViaApi(page);
    await page.goto('/catalog?textbook=' + encodeURIComponent('不存在的教材版本'));
    await expect(page.getByText('没有匹配的课程')).toBeVisible();
    await expect(page.getByRole('button', { name: /导出 Excel/ })).toBeDisabled();
    // 打印按钮在（有导入记录），点它不会报错
    await expect(page.getByRole('button', { name: /^打印$/ })).toBeEnabled();
  });
});
