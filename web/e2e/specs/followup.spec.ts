import { test, expect, Page } from '@playwright/test';
import { loginViaApi, seedStudent, seedFollowUp } from './helpers';

/** 填好生成回访所需的最小表单 */
async function fillForm(page: Page, opts: { name: string; topic: string; performance?: string }) {
  await page.getByLabel(/学生姓名/).fill(opts.name);
  await page.getByLabel(/课程主题/).fill(opts.topic);
  await page.getByLabel(/课堂表现/).fill(opts.performance || '专注度较高，能主动回答问题');
}

async function gotoFollowUp(page: Page) {
  await loginViaApi(page);
  await page.goto('/followups');
  await expect(page.locator('main').getByRole('heading', { name: '课后回访', exact: true })).toBeVisible();
}

test.describe('课后回访生成', () => {
  test('生成过程文字逐步出现（真流式，非一次性）', async ({ page }) => {
    await gotoFollowUp(page);
    await fillForm(page, { name: '流式测试', topic: '分数加减法' });

    await page.getByRole('button', { name: /生成课后回访内容/ }).click();

    const content = page.getByTestId('generated-content');
    await expect(content).toBeVisible({ timeout: 15_000 });

    // 连续采样文本长度，验证是逐步增长而非一次到位
    const lengths: number[] = [];
    for (let i = 0; i < 50; i++) {
      lengths.push((await content.textContent())?.length ?? 0);
      await page.waitForTimeout(100);

      // 生成结束后再多采两轮就收工
      const btn = page.getByRole('button', { name: /重新生成/ });
      if ((await btn.count()) > 0 && (await btn.isEnabled())) {
        lengths.push((await content.textContent())?.length ?? 0);
        break;
      }
    }

    const distinct = [...new Set(lengths.filter((n) => n > 0))];
    expect(
      distinct.length,
      '文本应分多段逐步出现，实际采样: ' + lengths.join(',')
    ).toBeGreaterThanOrEqual(3);

    // 最终内容应包含三段结构
    await expect(content).toContainText('【课堂内容】');
    await expect(content).toContainText('【学生收获】');
    await expect(content).toContainText('【课后任务】');
  });

  test('生成结果可一键复制（含 Toast 反馈）', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoFollowUp(page);
    await fillForm(page, { name: '复制测试', topic: '分数乘法' });

    await page.getByRole('button', { name: /生成课后回访内容/ }).click();
    await expect(page.getByTestId('generated-content')).toContainText('【课后任务】', {
      timeout: 20_000,
    });

    // 注意：按钮的可访问名来自文字"复制"，title 不会参与命名，故用 title 选择器
    await page.locator('[title="复制全文"]').click();
    await expect(page.getByText('已复制回访内容，可直接发送给家长')).toBeVisible();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('【课堂内容】');
  });

  test('小组课：多选学生一次归档多条，且文案不含姓名', async ({ page }) => {
    // 姓名带运行期唯一后缀：避免历史运行残留的同名学生导致选择器歧义
    const tag = Date.now().toString().slice(-6);
    const nameA = '小组甲' + tag;
    const nameB = '小组乙' + tag;

    const a = await seedStudent(page, nameA);
    const b = await seedStudent(page, nameB);

    await gotoFollowUp(page);
    await page.getByRole('button', { name: '小组课' }).click();
    // selected-count 只在小组课模式渲染，作为进入该模式的稳定锚点
    await expect(page.getByTestId('selected-count')).toBeVisible();

    // 勾选两名学生
    await page.getByText(nameA).click();
    await page.getByText(nameB).click();
    await expect(page.getByTestId('selected-count')).toContainText('2');

    await page.getByLabel(/课程主题/).fill('分数加减法、分数乘法');
    await page.getByLabel(/课堂表现/).fill('整体参与度较高');
    await page.getByRole('button', { name: /生成课后回访内容/ }).click();
    await expect(page.getByTestId('generated-content')).toContainText('【课后任务】', {
      timeout: 20_000,
    });

    await page.getByRole('button', { name: /保存并归档/ }).click();

    // 提示为 2 位学生各归档一条
    await expect(page.getByText(/已为 2 位学生各归档一条回访/)).toBeVisible({ timeout: 15_000 });

    // 两个学生的档案里都能看到这条小组课记录
    for (const id of [a, b]) {
      await page.goto('/students/' + id);
      await expect(page.getByText('分数加减法、分数乘法')).toBeVisible();
      await expect(page.getByText('小组课', { exact: true })).toBeVisible();
    }
  });

  test('选择 3 次课后按阶段生成，并归档时保留课次数', async ({ page }) => {
    const studentId = await seedStudent(page, '阶段反馈测试');

    await gotoFollowUp(page);
    await page.getByLabel(/选择已有学生/).selectOption(String(studentId));

    // 选择涵盖 3 次课
    await page.getByRole('button', { name: '3 次课' }).click();
    await expect(page.getByText(/将把最近 3 次课作为一个阶段整体反馈/)).toBeVisible();

    // 标签与新学生主题提示应随之变化
    await page.getByLabel(/课程内容（这几次课）/).fill('分数加减法、分数乘法、分数除法');
    await page.getByLabel(/课堂表现/).fill('三次课整体参与度高');
    await page.getByRole('button', { name: /生成课后回访内容/ }).click();

    await expect(page.getByTestId('generated-content')).toContainText('【课后任务】', {
      timeout: 20_000,
    });

    await page.getByRole('button', { name: /保存并归档到学生档案/ }).click();
    await expect(page).toHaveURL(new RegExp('/students/' + studentId + '$'), { timeout: 15_000 });

    // 档案时间线应显示课次徽章。
    // 注意 exact：否则 "3 次课" 会同时命中 "涵盖 3 次课"
    await expect(page.getByText('3 次课', { exact: true })).toBeVisible();
    await expect(page.getByText('涵盖 3 次课')).toBeVisible();
  });

  test('保存后自动归档到学生档案', async ({ page }) => {
    const studentId = await seedStudent(page, '归档测试');

    await gotoFollowUp(page);
    await page.getByLabel(/选择已有学生/).selectOption(String(studentId));
    await page.getByLabel(/课程主题/).fill('归档测试课程');
    await page.getByLabel(/课堂表现/).fill('参与积极');

    await page.getByRole('button', { name: /生成课后回访内容/ }).click();
    await expect(page.getByTestId('generated-content')).toContainText('【课后任务】', {
      timeout: 20_000,
    });

    await page.getByRole('button', { name: /保存并归档到学生档案/ }).click();

    // 保存后自动跳转到该学生档案
    await expect(page).toHaveURL(new RegExp('/students/' + studentId + '$'), { timeout: 15_000 });
    // exact 必须为 true：回访主题 "归档测试课程" 会与标题 "归档测试" 产生子串匹配
    await expect(
      page.locator('main').getByRole('heading', { name: '归档测试', exact: true })
    ).toBeVisible();
    await expect(page.getByText('归档测试课程')).toBeVisible();
  });
});

test.describe('回访历史与编辑', () => {
  test('已保存的回访可再次编辑并生效', async ({ page }) => {
    // 先确保有数据
    await seedStudent(page, '编辑测试');
    await loginViaApi(page);
    await page.goto('/followups/history');
    await expect(page.locator('main').getByRole('heading', { name: '回访历史', exact: true })).toBeVisible();

    await page.locator('[title="编辑"]').first().click();
    await expect(page.getByRole('heading', { name: '编辑回访' })).toBeVisible();

    const newTopic = '编辑后的主题-' + Date.now();
    await page.getByLabel(/课程主题/).fill(newTopic);
    await page.getByRole('button', { name: '保存修改' }).click();

    await expect(page.getByRole('heading', { name: '编辑回访' })).toBeHidden();
    await expect(page.getByText(newTopic)).toBeVisible();
  });

  test('详情弹窗可查看完整内容', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/followups/history');

    await page.locator('[title="查看详情"]').first().click();
    await expect(page.getByRole('heading', { name: '回访详情' })).toBeVisible();
    await expect(page.getByText(/共 \d+ 条回访记录/)).toBeVisible();
  });
});

test.describe('分页', () => {
  test('记录超过一页时出现分页控件且可翻页', async ({ page }) => {
    await loginViaApi(page);

    // 造 25 条记录触发分页（每页 20 条）
    for (let i = 0; i < 25; i++) {
      await seedFollowUp(page, {
        studentName: '分页学生',
        topic: '分页-' + String(i).padStart(2, '0'),
      });
    }

    await page.goto('/followups/history');
    await expect(page.getByText(/第\s*1\s*\/\s*\d+\s*页/)).toBeVisible();

    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page.getByText(/第\s*2\s*\/\s*\d+\s*页/)).toBeVisible();

    await page.getByRole('button', { name: '上一页' }).click();
    await expect(page.getByText(/第\s*1\s*\/\s*\d+\s*页/)).toBeVisible();
  });
});
