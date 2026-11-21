import { expect, test, type Page } from '@playwright/test';
import { loginAsNewUser, seedFollowUp } from './helpers';

function uniqueId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function uniqueUsername(prefix: string): string {
  return (prefix + '_' + uniqueId()).slice(0, 32);
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('无法确定 Asia/Shanghai 当前月份');
  return year + '-' + month;
}

function auth(token: string): { Authorization: string } {
  return { Authorization: 'Bearer ' + token };
}

async function createStudent(page: Page, token: string, name: string): Promise<number> {
  const response = await page.request.post('/api/students', {
    headers: auth(token),
    data: { name, grade: '小学五年级', subject: '数学' },
  });
  expect(response.ok(), '创建学生失败: ' + response.status() + ' ' + (await response.text())).toBeTruthy();
  return (await response.json()).student.id as number;
}

type LessonPlanRecord = {
  id: number;
  studentId: number | null;
  title: string;
  month: string;
  durationMinutes: number;
  weekCount: number;
  requirements: string;
  status: 'draft' | 'confirmed';
  confirmedAt: string | null;
  modelMetadata: { usedFallback?: boolean };
  plan: {
    month: string;
    weekly_lesson_plans: Array<{
      week: number;
      title: string;
      activities: Array<{ duration_minutes: number }>;
    }>;
  };
};

test.describe('优化功能真实浏览器验收', () => {
  test('LessonPlanner 生成兜底教案、编辑确认并持久化，其他教师不可读取', async ({ page }) => {
    const suffix = uniqueId();
    const token = await loginAsNewUser(page, uniqueUsername('optlesson'));
    const studentName = '备课学生-' + suffix;
    const studentId = await createStudent(page, token, studentName);
    const month = currentMonth();
    const requirements = '验收要求：保留分层作业并核对课堂活动 ' + suffix;
    const title = '验收教案-' + suffix;
    const firstWeekTitle = '第一周验收主题-' + suffix;

    await page.goto('/lesson-planner');
    await expect(page.getByRole('heading', { name: '备课参数', exact: true })).toBeVisible();
    await expect(page.getByLabel('学生').locator('option[value="' + studentId + '"]')).toHaveCount(1);
    await page.getByLabel('学生').selectOption(String(studentId));
    await page.getByLabel('月份', { exact: true }).fill(month);
    await page.getByLabel('课时时长（分钟）', { exact: true }).fill('45');
    await page.getByLabel('规划周数', { exact: true }).fill('2');
    await page.getByLabel('补充要求', { exact: true }).fill(requirements);

    const generateResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/lesson-plans/generate') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '生成教案', exact: true }).click();
    const generateResponse = await generateResponsePromise;
    expect(generateResponse.status()).toBe(201);
    const generated = (await generateResponse.json()).plan as LessonPlanRecord;
    expect(generated.studentId).toBe(studentId);
    expect(generated.month).toBe(month);
    expect(generated.durationMinutes).toBe(45);
    expect(generated.weekCount).toBe(2);
    expect(generated.requirements).toBe(requirements);
    expect(generated.status).toBe('draft');
    expect(generated.modelMetadata.usedFallback).toBe(true);
    expect(generated.plan.month).toBe(month);
    expect(generated.plan.weekly_lesson_plans.map((week) => week.week)).toEqual([1, 2]);

    // 当前 E2E mock 不产出合法教案 JSON，必须明确展示本地兜底，而不能冒充模型成功。
    await expect(page.getByText('这份教案来自本地兜底模板，并非模型生成结果，请逐项核对后再用于课堂。', { exact: true })).toBeVisible();
    await page.getByLabel('教案名称', { exact: true }).fill(title);
    const weekTitleInput = page.getByText('本周主题', { exact: true }).locator('..').locator('input');
    await weekTitleInput.fill(firstWeekTitle);

    const updateResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/lesson-plans/' + generated.id) && response.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: '确认教案', exact: true }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.ok()).toBeTruthy();
    const confirmed = (await updateResponse.json()).plan as LessonPlanRecord;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).not.toBeNull();
    await expect(page.getByText('已确认，备课完成', { exact: true })).toBeVisible();

    const persistedResponse = await page.request.get('/api/lesson-plans/' + generated.id, { headers: auth(token) });
    expect(persistedResponse.ok()).toBeTruthy();
    const persisted = (await persistedResponse.json()).plan as LessonPlanRecord;
    expect(persisted.title).toBe(title);
    expect(persisted.studentId).toBe(studentId);
    expect(persisted.month).toBe(month);
    expect(persisted.durationMinutes).toBe(45);
    expect(persisted.weekCount).toBe(2);
    expect(persisted.requirements).toBe(requirements);
    expect(persisted.status).toBe('confirmed');
    expect(persisted.confirmedAt).not.toBeNull();
    expect(persisted.plan.weekly_lesson_plans).toHaveLength(2);
    expect(persisted.plan.weekly_lesson_plans[0].title).toBe(firstWeekTitle);
    for (const week of persisted.plan.weekly_lesson_plans) {
      expect(week.activities.length).toBeGreaterThanOrEqual(2);
      expect(week.activities.reduce((sum, activity) => sum + activity.duration_minutes, 0)).toBe(45);
    }

    // 重新加载后从历史列表打开，确认不是只保存在 React 状态中。
    await page.reload();
    const historyItem = page.getByRole('button').filter({ hasText: title });
    await expect(historyItem).toBeVisible();
    await historyItem.click();
    await expect(page.getByLabel('教案名称', { exact: true })).toHaveValue(title);
    await expect(weekTitleInput).toHaveValue(firstWeekTitle);

    const otherToken = await loginAsNewUser(page, uniqueUsername('optother'));
    const otherRead = await page.request.get('/api/lesson-plans/' + generated.id, { headers: auth(otherToken) });
    expect(otherRead.status()).toBe(404);
    expect((await otherRead.json()).error).toBe('教案不存在');
    const otherList = await page.request.get('/api/lesson-plans?limit=50', { headers: auth(otherToken) });
    expect(otherList.ok()).toBeTruthy();
    expect((await otherList.json()).plans).toEqual([]);
  });

  test('ParentView 公开阅读、真实摘要、已读与反馈均可持久化', async ({ page }) => {
    const suffix = uniqueId();
    const teacherToken = await loginAsNewUser(page, uniqueUsername('optparent'));
    const studentName = '家长学生-' + suffix;
    const studentId = await createStudent(page, teacherToken, studentName);
    const followupId = await seedFollowUp(page, {
      studentId,
      studentName,
      grade: '小学五年级',
      subject: '数学',
      topic: '分数通分验收-' + suffix,
      content: '【课堂内容】学习分数通分。【课堂表现】能独立完成基础题。【作业情况】按时完成。【后续计划】继续检查错题。【家校沟通】请家长反馈。',
      mastery: 'good',
    }, teacherToken);

    const shareResponse = await page.request.post('/api/parent-view/followup/' + followupId, {
      headers: auth(teacherToken),
      data: { expiresDays: 7 },
    });
    expect(shareResponse.ok(), '创建家长链接失败: ' + shareResponse.status() + ' ' + (await shareResponse.text())).toBeTruthy();
    const share = (await shareResponse.json()).data as {
      accessToken: string;
      viewData: {
        key_progress: string[];
        focus_areas: string[];
        action_for_parent: string;
        teacher_note: string;
      };
    };
    expect(share.viewData.key_progress.length).toBeGreaterThanOrEqual(3);
    expect(share.viewData.focus_areas.length).toBeGreaterThanOrEqual(2);
    expect(share.viewData.action_for_parent.trim()).not.toBe('');
    expect(share.viewData.teacher_note.trim()).not.toBe('');

    const seededPublicResponse = await page.request.get('/api/parent-view/' + share.accessToken);
    expect(seededPublicResponse.ok()).toBeTruthy();
    const seededPublic = (await seededPublicResponse.json()).data;
    expect(seededPublic.studentName).toBe(studentName);
    expect(seededPublic.subject).toBe('数学');
    expect(seededPublic.sourceType).toBe('followup');
    expect(seededPublic.sourceId).toBe(followupId);
    expect(seededPublic.viewData).toEqual(share.viewData);
    expect(seededPublic.readAt).toBeNull();
    expect(seededPublic.parentFeedback).toBeNull();

    // 清除教师登录态后打开公开链接，验证页面不依赖工作台会话。
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });
    const readResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/parent-view/' + share.accessToken + '/read') && response.request().method() === 'POST'
    );
    await page.goto('/parent-view/' + share.accessToken);
    await expect(page.getByRole('heading', { name: studentName + '的学习反馈', exact: true })).toBeVisible();
    await expect(page.getByText('课后回访', { exact: true })).toBeVisible();
    for (const item of share.viewData.key_progress) {
      await expect(page.getByText(item, { exact: true })).toBeVisible();
    }
    for (const item of share.viewData.focus_areas) {
      await expect(page.getByText(item, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(share.viewData.action_for_parent, { exact: true })).toBeVisible();
    await expect(page.getByText(share.viewData.teacher_note, { exact: true })).toBeVisible();
    const readResponse = await readResponsePromise;
    expect(readResponse.ok()).toBeTruthy();

    const publicRead = await page.request.get('/api/parent-view/' + share.accessToken);
    expect(publicRead.ok()).toBeTruthy();
    const beforeFeedback = (await publicRead.json()).data;
    expect(beforeFeedback.studentName).toBe(studentName);
    expect(beforeFeedback.sourceType).toBe('followup');
    expect(beforeFeedback.sourceId).toBe(followupId);
    expect(beforeFeedback.readAt).not.toBeNull();
    expect(beforeFeedback.parentFeedback).toBeNull();

    const expectedFeedback = '孩子已按约定整理错题，下周会继续检查。-' + suffix;
    const feedbackResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/parent-view/' + share.accessToken + '/feedback') && response.request().method() === 'POST'
    );
    await page.getByLabel('反馈内容', { exact: true }).fill('  ' + expectedFeedback + '  ');
    await page.getByRole('button', { name: '提交反馈', exact: true }).click();
    const feedbackResponse = await feedbackResponsePromise;
    expect(feedbackResponse.ok()).toBeTruthy();
    await expect(page.getByText('反馈已提交，老师可以在工作台查看', { exact: true })).toBeVisible();
    await expect(page.getByText(expectedFeedback, { exact: true })).toBeVisible();
    await expect(page.getByLabel('反馈内容', { exact: true })).toHaveCount(0);

    const afterFeedbackResponse = await page.request.get('/api/parent-view/' + share.accessToken);
    expect(afterFeedbackResponse.ok()).toBeTruthy();
    const afterFeedback = (await afterFeedbackResponse.json()).data;
    expect(afterFeedback.parentFeedback).toBe(expectedFeedback);
    expect(afterFeedback.readAt).toBe(beforeFeedback.readAt);

    await page.reload();
    await expect(page.getByText('反馈已提交，老师可以在工作台查看', { exact: true })).toBeVisible();
    await expect(page.getByText(expectedFeedback, { exact: true })).toBeVisible();
    const afterReloadResponse = await page.request.get('/api/parent-view/' + share.accessToken);
    expect(afterReloadResponse.ok()).toBeTruthy();
    const afterReload = (await afterReloadResponse.json()).data;
    expect(afterReload.parentFeedback).toBe(expectedFeedback);
    expect(afterReload.readAt).toBe(beforeFeedback.readAt);
  });

  test('ParentView 无效链接明确失败且不渲染反馈表单', async ({ page }) => {
    await page.goto('/parent-view/invalid-' + uniqueId());
    await expect(page.getByRole('heading', { name: '暂时无法查看', exact: true })).toBeVisible();
    await expect(page.getByText('链接不存在或已过期，请联系老师重新生成。', { exact: true })).toBeVisible();
    await expect(page.getByLabel('反馈内容', { exact: true })).toHaveCount(0);
  });

  test('TeachingReview 按独立账号实时聚合掌握度、月份切换和学生覆盖', async ({ page }) => {
    const suffix = uniqueId();
    const token = await loginAsNewUser(page, uniqueUsername('optreview'));
    const coveredName = '已回访学生-' + suffix;
    const coldName = '待回访学生-' + suffix;
    const coveredId = await createStudent(page, token, coveredName);
    await createStudent(page, token, coldName);
    const common = {
      studentId: coveredId,
      studentName: coveredName,
      grade: '小学五年级',
      subject: '数学',
      content: '【课堂内容】分数练习。【课堂表现】已完成课堂反馈。【作业情况】按时完成。【后续计划】巩固。【家校沟通】继续保持。',
    };
    await seedFollowUp(page, { ...common, topic: '良好记录-' + suffix, mastery: 'good' }, token);
    await seedFollowUp(page, { ...common, topic: '需加强记录-' + suffix, mastery: 'needs_improvement' }, token);

    await page.goto('/review');
    await expect(page.locator('main').getByRole('heading', { name: '教学复盘', exact: true })).toBeVisible();
    const monthInput = page.locator('main input[type="month"]');
    const month = currentMonth();
    await expect(monthInput).toHaveValue(month);
    const followupMetric = page.getByText('本月新写的课后回访', { exact: true }).locator('..');
    await expect(followupMetric.locator('p').first()).toHaveText('2篇');
    await expect(page.getByText('1 篇 · 50%', { exact: true })).toHaveCount(2);
    await expect(page.getByText('良好', { exact: true })).toBeVisible();
    await expect(page.getByText('需加强', { exact: true })).toBeVisible();
    await expect(page.getByText('学生总数', { exact: true }).locator('..').locator('p').first()).toHaveText('2');
    await expect(page.getByText('本月已回访', { exact: true }).locator('..').locator('p').first()).toHaveText('1');
    await expect(page.getByText('本月未回访', { exact: true }).locator('..').locator('p').first()).toHaveText('1');
    await expect(page.getByRole('button').filter({ hasText: coldName })).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: coveredName })).toHaveCount(0);

    // 切到无记录月份时，旧月份指标必须被清空，不能沿用“2篇/50%”。
    await monthInput.fill('2000-01');
    await expect(followupMetric.locator('p').first()).toHaveText('0篇');
    await expect(page.getByText('本月还没有填写掌握程度的回访', { exact: true })).toBeVisible();
    await expect(page.getByText('本月已回访', { exact: true }).locator('..').locator('p').first()).toHaveText('0');
    await expect(page.getByText('本月未回访', { exact: true }).locator('..').locator('p').first()).toHaveText('2');
    await expect(page.getByRole('button').filter({ hasText: coveredName })).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: coldName })).toBeVisible();

    await page.getByRole('button', { name: '回到本月', exact: true }).click();
    await expect(monthInput).toHaveValue(month);
    await expect(followupMetric.locator('p').first()).toHaveText('2篇');
    await expect(page.getByText('1 篇 · 50%', { exact: true })).toHaveCount(2);
    await expect(page.getByText('本月未回访', { exact: true }).locator('..').locator('p').first()).toHaveText('1');
    await expect(page.getByRole('button').filter({ hasText: coldName })).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: coveredName })).toHaveCount(0);
  });

  test('KnowledgeBase 创建并加入共享教研组，一次性邀请码不能跨成员重放', async ({ page }) => {
    const suffix = uniqueId();
    const groupName = '验收教研组-' + suffix;
    const ownerToken = await loginAsNewUser(page, uniqueUsername('optkbowner'));
    await page.goto('/knowledge');
    await page.getByLabel('新教研组名称', { exact: true }).fill(groupName);
    await page.getByLabel('新组科目', { exact: true }).selectOption('数学');

    const createResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/knowledge/groups') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '创建教研组', exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    const groupId = created.group.id as number;
    expect(created.group.name).toBe(groupName);
    expect(created.group.subject_group).toBe('数学');
    expect(created.group.role).toBe('owner');
    expect(created.group.member_count).toBe(1);
    expect(created.notice).toContain('只能由一位新成员使用');

    const codeLocator = page.getByRole('status').filter({ hasText: '一次性邀请码（仅本次显示，请通过安全渠道发送）' }).locator('code');
    await expect(codeLocator).toBeVisible();
    const joinCode = (await codeLocator.textContent())?.trim() || '';
    expect(joinCode.length).toBeGreaterThanOrEqual(20);
    expect(joinCode).toBe(created.joinCode);
    await expect(page.getByLabel('知识库范围', { exact: true })).toHaveValue(String(groupId));
    await expect(page.getByRole('button', { name: '增量索引', exact: true })).toBeDisabled();

    const memberToken = await loginAsNewUser(page, uniqueUsername('optkbmember'));
    await page.goto('/knowledge');
    await page.getByLabel('一次性邀请码', { exact: true }).fill(joinCode);
    const joinResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/knowledge/groups/join') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: '加入教研组', exact: true }).click();
    const joinResponse = await joinResponsePromise;
    expect(joinResponse.ok()).toBeTruthy();
    const joined = await joinResponse.json();
    expect(joined.alreadyMember).toBe(false);
    expect(joined.group.id).toBe(groupId);
    expect(joined.group.role).toBe('member');
    expect(joined.group.member_count).toBe(2);
    await expect(page.getByLabel('知识库范围', { exact: true })).toHaveValue(String(groupId));
    await expect(page.getByText('共享范围：' + groupName, { exact: true }).locator('..')).toContainText('2 名成员');
    await expect(page.getByRole('button', { name: '增量索引', exact: true })).toBeDisabled();

    const ownerGroupsResponse = await page.request.get('/api/knowledge/groups', { headers: auth(ownerToken) });
    const memberGroupsResponse = await page.request.get('/api/knowledge/groups', { headers: auth(memberToken) });
    expect(ownerGroupsResponse.ok()).toBeTruthy();
    expect(memberGroupsResponse.ok()).toBeTruthy();
    const ownerGroups = (await ownerGroupsResponse.json()).groups;
    const memberGroups = (await memberGroupsResponse.json()).groups;
    expect(ownerGroups).toHaveLength(1);
    expect(memberGroups).toHaveLength(1);
    expect(ownerGroups[0]).toMatchObject({ id: groupId, name: groupName, role: 'owner', member_count: 2 });
    expect(memberGroups[0]).toMatchObject({ id: groupId, name: groupName, role: 'member', member_count: 2 });

    // 第三个独立账号重放同一邀请码必须失败，且不能借此看到该组。
    const thirdToken = await loginAsNewUser(page, uniqueUsername('optkbthird'));
    const replay = await page.request.post('/api/knowledge/groups/join', {
      headers: auth(thirdToken),
      data: { joinCode },
    });
    expect(replay.status()).toBe(400);
    expect((await replay.json()).error).toBe('邀请码无效或已使用');
    const thirdGroups = await page.request.get('/api/knowledge/groups', { headers: auth(thirdToken) });
    expect(thirdGroups.ok()).toBeTruthy();
    expect((await thirdGroups.json()).groups).toEqual([]);
  });
});
