import { test, expect, type Request } from '@playwright/test';
import { loginViaApi } from './helpers';

const EXPECTED_REPLY = "【课程主题】本节课讲了异分母分数加减法，重点是通分，进度到练习巩固。\n【课堂总结】小明这节课把通分原理理解得比较到位，听讲专注、主动举手，卡在通分那一步容易漏乘分子。\n【作业批改】批改了练习册第12页作业，错在异分母通分漏乘分子那两题，已逐题订正。\n【笔记/解题痕迹】笔记完整，在通分例题旁标注了步骤。\n【作业布置】布置练习册第15页1到8题，重点练通分，约20分钟。\n【学生收获】小明这次通分原理理解得比较到位，是收获最大的一点，独立计算速度还卡着。\n【课后任务】做练习册第15页1到8题，再每天10道口算，做完把错题照片发给我。";

test.describe('Task-6 SSE 真实浏览器断线续传', () => {
  test('首包后离线 10 秒，恢复后只补缺失内容并最终 done', async ({ page, context }) => {
    const streamRequests: Request[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/followups/generate/stream')) streamRequests.push(request);
    });

    await loginViaApi(page);
    await page.goto('/followups');
    await page.getByLabel(/学生姓名/).fill('断网恢复测试');
    await page.getByLabel(/课程主题/).fill('分数加减法');
    await page.getByLabel(/课堂表现/).fill('首包后离线十秒，上游仍继续生成');
    await page.getByRole('button', { name: /生成课后回访内容/ }).click();

    const content = page.getByTestId('generated-content');
    await expect(content).toContainText('【课程主题】', { timeout: 15_000 });
    const prefix = (await content.textContent()) || '';
    expect(prefix.length).toBeGreaterThan(0);
    expect(EXPECTED_REPLY.startsWith(prefix)).toBeTruthy();

    await context.setOffline(true);
    try {
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      // Chromium 离线开关可能保留已建立的 SSE socket；浏览器原生停止加载用于真实拆除在途响应。
      await page.evaluate(() => window.stop());
      await page.waitForTimeout(10_000);
    } finally {
      await context.setOffline(false);
    }
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);

    await expect
      .poll(async () => ((await content.textContent()) || '').trim(), { timeout: 20_000 })
      .toBe(EXPECTED_REPLY);
    await expect(page.getByRole('button', { name: /重新生成/ })).toBeEnabled();
    await expect(page.getByText('生成中断，请重试')).toHaveCount(0);

    const initialHeaders = await streamRequests[0]?.allHeaders();
    expect(initialHeaders?.['x-stream-id']).toBeUndefined();
    const resumeHeaders = [];
    for (const request of streamRequests.slice(1)) {
      const headers = await request.allHeaders();
      if (headers['x-stream-id']) resumeHeaders.push(headers);
    }
    expect(resumeHeaders.length, '恢复网络后必须发出带流身份的续传请求').toBeGreaterThan(0);
    const streamIds = new Set(resumeHeaders.map((headers) => headers['x-stream-id']));
    expect(streamIds.size).toBe(1);
    const cursors = resumeHeaders.map((headers) => Number(headers['last-event-id']));
    expect(cursors.every((cursor) => Number.isInteger(cursor) && cursor > 0)).toBeTruthy();
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
  });
});
