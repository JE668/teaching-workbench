import { test, expect } from '@playwright/test';
import { loginViaApi, getToken, seedStudent, seedReport, seedReportItem } from './helpers';

/**
 * 月度总结 / 课程规划的「AI 编写」端到端。
 *
 * 这一条链是：点按钮 → SSE 流式回来 → 文字一段段填进输入框 → 完成时落库。
 * 后端单测已经验过提示词组装和注入点，这里只验浏览器这一侧真的会流式增长、
 * 两段走的是两套模板、完成后写回数据库。
 *
 * 注意：输入框本来就是空的，所以不会弹「替换现有文字」的确认框；
 * Playwright 默认会直接拒绝 confirm，误触会把用例静默掐掉。
 */

test.describe('月度总结 / 课程规划 · AI 编写', () => {
  test('总结点一下，正文逐段流式写进输入框并落库', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '总结AI同学', { grade: '初二', subject: '物理' });
    const reportId = await seedReport(page, {
      studentId,
      yearMonth: '2026-10',
      term: '秋季',
      grade: '初二',
      subject: '物理',
    });
    await seedReportItem(page, reportId, { kind: 'summary', content: '凸透镜成像的规律', type: '同步' });

    await page.goto('/reports/' + reportId);
    await expect(page.getByRole('heading', { name: '总结AI同学', exact: true })).toBeVisible();

    // 总结和规划各有一个「AI 编写」按钮，按位置取；输入框用 textbox 角色，
    // 不然 getByLabel 会把按钮的 aria-label（"AI 编写本月总结"）也一起匹配进来
    const area = page.getByRole('textbox', { name: '本月总结' });
    await page.getByRole('button', { name: /AI 编写/ }).first().click();

    // 逐步增长而不是一次性到位
    const lengths: number[] = [];
    for (let i = 0; i < 50; i++) {
      lengths.push((await area.textContent())?.length ?? 0);
      await page.waitForTimeout(100);
      if (await page.getByText('AI 编写完成').isVisible().catch(() => false)) break;
    }
    expect([...new Set(lengths.filter((n) => n > 0))].length).toBeGreaterThanOrEqual(3);

    await expect(page.getByText('AI 编写完成，可以直接改')).toBeVisible({ timeout: 15_000 });
    for (const line of ['📚课堂情况', '📖学习内容', '🎯本月收获', '📝本月不足', '💡建议', '🎯下月目标']) {
      await expect(area).toContainText(line);
    }

    // 完成时已经写回数据库
    const token = await getToken(page);
    const res = await page.request.get('/api/reports/' + reportId, {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(((await res.json()) as any).report.summary_intro).toContain('📚课堂情况');
  });

  test('规划走的是规划模板（不带 emoji，先总括再分点）', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '规划AI同学', { grade: '初二', subject: '物理' });
    const reportId = await seedReport(page, {
      studentId,
      yearMonth: '2026-10',
      term: '秋季',
      grade: '初二',
      subject: '物理',
    });
    await seedReportItem(page, reportId, { kind: 'plan', content: '分数混合运算' });

    await page.goto('/reports/' + reportId);
    await expect(page.getByRole('heading', { name: '规划AI同学', exact: true })).toBeVisible();

    const area = page.getByRole('textbox', { name: '本月规划' });
    await page.getByRole('button', { name: /AI 编写/ }).nth(1).click();

    await expect(area).toContainText('本月计划完成', { timeout: 15_000 });
    await expect(area).toContainText('1. 异分母分数加减法练习巩固');
    // 规划那段不带 emoji，也不会误写成总结的 7 段
    expect((await area.textContent()) || '').not.toContain('📚');
  });

  test('这块报告还没有课程时，AI 编写给出提示不发请求', async ({ page }) => {
    await loginViaApi(page);
    const studentId = await seedStudent(page, '空报告AI同学', { grade: '初二', subject: '物理' });
    const reportId = await seedReport(page, {
      studentId,
      yearMonth: '2026-10',
      term: '秋季',
      grade: '初二',
      subject: '物理',
    });

    await page.goto('/reports/' + reportId);
    await expect(page.getByRole('heading', { name: '空报告AI同学', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: /AI 编写/ }).first()).toBeDisabled();
  });
});
