import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loginAsNewUser } from './helpers';

function username(prefix: string): string {
  return (prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).slice(0, 32);
}

async function mockRenewal(page: Page, options: { riskCount?: number } = {}): Promise<void> {
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
  const hourTeacher = {
    ...teacher, tab: 'hours', studentCount: 10,
    students: [
      { name: '李小四', status: 'renewed', slot: 1 },
      { name: '王小明', status: 'closed', slot: 2 },
      { name: '赵小华', status: 'prepaid', slot: 3 },
      { name: '24-40预存', status: 'prepaid', slot: 9 },
      { name: '40-60在读', status: 'normal', slot: 19 },
      { name: '40-60续费', status: 'renewed', slot: 20 },
      { name: '60-80预存', status: 'prepaid', slot: 24 },
      { name: '80+在读', status: 'normal', slot: 29 },
      { name: '80+预存', status: 'prepaid', slot: 30 },
      { name: '新增续费不重复计入', status: 'prepaid', slot: 35 },
    ],
  };
  const followUps: Array<Record<string, unknown>> = [];
  let managerRows: Array<Record<string, unknown>> = [{
    managerName: '郑淼林',
    renew: { one2one: 40, one2many: 10, small: 2, other: 0, total: 52 },
    newsign: { one2one: 18, one2many: 4, small: 0, other: 0, total: 22 },
    renewedCount: 26, tutoredCount: 34, renewRate: 76.5,
    taskAmount: 100, importedTaskAmount: 100,
    productTargets: { one2one: 50, one2many: 10, small: 2, other: null },
    productCashflow: { one2one: 58, one2many: 14, small: 2, other: 0, total: 74 },
    cashflowTotal: 74, completionRate: 74, actualStudents: 31,
    perStudent: 74 / 31, avgOrder: 8.9, gap80: 6,
  }];
  const riskCount = options.riskCount ?? 1;
  const riskRows = Array.from({ length: riskCount }, (_, index) => ({
    studentKey: `S${String(index + 1).padStart(3, '0')}`, sourceRow: 7 + index,
    managerName: '郑淼林', studentId: `S${String(index + 1).padStart(3, '0')}`,
    studentName: riskCount === 1 ? '测试学生' : `测试学生 ${index + 1}`,
    grade: '五年级', courseProduct: '数学一对一', enrollDays: 90 + index,
    coef: 1, type: '在读', classLast2: 0, classLast1: 0,
  }));
  const comparison = (current: number | null, previous: number | null) => ({
    current, previous, delta: current === null || previous === null ? null : current - previous,
  });
  const teacherMetrics = (baseCount: number, prepaidCount: number, renewedCount: number | null) => ({
    baseCount, prepaidCount, prepaidRate: Number((prepaidCount / baseCount * 100).toFixed(1)),
    renewedCount, renewRate: renewedCount === null ? null : Number((renewedCount / baseCount * 100).toFixed(1)),
    incentiveGap: null, studentCount: 3, extra: {},
  });
  await page.route('**/api/renewal/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    let body: unknown;
    if (path === '/api/renewal/reports') {
      body = { reports: [{
        reportId: 1, fileName: '2026年秋寒续费统计.xlsx', fileSize: 2403891,
        statMonth: '2026-11', centerName: '小榄龙山学习中心', rowCount: 547,
        errorCount: 0, status: 'committed', uploadedAt: '2026-11-18 20:00:00',
      }, {
        reportId: 2, fileName: '2026年秋季续费统计.xlsx', fileSize: 2300000,
        statMonth: '2026-10', centerName: '小榄龙山学习中心', rowCount: 540,
        errorCount: 0, status: 'committed', uploadedAt: '2026-10-18 20:00:00',
      }] };
    } else if (path.includes('/teacher-stats')) {
      const tab = requestUrl.searchParams.get('tab') || 'stage';
      const reportId = Number(requestUrl.searchParams.get('reportId') || 1);
      body = { tab, reportId, rows: [tab === 'stage'
        ? { ...stageTeacher, baseCount: reportId === 2 ? 300 : 306, prepaidCount: reportId === 2 ? 220 : 226 }
        : tab === 'hours' ? hourTeacher : { ...teacher, tab }] };
    } else if (path.includes('/mentor-matrix')) {
      body = { matrix: {
        teachers: ['张明'], managers: ['郑淼林', '林家琪', '李厚旺', '林碧桃', '何欣渝', '李文梅'], totalStudents: 20, totalPrepaid: 8, totalRenewed: 14,
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
    } else if (path.includes('/compare')) {
      body = {
        tab: 'stage',
        currentReport: { reportId: 1, fileName: 'current.xlsx', fileSize: 1, statMonth: '2026-11', centerName: '小榄龙山学习中心', rowCount: 1, errorCount: 0, status: 'committed', uploadedAt: '2026-11-18 20:00:00' },
        previousReport: { reportId: 2, fileName: 'previous.xlsx', fileSize: 1, statMonth: '2026-10', centerName: '小榄龙山学习中心', rowCount: 1, errorCount: 0, status: 'committed', uploadedAt: '2026-10-18 20:00:00' },
        summary: {
          baseCount: comparison(306, 300), prepaidCount: comparison(226, 220), prepaidRate: comparison(73.9, 73.3),
          renewedCount: comparison(null, null), renewRate: comparison(null, null), incentiveGap: comparison(null, null),
          studentCount: comparison(3, 3), extra: { prepaid_nongrad: comparison(160, 155) },
        },
        teachers: [{ teacherKey: 'no:T001', teacherName: '张明', teacherNo: 'T001', subjectGroup: '理科', current: teacherMetrics(306, 226, null), previous: teacherMetrics(300, 220, null), delta: { ...teacherMetrics(6, 6, null), baseCount: 6, prepaidCount: 6, prepaidRate: 0.6, renewedCount: null, renewRate: null, incentiveGap: null, studentCount: 0, extra: {} } }],
      };
    } else if (path.includes('/risk-followups/') && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      const studentKey = decodeURIComponent(path.split('/').pop() || '');
      const record = { reportId: Number(requestUrl.searchParams.get('reportId')), studentKey, ...input, updatedBy: 1, createdAt: '2026-11-23 09:00:00', updatedAt: '2026-11-23 09:00:00' };
      const existing = followUps.findIndex(item => item.studentKey === studentKey);
      if (existing >= 0) followUps[existing] = record;
      else followUps.push(record);
      body = { record };
    } else if (path.endsWith('/risk-followups')) {
      body = { reportId: Number(requestUrl.searchParams.get('reportId')), records: followUps };
    } else if (path.includes('/manager-targets') && route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { targets: Array<{ managerName: string; targetAmount: number | null; productTargets: Record<string, number | null> | null }> };
      const target = payload.targets[0];
      managerRows = managerRows.map(row => {
        if (row.managerName !== target.managerName) return row;
        const taskAmount = target.targetAmount ?? row.importedTaskAmount as number;
        const cashflowTotal = row.cashflowTotal as number;
        return {
          ...row,
          taskAmount,
          productTargets: target.productTargets ?? { one2one: null, one2many: null, small: null, other: null },
          completionRate: taskAmount > 0 ? cashflowTotal / taskAmount * 100 : null,
          gap80: taskAmount * 0.8 - cashflowTotal,
        };
      });
      body = { reportId: 1, rows: managerRows };
    } else if (path.includes('/manager-targets') || path.includes('/manager-perf')) {
      body = { reportId: 1, rows: managerRows };
    } else if (path.includes('/group-compare')) {
      body = { reportId: 1, rows: [] };
    } else if (path.includes('/funnel')) {
      body = { reportId: 1, rows: [{ managerName: '郑淼林', students: 20, classedLast2: 18, classedLast1: 15, renewed: 14 }] };
    } else if (path.includes('/risk-list')) {
      const pageNumber = Math.max(1, Number(requestUrl.searchParams.get('page')) || 1);
      const pageSize = Math.max(1, Number(requestUrl.searchParams.get('pageSize')) || 50);
      body = {
        reportId: 1,
        rows: riskRows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: riskRows.length, page: pageNumber, pageSize,
        totalPages: Math.ceil(riskRows.length / pageSize),
        hasMore: pageNumber * pageSize < riskRows.length,
      };
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
    const riskRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.url().includes('/risk-list')) riskRequests.push(request.url()); });
    await page.goto('/renewal');

    await expect(page.getByRole('heading', { name: '续费看板', exact: true })).toBeVisible();
    await expect(page.getByText('306', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('226', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('非毕业班预存', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('160', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('李小四', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '查看 3 名学生明细', exact: true }).click();
    await expect(page.getByText('李小四', { exact: true })).toBeVisible();
    await expect(page.getByText('李小四', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '收起 3 名学生明细', exact: true }).click();
    await expect(page.getByText('李小四', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: '学段', exact: true }).click();
    await expect(page.getByRole('img', { name: '非毕业班：在读 221 人，预存 160 人' })).toBeVisible();
    await expect(page.getByRole('group', { name: '非毕业班预存率', exact: true })).toContainText('72.4%');
    await expect(page.getByRole('group', { name: '非毕业班预存率', exact: true })).toContainText('预存 160 人 ÷ 在读 221 人');
    await expect(page.getByRole('group', { name: '初三预存率', exact: true })).toContainText('85.9%');
    await expect(page.getByRole('group', { name: '高三预存率', exact: true })).toContainText('52.4%');
    await expect(page.getByRole('heading', { name: '预存率优先 TOP 10', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '非毕业班预存 TOP 10', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '—', exact: true })).toHaveCount(3);
    await expect(page.getByText('所有老师都已达标', { exact: true })).toHaveCount(0);
    const stageHeader = page.getByRole('columnheader', { name: '非毕业班在读', exact: true });
    await expect(stageHeader).toBeVisible();
    await expect(stageHeader).toHaveCSS('white-space', 'nowrap');
    await expect(page.getByRole('region', { name: '教师明细，可横向滚动' })).toBeVisible();
    await expect(page.getByText('左右滑动查看完整明细列', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /高一/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('renewal-stage.png'), fullPage: true });

    await page.getByRole('tab', { name: '课时', exact: true }).click();
    const expectedHours = [
      ['0–24', 3, 1], ['24–40', 1, 1], ['40–60', 2, 0], ['60–80', 1, 1], ['80+', 2, 1],
    ] as const;
    for (const [label, enrolled, prepaid] of expectedHours) {
      await expect(page.getByRole('img', { name: `${label} 课时：在读 ${enrolled} 人，预存 ${prepaid} 人` })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: `${label}课时在读`, exact: true })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: `${label}课时预存`, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('img', { name: /^0–80 课时/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('renewal-hours.png'), fullPage: true });
    await page.getByRole('tab', { name: '学管', exact: true }).click();
    await expect(page.getByText('教师 × 学管匹配矩阵', { exact: true })).toBeVisible();
    await expect(page.getByText('共 6 名学管', { exact: true })).toBeVisible();
    for (const managerName of ['郑淼林', '林家琪', '李厚旺', '林碧桃', '何欣渝', '李文梅']) {
      await expect(page.getByRole('columnheader', { name: managerName, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: '教师 × 学管匹配矩阵，可横向滚动', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('renewal-mentor.png'), fullPage: true });
    await page.getByRole('radio', { name: '教师×年级', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: '初三', exact: true })).toBeVisible();
    expect(riskRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('学管业绩可编辑任务并区分四产品现金流', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('managerTargets'));
    await mockRenewal(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/renewal');
    await page.getByRole('tab', { name: '学管业绩', exact: true }).click();
    await expect(page.getByRole('heading', { name: '分产品现金流', exact: true })).toBeVisible();
    for (const product of ['一对一', '一对多', '小班', '其他']) {
      await expect(page.getByRole('row', { name: `郑淼林 ${product}现金流`, exact: true })).toBeVisible();
    }
    const one2one = page.getByRole('row', { name: '郑淼林 一对一现金流', exact: true });
    await expect(one2one).toContainText('116.0%');
    await page.getByRole('button', { name: '设置现金流任务', exact: true }).click();
    await page.getByRole('textbox', { name: '郑淼林 总任务', exact: true }).fill('200');
    await page.getByRole('textbox', { name: '郑淼林 一对一目标', exact: true }).fill('100');
    await page.getByRole('button', { name: '保存 郑淼林任务', exact: true }).click();
    await expect(page.getByText('郑淼林现金流任务已保存', { exact: true })).toBeVisible();
    await expect(page.getByText('已调整', { exact: true })).toBeVisible();
    await expect(one2one).toContainText('58.0%');
    await page.screenshot({ path: testInfo.outputPath('manager-product-cashflow.png'), fullPage: true });
    await page.getByRole('button', { name: '设置现金流任务', exact: true }).click();
    await page.getByRole('button', { name: '恢复 郑淼林 Excel 任务', exact: true }).click();
    await expect(page.getByText('郑淼林已恢复 Excel 任务', { exact: true })).toBeVisible();
    await expect(page.getByText('已调整', { exact: true })).toHaveCount(0);
    await expect(one2one).toContainText('—');
    expect(errors).toEqual([]);
  });

  test('续费看板支持多期对比、当前视图导出和学生跟进', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('renewaction'));
    await mockRenewal(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/renewal');
    await expect(page.getByRole('heading', { name: '续费看板', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '多期对比', exact: true }).click();
    await page.getByLabel('选择对比批次', { exact: true }).selectOption('2');
    await expect(page.getByText('对比期：300', { exact: true })).toBeVisible();
    await expect(page.getByText('对比期：220', { exact: true })).toBeVisible();
    await expect(page.getByText('+0.6 个百分点', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('renewal-comparison.png'), fullPage: true, animations: 'disabled' });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前视图', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('教师统计-stage.csv');
    await download.saveAs(testInfo.outputPath('renewal-stage.csv'));

    await page.getByRole('tab', { name: '待关注学生', exact: true }).click();
    await page.getByRole('button', { name: '记录跟进', exact: true }).click();
    await page.getByRole('textbox', { name: /跟进负责人/ }).fill('测试负责人');
    await page.getByLabel('跟进状态', { exact: true }).selectOption('contacted');
    await page.getByLabel('下次跟进日期', { exact: true }).fill('2026-12-01');
    await page.getByLabel('沟通与处置记录', { exact: true }).fill('已沟通，约定下次继续跟进');
    await page.getByRole('button', { name: '保存跟进', exact: true }).click();
    await expect(page.getByRole('table').getByText('已联系', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑跟进', exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: '待关注学生', exact: true }).click();
    await expect(page.getByRole('table').getByText('已联系', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '编辑跟进', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /跟进负责人/ })).toHaveValue('测试负责人');
    const modalBox = page.locator('.fixed.inset-0.z-50 > div').nth(1);
    await expect(modalBox).toHaveCSS('opacity', '1');
    await expect(modalBox).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.waitForTimeout(350);
    await page.screenshot({ path: testInfo.outputPath('renewal-risk-followup.png'), fullPage: true, animations: 'disabled' });
    expect(errors).toEqual([]);
  });


  test('待关注学生跨页搜索、负责人筛选导出与弹窗键盘操作', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('renewrisk'));
    await mockRenewal(page, { riskCount: 201 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/renewal');
    await page.getByRole('tab', { name: '待关注学生', exact: true }).click();

    await expect(page.getByText(/显示 201 \/ 201 人/)).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(50);
    await expect(page.getByText(/第 1 \/ 5 页/)).toBeVisible();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByText('测试学生 51', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('renewal-risk-workbench.png'), fullPage: true, animations: 'disabled' });

    await page.getByPlaceholder('搜索学生或跟进内容').fill('测试学生 201');
    await expect(page.getByText(/显示 1 \/ 201 人/)).toBeVisible();
    const trigger = page.getByRole('button', { name: '记录跟进', exact: true });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: '跟进 测试学生 201', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('textbox', { name: /跟进负责人/ }).fill('测试负责人');
    await page.getByLabel('跟进状态', { exact: true }).selectOption('contacted');
    await page.getByLabel('沟通与处置记录').fill('已沟通，等待下次跟进');
    await page.getByRole('button', { name: '保存跟进', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑跟进', exact: true })).toBeVisible();

    await page.getByPlaceholder('搜索学生或跟进内容').fill('');
    await page.getByLabel('按跟进负责人筛选', { exact: true }).selectOption('测试负责人');
    await expect(page.getByText(/显示 1 \/ 201 人/)).toBeVisible();
    await expect(page.getByText('测试学生 201', { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出筛选结果', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('筛选结果');
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('测试学生 201');
    expect(csv).toContain('测试负责人');
    expect(csv).not.toContain('测试学生 200');
    expect(errors).toEqual([]);
  });

  test('导入问题按类型分组，公式缓存默认折叠且可导出完整清单', async ({ page }, testInfo) => {
    await loginAsNewUser(page, username('renewissues'));
    const issues = [
      ...Array.from({ length: 158 }, (_, index) => ({
        sheet_name: '老师学生', row_number: index + 2, column_number: 8,
        error_type: 'formula_cache_missing', severity: 'warning',
        error_message: '公式缺少缓存 ' + (index + 1), field_name: 'student_grid', details_json: null,
      })),
      { sheet_name: '学段汇总', row_number: 5, column_number: 4, error_type: 'summary_detail_mismatch', severity: 'warning', error_message: '学生基数汇总与网格不一致', field_name: 'base_count', details_json: JSON.stringify({ summaryCount: 10, detailCount: 9 }) },
      { sheet_name: '学段汇总', row_number: 8, column_number: 4, error_type: 'summary_detail_mismatch', severity: 'warning', error_message: '预存人数汇总与网格不一致', field_name: 'prepaid_count', details_json: JSON.stringify({ summaryCount: 8, detailCount: 7 }) },
      { sheet_name: '老师学生', row_number: 2, column_number: 30, error_type: 'grid_truncated', severity: 'warning', error_message: '学生网格超出模板范围', field_name: 'student_grid', details_json: null },
    ];
    await page.route('**/api/renewal/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/renewal/reports') {
        await route.fulfill({ json: { reports: [{ reportId: 1, fileName: 'fixture.xlsx', statMonth: '2026-11', centerName: '测试中心', rowCount: 1258, errorCount: 161, status: 'committed_with_warnings', uploadedAt: '2026-11-23 09:00:00' }] } });
      } else if (path === '/api/renewal/reports/1/errors') {
        await route.fulfill({ json: { reportId: 1, errors: issues } });
      } else {
        await route.fulfill({ status: 404, json: { error: 'unexpected browser mock: ' + path } });
      }
    });
    await page.goto('/renewal/upload');
    await page.getByTitle('查看导入问题与警告', { exact: true }).click();

    await expect(page.getByRole('heading', { name: '导入问题与警告 · 批次 #1', exact: true })).toBeVisible();
    await expect(page.getByText('汇总与明细不一致', { exact: true })).toBeVisible();
    await expect(page.locator('summary').filter({ hasText: '学生网格超出模板范围' })).toBeVisible();
    await expect(page.getByText('公式缓存缺失', { exact: true })).toBeVisible();
    await expect(page.getByText('汇总值：10 · 明细值：9', { exact: true })).toBeVisible();
    await expect(page.getByText('公式缺少缓存 1', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('renewal-import-issues.png'), fullPage: true, animations: 'disabled' });

    await page.locator('summary').filter({ hasText: '公式缓存缺失' }).click();
    await expect(page.getByText('公式缺少缓存 1', { exact: true })).toBeVisible();
    await expect(page.getByText('公式缺少缓存 21', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '展开全部 158 个位置', exact: true }).click();
    await expect(page.getByText('公式缺少缓存 158', { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载已记录问题清单', exact: true }).click();
    const download = await downloadPromise;
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('公式缺少缓存 158');
    expect(csv).toContain('学生基数汇总与网格不一致');
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
