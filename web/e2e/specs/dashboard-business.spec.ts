import { expect, test, type Page } from '@playwright/test';
import { loginAsNewUser } from './helpers';

function username(prefix: string): string {
  return (prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).slice(0, 32);
}

async function mockRenewal(page: Page): Promise<void> {
  const teacher = {
    tab: 'incentive', teacherName: '张明', teacherNo: 'T001', subjectGroup: '理科',
    baseCount: 20, prepaidCount: 8, prepaidRate: 40, renewedCount: 14, renewRate: 70, incentiveGap: 3,
    extra: {
      enroll_nongrad: 12, prepaid_nongrad: 5,
      enroll_g9: 4, prepaid_g9: 2,
      enroll_g12: 4, prepaid_g12: 1,
      enroll_0_80: 11, prepaid_0_80: 6,
      enroll_80p: 9, prepaid_80p: 2,
    },
    studentCount: 3,
    students: [
      { name: '李小四', status: 'renewed', slot: 1 },
      { name: '王小明', status: 'closed', slot: 2 },
      { name: '赵小华', status: 'prepaid', slot: 3 },
    ],
  };
  const stageTeacher = {
    ...teacher,
    tab: 'stage', baseCount: 306, prepaidCount: 226, prepaidRate: 73.9,
    renewedCount: null, renewRate: null, incentiveGap: null,
    extra: { ...teacher.extra, enroll_nongrad: 221, prepaid_nongrad: 160, enroll_g9: 64, prepaid_g9: 55, enroll_g12: 21, prepaid_g12: 11 },
  };
  await page.route('**/api/renewal/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    let body: unknown;
    if (path === '/api/renewal/reports') {
      body = { reports: [{
        reportId: 1, fileName: '2026年秋寒续费统计.xlsx', fileSize: 2403891,
        statMonth: '2026-10', centerName: '小榄龙山学习中心', rowCount: 547,
        errorCount: 0, status: 'committed', uploadedAt: '2026-11-18 20:00:00',
      }] };
    } else if (path.includes('/teacher-stats')) {
      const tab = requestUrl.searchParams.get('tab') || 'incentive';
      body = { tab, reportId: 1, rows: [tab === 'stage' ? stageTeacher : { ...teacher, tab }] };
    } else if (path.includes('/mentor-matrix')) {
      body = { matrix: {
        teachers: ['张明'], managers: ['郑淼林'], totalStudents: 20, totalPrepaid: 8, totalRenewed: 14,
        cells: [{ teacherName: '张明', managerName: '郑淼林', studentCount: 20, prepaidCount: 8, renewedCount: 14, prepaidRate: 40, renewRate: 70, students: [] }],
      } };
    } else if (path.includes('/teacher-grade-matrix')) {
      body = { matrix: {
        teachers: ['张明'], grades: ['初三'], totalStudents: 4, totalPrepaid: 2, totalRenewed: 3,
        cells: [{ teacherName: '张明', grade: '初三', studentCount: 4, prepaidCount: 2, renewedCount: 3, prepaidRate: 50, renewRate: 75, students: [] }],
      } };
    } else if (path.includes('/group-grade-matrix')) {
      body = { matrix: { subjectGroups: ['理科'], grades: ['初三'], cells: [], totalStudents: 0, totalPrepaid: 0, totalRenewed: 0 } };
    } else if (path.includes('/rate-overview')) {
      body = { overview: {
        byManager: [{ managerName: '郑淼林', prepaidRate: 40, renewRate: 70 }],
        byGroup: [{ subjectGroup: '理科', prepaidRate: 40, renewRate: 70 }],
      } };
    } else if (path.includes('/student-status')) {
      body = { reportId: 1, rows: [{ status: 'renewed', count: 14 }, { status: 'prepaid', count: 8 }, { status: 'closed', count: 1 }] };
    } else if (path.includes('/group-compare') || path.includes('/manager-perf') || path.includes('/funnel') || path.includes('/risk-list')) {
      body = { reportId: 1, rows: [] };
    } else {
      await route.fulfill({ status: 404, json: { error: 'unexpected browser mock: ' + path } });
      return;
    }
    await route.fulfill({ json: body });
  });
}

const reviewSummary = {
  month: '2026-11',
  workload: { followups: 2, reports: 1, observations: 1, lessonPlans: 3, lessonPlansConfirmed: 2, students: 3, total: 7 },
  quality: {
    aiCalls: 4, aiSuccessRate: 50, aiErrorCount: 1, aiRetryCount: 2, aiRetryRate: 50,
    retryAttempts: 3, totalTokens: 170, avgLatencyMs: 200,
    wordTarget: { measured: 2, inRange: 1, rate: 50 },
    funnel: [
      { key: 'calls', label: '发起调用', value: 4 },
      { key: 'success', label: '生成成功', value: 2 },
      { key: 'measured', label: '成功且有字数目标', value: 2 },
      { key: 'inRange', label: '字数达标', value: 1 },
    ],
    latencyWordCount: [{ endpoint: 'followup_stream', latencyMs: 100, wordCount: 120 }],
    byEndpoint: [
      { endpoint: 'followup_stream', calls: 2, successRate: 50, retryCount: 2, retryRate: 100, avgLatencyMs: 200 },
      { endpoint: 'followup_once', calls: 2, successRate: 50, retryCount: 0, retryRate: 0, avgLatencyMs: null },
    ],
  },
  masteryDistribution: [{ key: 'good', label: '良好', count: 2, percent: 100 }],
  dailyActivity: [{ day: '2026-11-03', n: 2 }],
  growth: [{ category: 'concept', total: 3, solid: 1, weak: 1, avgMastery: 0.6 }],
  growthSemantics: 'current_snapshot_student_weighted',
  monthlyKnowledgeDelta: [{ category: 'concept', delta: 0.3, evidenceCount: 2, semantics: 'sum_of_report_deltas_not_historical_mastery' }],
  followupQuality: { total: 2, avgWordCount: 150, structured: 2, structuredRate: 100, withImages: 1, imageRecordRate: 50, referenced: 1, historicalReferenceRate: 50, parentShared: 1, parentRead: 1, parentReadRate: 100 },
  groupComparisons: [{ groupId: 1, groupName: '五年级小组', studentCount: 2, masteryStudentCount: 2, avgMastery: 0.6, deltaStudentCount: 2, avgMasteryDelta: 0.15, deltaEvidenceCount: 2, followupCovered: 1, followupCoverageRate: 50 }],
  attendance: { sessions: 0, present: 0, rate: null },
  limitations: ['成长雷达是当前知识快照，不是所选月末的历史掌握度。'],
};

async function mockReview(page: Page): Promise<void> {
  await page.route('**/api/teaching-review/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access')) {
      await route.fulfill({ json: { canViewTeam: false } });
    } else if (path.endsWith('/summary')) {
      await route.fulfill({ json: reviewSummary });
    } else if (path.endsWith('/trend')) {
      await route.fulfill({ json: { months: 6, points: [
        { month: '2026-10', followups: 1, reports: 0, observations: 0, aiCalls: 2, aiSuccessRate: 80 },
        { month: '2026-11', followups: 2, reports: 1, observations: 1, aiCalls: 4, aiSuccessRate: 50 },
      ] } });
    } else if (path.endsWith('/students')) {
      await route.fulfill({ json: {
        totalStudents: 3, coveredStudents: 1, coldCount: 2, returnedCount: 3,
        students: [
          { studentId: 2, studentName: '未回访学生', grade: '五年级', subject: '数学', followups: 0, lastFollowupAt: null, cold: true },
          { studentId: 1, studentName: '已回访学生', grade: '五年级', subject: '数学', followups: 2, lastFollowupAt: '2026-11-03', cold: false },
        ],
      } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'unexpected browser mock: ' + path } });
    }
  });
}

test.describe('看板业务表达浏览器验收', () => {
  test('续费看板显示真实学段课时分布与教师学管矩阵', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('renewui'));
    await mockRenewal(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/renewal');

    await expect(page.getByRole('heading', { name: '续费看板', exact: true })).toBeVisible();
    await expect(page.getByText('20', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('306', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('226', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/非毕业班 160/).first()).toBeVisible();
    await page.getByRole('tab', { name: '学段', exact: true }).click();
    await expect(page.getByRole('img', { name: '非毕业班：在读 221 人，预存 160 人' })).toBeVisible();
    await expect(page.getByText('暂无续科数据', { exact: true })).toBeVisible();
    await expect(page.getByText('当前表未提供80%目标差额数据', { exact: true })).toBeVisible();
    const stageHeader = page.getByRole('columnheader', { name: '非毕业班在读', exact: true });
    await expect(stageHeader).toBeVisible();
    await expect(stageHeader).toHaveCSS('white-space', 'nowrap');
    await expect(page.getByRole('region', { name: '教师明细，可横向滚动' })).toBeVisible();
    await expect(page.getByText('左右滑动查看完整明细列', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /高一/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('renewal-stage.png'), fullPage: true });

    await page.getByRole('tab', { name: '课时', exact: true }).click();
    await expect(page.getByRole('img', { name: '0–80 课时：在读 11 人，预存 6 人' })).toBeVisible();
    await page.getByRole('tab', { name: '学管', exact: true }).click();
    await expect(page.getByText('教师 × 学管匹配矩阵', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '郑淼林', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: '教师×年级', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: '初三', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('renewal-mentor.png'), fullPage: true });
    expect(errors).toEqual([]);
  });

  test('教学复盘只显示业务名称、单位和真实成功率趋势', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('reviewui'));
    await mockReview(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/review');

    await expect(page.getByRole('region', { name: '课后回访（逐段生成）', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '课后回访（整篇生成）', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: '近 6 个月 AI 调用成功率趋势图' })).toBeVisible();
    await expect(page.getByText('较上月 -30 个百分点', { exact: true })).toBeVisible();
    await expect(page.getByText('200 毫秒', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText(/followup_(stream|once)/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('teaching-review-business.png'), fullPage: true });
    expect(errors).toEqual([]);
  });

  test('AI 指标看板三个视图都只显示课后回访业务名称', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('aimetrics'));
    await page.route('**/api/ai-metrics/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown;
      if (path.endsWith('/summary')) {
        body = { summary: [
          { group: 'followup_stream', calls: 8, success_count: 8, error_count: 0, retry_count: 1, avg_latency_ms: 1200, min_latency_ms: 900, max_latency_ms: 1500, total_tokens: 8000, prompt_tokens: 5000, completion_tokens: 3000, avg_word_count: 420, last_call: '2026-11-22T10:00:00', successRate: 100, errorRate: 0, retryRate: 12.5 },
          { group: 'followup_once', calls: 4, success_count: 3, error_count: 1, retry_count: 0, avg_latency_ms: 1800, min_latency_ms: 1300, max_latency_ms: 2300, total_tokens: 4000, prompt_tokens: 2500, completion_tokens: 1500, avg_word_count: 460, last_call: '2026-11-22T11:00:00', successRate: 75, errorRate: 25, retryRate: 0 },
        ] };
      } else if (path.endsWith('/timeseries')) {
        body = { data: [] };
      } else if (path.endsWith('/endpoints')) {
        body = { endpoints: [
          { endpoint: 'followup_stream', calls: 8, successRate: 100, errorRate: 0, avgLatencyMs: 1200, totalTokens: 8000, promptTokens: 5000, completionTokens: 3000, avgWordCount: 420, lastCall: '2026-11-22T10:00:00' },
          { endpoint: 'followup_once', calls: 4, successRate: 75, errorRate: 25, avgLatencyMs: 1800, totalTokens: 4000, promptTokens: 2500, completionTokens: 1500, avgWordCount: 460, lastCall: '2026-11-22T11:00:00' },
        ] };
      } else if (path.endsWith('/errors')) {
        body = { errors: [
          { provider: 'fixture', model: 'model-a', endpoint: 'followup_stream', error_message: 'fixture stream error', retry_count: 1, latency_ms: 1200, created_at: '2026-11-22T10:00:00' },
          { provider: 'fixture', model: 'model-b', endpoint: 'followup_once', error_message: 'fixture once error', retry_count: 0, latency_ms: 1800, created_at: '2026-11-22T11:00:00' },
        ] };
      } else {
        await route.fulfill({ status: 404, json: { error: 'unexpected browser mock: ' + path } });
        return;
      }
      await route.fulfill({ json: body });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/ai-metrics');

    await expect(page.getByText('课后回访（逐段生成）', { exact: true })).toBeVisible();
    await expect(page.getByText('课后回访（整篇生成）', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText(/followup_(stream|once)/)).toHaveCount(0);

    await page.getByRole('button', { name: '业务对比', exact: true }).click();
    await expect(page.getByText('边生成边展示回访内容', { exact: true })).toBeVisible();
    await expect(page.getByText('生成完成后一次返回完整回访', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText(/followup_(stream|once)/)).toHaveCount(0);

    await page.getByRole('button', { name: '错误记录', exact: true }).click();
    await expect(page.getByText('fixture stream error', { exact: true })).toBeVisible();
    await expect(page.getByText('课后回访（逐段生成）', { exact: true })).toBeVisible();
    await expect(page.getByText('课后回访（整篇生成）', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText(/followup_(stream|once)/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('ai-metrics-business.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
});
