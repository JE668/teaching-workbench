import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loginViaApi, getToken, seedStudent, seedReport, seedReportItem, clearAllReports, latestStudentId, importCatalog } from './helpers';
import { buildCatalogFixture } from './catalog-fixture';

/**
 * 月度总结与课程规划这条链路的端到端验证。
 *
 * 覆盖：新建报告 → 从课程目录取课（默认收窄到本报告的学科 + 学期）→ 手动加阶测
 *      → 导出 Excel（中文文件名 + 10 列版式，没有课程日期列）
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

/** 读出工作表某一行的文字（按列顺序），用来验表头是不是 10 列 */
async function readRow(buf: Uint8Array, n: number): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet(1)!;
  return Array.from({ length: 10 }, (_, i) => ((ws.getRow(n).getCell(i + 1).text as string) || '')).filter(
    (t) => t
  );
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
  test.setTimeout(120_000);

  test('新建报告 → 从课程目录取课 → 导出 Excel', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '报告同学', { grade: '初三', subject: '化学' });
    // e2e 库是共享的：跑几轮会攒出很多旧报告，而目录页「已上 N」是按 course_id
    // 跨学生聚合的，不清掉的话这个数会越攒越大，写死的「已上1」就翻了
    await clearAllReports(page);
    // 按 value 精确锁定这个学生，别按 label 撞名（同名学生可能有好几个）
    const reportStudentId = await latestStudentId(page, '报告同学');
    expect(reportStudentId, '应该能定位到刚建的学生').toBe(studentId);
    await importCatalog(page, { name: CATALOG.filename, buffer: (await buildCatalogFixture(CATALOG)).buffer });

    // —— 走 UI 新建月份报告 ——
    await page.goto('/reports');
    await page.getByRole('button', { name: '新建月份' }).first().click();
    const dlg = page.locator('div.fixed.inset-0.z-50').last();
    await expect(dlg.getByText('新建月份报告')).toBeVisible();
    await dlg.getByLabel('学生').selectOption(String(reportStudentId));
    await dlg.getByLabel('月份').fill('2026-09');
    await dlg.getByLabel('学期').selectOption('秋季');
    await dlg.getByRole('button', { name: '创建' }).click();
    // 报告已经在开头清空过，所以这里一定是「已新建」而不是「已有报告」
    await expect(page.getByText(/已新建/)).toBeVisible();
    // 创建成功后弹窗自己会关掉，不用手动取消
    await expect(dlg).toHaveCount(0);
    // 取回这份报告的 id：弹窗不会自己跳详情页
    const reportId = await seedReport(page, {
      studentId: reportStudentId,
      yearMonth: '2026-09',
      term: '秋季',
    });

    // 列表里能翻到这份报告——按 href 定位，别按学生名撞车
    const row = page.locator('tr').filter({ has: page.locator('a[href="/reports/' + reportId + '"]') }).first();
    await expect(row.getByRole('button', { name: '打开' })).toBeVisible();
    await row.getByRole('button', { name: '打开' }).click();
    await expect(page.getByRole('heading', { name: '报告同学', exact: true })).toBeVisible();

    // —— 总结：弹窗默认收窄到这份报告的学科 + 学期，春季的课不该混进来 ——
    await page.getByRole('button', { name: '从课程目录添加' }).first().click();
    const picker = page.locator('div.fixed.inset-0.z-50').last();
    await expect(picker.getByText('从课程目录添加 · 总结')).toBeVisible();
    await expect(picker.locator('tr', { hasText: '空气的成分' })).toBeVisible();
    // 秋季的报告里不该出现春季的课
    await expect(picker.locator('tr', { hasText: '金属活动性' })).toHaveCount(0);
    // 默认学期就是报告自己的学期
    await expect(picker.getByLabel('学期')).toHaveValue('秋季');

    // 「查看全部」放开全部条件，春季的课就出来了；再点一次收回来
    await picker.getByRole('button', { name: '查看全部' }).click();
    await expect(picker.locator('tr', { hasText: '金属活动性' })).toBeVisible();
    await picker.getByRole('button', { name: '查看全部' }).click();
    await expect(picker.locator('tr', { hasText: '金属活动性' })).toHaveCount(0);

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
    // 从目录取来的课不用再手填出勤那些列
    for (const col of ['出勤', '笔记整理', '错题整理', '作业完成']) {
      await expect(summaryRows.nth(0).getByLabel('空气的成分 ' + col)).toHaveValue('✅️');
    }
    await expect(summaryRows.nth(0).getByLabel('空气的成分 考试情况')).toHaveValue('/');
    // 表里没有课程日期列
    await expect(summaryRows.nth(0).locator('input[type="date"]')).toHaveCount(0);

    // —— 规划：换到春季的课，手动加一条阶测 ——
    await page.getByRole('button', { name: '从课程目录添加' }).nth(1).click();
    const picker2 = page.locator('div.fixed.inset-0.z-50').last();
    await expect(picker2.getByText('从课程目录添加 · 规划')).toBeVisible();
    await picker2.getByLabel('学期').selectOption('春季');
    await expect(picker2.locator('tr', { hasText: '金属活动性' })).toBeVisible();
    await expect(picker2.locator('tr', { hasText: '空气的成分' })).toHaveCount(0);
    await picker2.locator('tr', { hasText: '金属活动性' }).click();
    await picker2.locator('tr', { hasText: '酸碱盐' }).click();
    await picker2.getByRole('button', { name: /添加 2 门/ }).click();
    await expect(page.getByText(/已添加 2 门课/)).toBeVisible();

    // 已经加进总结的那门课，在总结弹窗里是灰掉的，不允许再加一遍。
    // 行上带 aria-disabled，Playwright 的普通 click 会一直重试到超时，所以这里用 force
    await page.getByRole('button', { name: '从课程目录添加' }).first().click();
    const picker3 = page.locator('div.fixed.inset-0.z-50').last();
    const addedRow = picker3.getByRole('row').filter({ hasText: '空气的成分' });
    await expect(addedRow.getByText('已添加')).toBeVisible();
    await expect(addedRow.getByLabel('选择')).toBeDisabled();
    await addedRow.click({ force: true });
    await expect(picker3.getByText('已选 0 门')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '手动加阶测' }).click();
    await expect(page.getByText(/阶测安排（1）/)).toBeVisible();

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
    // 阶测行带着老师填的时间
    expect(allText).toContain('阶测安排');

    // 表头就是 10 列：课程日期列已经下线，出勤等 4 列挪到了「学习难度」后面
    expect(await readRow(buf, 3)).toEqual([
      '序号',
      '课程内容',
      '课程类型',
      '期末考\n分值占比',
      '学习难度',
      '出勤',
      '笔记整理',
      '错题整理',
      '作业完成',
      '考试情况',
    ]);
    expect(allText).not.toContain('计划上课时间');
    // 老师填的默认值也跟着导出去
    expect(allText).toContain('✅️');
    expect(allText).toContain('/');

    // —— 目录 ↔ 报告打通：从目录取来的课，回到目录里能看到「已上 / 计划」——
    // 只筛初三化学：DB 是共享的，前面用例也导过目录，全量看会把数字带跑
    await page.goto('/catalog?subject=化学');
    const usedRow = page.locator('tr', { hasText: '空气的成分' }).first();
    await expect(usedRow.getByRole('button', { name: '已上1' })).toBeVisible();
    const plannedRow = page.locator('tr', { hasText: '金属活动性' }).first();
    await expect(plannedRow.getByRole('button', { name: '计划1' })).toBeVisible();
    // 没被取过课的目录条目不带标签
    await expect(page.locator('tr', { hasText: '水' }).first().getByRole('button', { name: /已上|计划/ })).toHaveCount(0);

    await usedRow.getByRole('button', { name: '已上1' }).click();
    // 弹窗断言要圈在弹窗里：页面上的「看谁进度」下拉也有同名 <option>，会撞 strict mode
    const usageDlg = page.locator('div.fixed.inset-0.z-50').last();
    await expect(usageDlg.getByText('「空气的成分」上过哪些课')).toBeVisible();
    // 汇总只列非零项：没规划就不占位「计划 0 次」（跟行内标签口径一致）
    await expect(usageDlg.getByText('已上 1 次', { exact: true })).toBeVisible();
    await expect(usageDlg.getByText(/计划 0 次/)).toHaveCount(0);
    await expect(usageDlg.getByText('报告同学')).toBeVisible();
    await expect(usageDlg.getByText('2026-09')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(usageDlg.getByText('「空气的成分」上过哪些课')).toHaveCount(0);

    // 切到「看谁进度」：上过/计划的都标上报告所在的月份，没取的显示未上
    await page.getByLabel('按学生查看课程进度').selectOption(String(reportStudentId));
    await expect(usedRow.getByText('已上 2026-09')).toBeVisible();
    await expect(plannedRow.getByText('计划 2026-09')).toBeVisible();
    await expect(page.locator('tr', { hasText: '水' }).first().getByRole('button', { name: /已上|计划/ })).toHaveCount(0);
    await expect(page.locator('tr', { hasText: '水' }).first().getByText('未上')).toBeVisible();
    // 汇总行给出三类各几门（exact：「已上 2」不能被行内的「已上 2026-09」误中）
    await expect(page.getByText('已上 2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('计划 2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('未上 1', { exact: true })).toBeVisible();
    // 学生记在地址栏里，刷新还在
    expect(page.url()).toContain('student=');
    await page.reload();
    await expect(usedRow.getByText('已上 2026-09')).toBeVisible();
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
