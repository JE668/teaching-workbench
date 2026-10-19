import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loginViaApi, getToken, seedStudent, seedReport, seedReportItem, importCatalog } from './helpers';
import { buildCatalogFixture } from './catalog-fixture';

/**
 * 月度总结与课程规划这条链路的端到端验证。
 *
 * 覆盖：新建报告 → 从课程目录取课 → 自动推算阶测 → 导出 Excel（中文文件名 + 版式）
 *      → 关闭规划开关 → 上移跨月课不会带跑月份标题（回归）→ 导出图片卡片。
 *
 * 这条链跨了目录导入、报告 CRUD、Excel 生成、Canvas 出图四块，
 * 任何一环断开前面都是绿的。
 */

const CATALOG = {
  sheet: '初三化学',
  term: '秋季',
  courses: [
    [1, '空气的成分', '同步', '★★'],
    [2, '氧气', '专题', '★★★'],
    [3, '水', '同步', '★★'],
  ] as [number, string, string, string][],
  secondTerm: '春季',
  secondCourses: [
    [4, '金属活动性', '专题', '★★★'],
    [5, '酸碱盐', '同步', '★★★★'],
  ] as [number, string, string, string][],
  filename: '初三化学课程目录.xlsx',
};

/** 把报告 Excel 里每个工作表的第一列（区块标题都写在 A 列）读出来，按顺序返回 */
async function readFirstColumn(buf: Uint8Array): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 的 Buffer 泛型与 @types/node 的不一致，这里直接跳过类型检查
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet(1)!;
  const texts: string[] = [];
  for (let n = 1; n <= ws.rowCount; n++) {
    const t = (ws.getRow(n).getCell(1).text as string) || '';
    if (t) texts.push(t);
  }
  return texts;
}

/** 读出工作表里所有单元格的文字，用来断言明细内容有没有被导出去 */
async function readAllText(buf: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet(1)!;
  const cells: string[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = (ws.getRow(r).getCell(c).text as string) || '';
      if (t) cells.push(t);
    }
  }
  return cells.join('\n');
}

async function downloadReportExcel(page: any) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 Excel' }).click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  return { filename: download.suggestedFilename(), buf: Buffer.concat(chunks) };
}

test.describe('月度总结与课程规划', () => {
  test('新建报告 → 从课程目录取课 → 自动推算阶测 → 导出 Excel', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '报告同学', { grade: '初三', subject: '化学' });
    await importCatalog(page, { name: CATALOG.filename, buffer: (await buildCatalogFixture(CATALOG)).buffer });

    // —— 走 UI 新建月份报告 ——
    await page.goto('/reports');
    await page.getByRole('button', { name: '新建月份' }).first().click();
    const dlg = page.locator('div.fixed.inset-0.z-50').last();
    await expect(dlg.getByText('新建月份报告')).toBeVisible();
    await dlg.getByLabel('学生').selectOption({ label: '报告同学' });
    await dlg.getByLabel('月份').fill('2026-09');
    await dlg.getByLabel('学期').selectOption('秋季');
    await dlg.getByRole('button', { name: '创建' }).click();
    await expect(page.getByText(/已新建/)).toBeVisible();
    // 创建成功后弹窗自己会关掉，不用手动取消
    await expect(dlg).toHaveCount(0);

    const row = page.locator('tr', { hasText: '报告同学' }).first();
    await expect(row.getByRole('button', { name: '打开' })).toBeVisible();
    await row.getByRole('button', { name: '打开' }).click();
    await expect(page.getByRole('heading', { name: '报告同学', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '从课程目录添加' }).first().click();
    const picker = page.locator('div.fixed.inset-0.z-50').last();
    await expect(picker.getByText('从课程目录添加 · 总结')).toBeVisible();

    // 搜一把，确认能按内容过滤
    await picker.getByLabel('搜索').fill('氧气');
    await expect(picker.getByText('氧气')).toBeVisible();
    await expect(picker.locator('tr', { hasText: '空气的成分' })).toHaveCount(0);
    await picker.getByLabel('搜索').fill('');

    await picker.locator('tr', { hasText: '空气的成分' }).click();
    await picker.locator('tr', { hasText: '氧气' }).click();
    await expect(picker.getByText('已选 2 门')).toBeVisible();
    await picker.getByRole('button', { name: /添加 2 门/ }).click();
    await expect(page.getByText(/已添加 2 门课/)).toBeVisible();
    // 表格里课程内容是 <input> 的值，不是文本节点，所以断言要看 value
    const summaryRows = page.locator('tbody').first().locator('tr');
    await expect(summaryRows).toHaveCount(2);
    await expect(summaryRows.nth(0).locator('td').nth(1).locator('input')).toHaveValue('空气的成分');
    await expect(summaryRows.nth(1).locator('td').nth(1).locator('input')).toHaveValue('氧气');

    // —— 规划：从课程目录加课 + 自动推算阶测 ——
    await page.getByRole('button', { name: '从课程目录添加' }).nth(1).click();
    const picker2 = page.locator('div.fixed.inset-0.z-50').last();
    await expect(picker2.getByText('从课程目录添加 · 规划')).toBeVisible();
    await picker2.locator('tr', { hasText: '金属活动性' }).click();
    await picker2.locator('tr', { hasText: '酸碱盐' }).click();
    await picker2.getByRole('button', { name: /添加 2 门/ }).click();
    await expect(page.getByText(/已添加 2 门课/)).toBeVisible();

    // 从目录取来的课只带内容不带时间，而阶测是按"已有上课时间的跨度"推算的，
    // 所以得先把两条课的时间填上（前后差约 8 周，学期按 3 周一次应该能排出好几场）
    const planRows = page.locator('tbody').nth(1).locator('tr');
    await expect(planRows).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const dateInput = planRows.nth(i).locator('td').nth(5).locator('input');
      await dateInput.fill(i === 0 ? '2026-09-15' : '2026-11-10');
      await dateInput.blur();
    }

    await page.getByRole('button', { name: '自动推算阶测' }).click();
    const examDlg = page.locator('div.fixed.inset-0.z-50').last();
    await expect(examDlg.getByText('自动推算的阶测安排')).toBeVisible();
    await expect(examDlg.getByText('跨度不够排一次阶测')).toHaveCount(0);
    await expect(examDlg.getByRole('button', { name: '全部加入规划' })).toBeEnabled();
    await examDlg.getByRole('button', { name: '全部加入规划' }).click();
    await expect(page.getByText(/已加入 \d+ 次阶测安排/)).toBeVisible();
    await expect(page.getByText(/阶测安排（\d+/)).toBeVisible();

    // —— 导出 Excel：中文文件名 + 两个区块 ——
    const { filename, buf } = await downloadReportExcel(page);
    expect(filename).toBe('报告同学 秋季初三化学 9月总结与10月规划.xlsx');

    const titles = await readFirstColumn(buf);
    expect(titles).toContain('报告同学 秋季初三化学 9月总结');
    expect(titles).toContain('报告同学 秋季初三化学 10月规划');
    expect(titles.some((t) => /9月规划|10月总结/.test(t)), '总结月与规划月不应串位').toBe(false);

    // 明细写在第 2 列，得把整张表的文字都读出来才能验到
    const allText = await readAllText(buf);
    expect(allText).toContain('空气的成分');
    expect(allText).toContain('金属活动性');
  });

  test('手动上移一条跨月的课，区块月份标题保持不变（回归）', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '排序回归同学', { grade: '初三', subject: '化学' });
    const reportId = await seedReport(page, {
      studentId,
      yearMonth: '2026-04',
      term: '秋季',
      grade: '初三',
      subject: '化学',
    });

    // 总结里 4 月一条、5 月一条，规划一条
    await seedReportItem(page, reportId, {
      kind: 'summary',
      content: '四月的课',
      scheduledAt: '2026-04-06',
      type: '同步',
    });
    const mayItem = await seedReportItem(page, reportId, {
      kind: 'summary',
      content: '五月的课',
      scheduledAt: '2026-05-03',
      type: '同步',
    });
    await seedReportItem(page, reportId, {
      kind: 'plan',
      content: '五月规划课',
      scheduledAt: '2026-05-17',
    });

    await page.goto('/reports/' + reportId);
    await expect(page.getByRole('heading', { name: '排序回归同学', exact: true })).toBeVisible();

    const summaryRows = page.locator('tbody').first().locator('tr');
    await expect(summaryRows).toHaveCount(2);
    // 单元格内容是 <input> 的值（不是文本节点），所以断言得看 value 而不是文本
    const contentOf = (i: number) => summaryRows.nth(i).locator('td').nth(1).locator('input');
    await expect(contentOf(0)).toHaveValue('四月的课');
    await expect(contentOf(1)).toHaveValue('五月的课');

    // —— 把 5 月那条上移到最前面 ——
    await summaryRows.nth(1).getByRole('button', { name: '上移' }).click();
    await expect(contentOf(0)).toHaveValue('五月的课');
    await expect(contentOf(1)).toHaveValue('四月的课');

    // 接口侧也确实是 5 月那条排第一
    const token = await getToken(page);
    const got = await page.request.get('/api/reports/' + reportId, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const items = ((await got.json()) as any).items;
    const summaryOrder = items.filter((i: any) => i.kind === 'summary').map((i: any) => i.content);
    expect(summaryOrder[0]).toBe('五月的课');

    // —— 导出 Excel：标题必须还是 4月总结，不能被上移的 5 月课带成 5月总结 ——
    const { filename, buf } = await downloadReportExcel(page);
    expect(filename).toBe('排序回归同学 秋季初三化学 4月总结与5月规划.xlsx');

    const titles = await readFirstColumn(buf);
    expect(titles[0]).toBe('排序回归同学 秋季初三化学 4月总结');
    expect(titles).toContain('排序回归同学 秋季初三化学 5月规划');
    expect(titles.some((t) => /5月总结/.test(t)), '总结标题不应被上移的 5 月课带跑').toBe(false);

    // 明细本身顺序确实变了（证明上面不是"什么也没发生"）
    const allText = await readAllText(buf);
    expect(allText).toContain('五月的课');
    expect(allText).toContain('四月的课');
    void mayItem;
  });

  test('关闭规划开关后导出的 Excel 不含规划区块，图片卡片文件名带中文', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '只出总结同学', { grade: '初二', subject: '物理' });
    const reportId = await seedReport(page, {
      studentId,
      yearMonth: '2026-06',
      term: '春季',
      grade: '初二',
      subject: '物理',
    });
    await seedReportItem(page, reportId, {
      kind: 'summary',
      content: '凸透镜成像',
      scheduledAt: '2026-06-07',
      type: '专题',
    });
    await seedReportItem(page, reportId, {
      kind: 'plan',
      content: '这行不该被导出',
      scheduledAt: '2026-07-05',
    });

    await page.goto('/reports/' + reportId);
    await expect(page.getByRole('heading', { name: '只出总结同学', exact: true })).toBeVisible();

    // 关掉规划开关
    const planSwitch = page.getByRole('switch', { name: '课程规划开关' });
    await expect(planSwitch).toHaveAttribute('aria-checked', 'true');
    await planSwitch.click();
    await expect(planSwitch).toHaveAttribute('aria-checked', 'false');

    const { filename, buf } = await downloadReportExcel(page);
    expect(filename).toBe('只出总结同学 春季初二物理 6月总结.xlsx');

    const titles = await readFirstColumn(buf);
    expect(titles[0]).toBe('只出总结同学 春季初二物理 6月总结');
    expect(titles.join('\n')).not.toContain('规划');

    const allText = await readAllText(buf);
    expect(allText, '规划区块的明细不应被导出').not.toContain('这行不该被导出');
    expect(allText).toContain('凸透镜成像');

    // 图片卡片是纯前端 Canvas 出图，只校验触发下载与文件名
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出图片' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('只出总结同学 6月月度报告.png');
  });
});
