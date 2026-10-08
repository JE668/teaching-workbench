import { test, expect } from '@playwright/test';
import { loginViaApi, seedStudent, seedFollowUp } from './helpers';

test.describe('数据导出', () => {
  test('导出 Markdown 档案并校验内容', async ({ page }) => {
    const studentId = await seedStudent(page, '导出测试', { phone: '13900139000' });

    await loginViaApi(page);
    await page.goto('/students/' + studentId);
    await expect(
      page.locator('main').getByRole('heading', { name: '导出测试', exact: true })
    ).toBeVisible();

    // 该学生还没有回访，导出按钮应禁用
    await expect(page.getByRole('button', { name: '导出档案' })).toBeDisabled();

    // 造一条回访后应可导出
    await seedFollowUp(page, {
      studentId,
      studentName: '导出测试',
      topic: '浮力与压强',
      performance: '理解到位',
      mastery: 'excellent',
      content: '【课堂内容】讲解了阿基米德原理。',
    });

    await page.reload();
    const exportBtn = page.getByRole('button', { name: '导出档案' });
    await expect(exportBtn).toBeEnabled();
    await exportBtn.click();

    await expect(page.getByRole('heading', { name: '导出学习档案' })).toBeVisible();

    // 触发下载并读取内容
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出', exact: true }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.md$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');

    expect(text).toContain('# 导出测试 · 学习档案');
    expect(text).toContain('13900139000');
    expect(text).toContain('浮力与压强');
    expect(text).toContain('【课堂内容】');
    expect(text).toContain('掌握程度**：优秀');
    expect(text).toContain('共 1 次回访');
  });

  test('支持导出为 CSV', async ({ page }) => {
    const studentId = await seedStudent(page, 'CSV导出');
    await seedFollowUp(page, {
      studentId,
      studentName: 'CSV导出',
      grade: '初三',
      subject: '物理',
      topic: '含,逗号的课',
      performance: '好',
      mastery: 'good',
      content: '他说"不错"。',
    });

    await loginViaApi(page);
    await page.goto('/students/' + studentId);

    await page.getByRole('button', { name: '导出档案' }).click();
    await page.getByRole('button', { name: /CSV 表格/ }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出', exact: true }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');

    expect(text).toContain('学生姓名,年级,学科,课程主题');
    expect(text).toContain('"含,逗号的课"');
  });
});
