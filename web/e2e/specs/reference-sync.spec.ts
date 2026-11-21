import { test, expect } from '@playwright/test';
import { loginAsNewUser } from './helpers';

test.describe('双向引用同步闭环', () => {
  test('观察更新提示 → 同步月报区块 → 观察页反向可见', async ({ page }) => {
    const token = await loginAsNewUser(page, 'refsync' + Date.now());
    const auth = { Authorization: 'Bearer ' + token };
    const studentResponse = await page.request.post('/api/students', {
      headers: auth,
      data: { name: '引用同步学生', grade: '五年级', subject: '数学' },
    });
    expect(studentResponse.ok(), await studentResponse.text()).toBeTruthy();
    const studentId = (await studentResponse.json()).student.id as number;
    const reportResponse = await page.request.post('/api/reports', {
      headers: auth,
      data: { studentId, yearMonth: '2026-11', grade: '五年级', subject: '数学' },
    });
    expect(reportResponse.ok(), await reportResponse.text()).toBeTruthy();
    const reportId = (await reportResponse.json()).report.id as number;
    const observationResponse = await page.request.post('/api/observations', {
      headers: auth,
      data: { topic: '分数除法听评课', lessonType: 'new', classNotes: '学生能借助图示解释分数除法' },
    });
    expect(observationResponse.ok(), await observationResponse.text()).toBeTruthy();
    const observationId = (await observationResponse.json()).observation.id as number;
    const generatedResponse = await page.request.post('/api/observations/' + observationId + '/report', { headers: auth, data: {} });
    expect(generatedResponse.ok(), await generatedResponse.text()).toBeTruthy();
    const observationReport = (await generatedResponse.json()).report as string;
    expect(observationReport.length).toBeGreaterThan(20);
    const referenceResponse = await page.request.post('/api/content/references', {
      headers: auth,
      data: { sourceType: 'report', sourceId: reportId, targetType: 'observation', targetId: observationId, refRole: 'derives_from' },
    });
    expect(referenceResponse.ok(), await referenceResponse.text()).toBeTruthy();

    await page.goto('/reports/' + reportId);
    await expect(page.getByText('来源有', { exact: false }).first()).toBeVisible();
    await page.getByLabel('同步来源字段').selectOption('report');
    await page.getByLabel('同步目标区块').selectOption('summary_intro');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /同步最新内容/ }).click();
    await expect(page.getByRole('textbox', { name: '本月总结', exact: true })).toHaveValue(observationReport);
    await expect(page.getByText('来源有', { exact: false })).toHaveCount(0);

    await page.goto('/observations/' + observationId);
    await page.getByRole('button', { name: /被引用于 \(1\)/ }).click();
    await expect(page.getByText('2026-11', { exact: false }).last()).toBeVisible();
  });
});
