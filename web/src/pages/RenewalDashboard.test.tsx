import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RenewalDashboard from './RenewalDashboard';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    upload: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const getMock = api.get as Mock;

/** 教师统计行：tab 特有拆分列塞 extra */
function makeTeacher(overrides: Record<string, unknown> = {}) {
  return {
    tab: 'incentive',
    teacherName: '张明',
    teacherNo: 'T001',
    subjectGroup: '理科',
    baseCount: 20,
    prepaidCount: 8,
    prepaidRate: 40,
    renewedCount: 14,
    renewRate: 70,
    incentiveGap: 3,
    extra: { juniorBase: 12, junior3Base: 4, junior3Prepaid: 2, under80: 11, over80: 9, renew80: 5 },
    studentCount: 3,
    students: [
      { name: '李小四', status: 'renewed', slot: 1 },
      { name: '王小明', status: 'closed', slot: 2 },
      { name: '赵小华', status: 'prepaid', slot: 3 },
    ],
    ...overrides,
  };
}

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    subjectGroup: '理科',
    teacherCount: 2,
    baseCount: 30,
    prepaidCount: 12,
    renewedCount: 19,
    prepaidRate: 40,
    renewRate: 63.3,
    incentiveGap: 4,
    ...overrides,
  };
}

function makeManager(overrides: Record<string, unknown> = {}) {
  return {
    managerName: '郑淼林',
    renew: { one2one: 40, one2many: 10, small: 2, other: 0, total: 52 },
    newsign: { one2one: 18, one2many: 4, small: 0, other: 0, total: 22 },
    renewedCount: 26,
    tutoredCount: 34,
    renewRate: 76.5,
    taskAmount: 1210000,
    cashflowTotal: 1330000,
    completionRate: 110,
    actualStudents: 31,
    perStudent: 42903,
    avgOrder: 8900,
    gap80: 0,
    ...overrides,
  };
}

function mockApi(options: {
  teacher?: unknown[];
  group?: unknown[];
  manager?: unknown[];
  funnel?: unknown[];
  risk?: unknown[];
} = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === '/renewal/reports') {
      return Promise.resolve({
        reports: [
          {
            reportId: 1,
            fileName: '小榄龙山学习中心 2026年秋寒个性化学生续费统计.xlsx',
            fileSize: 2403891,
            statMonth: '2026-10',
            centerName: '小榄龙山学习中心',
            rowCount: 547,
            errorCount: 0,
            status: 'ok',
            uploadedAt: '2026-11-18 20:00:00',
          },
        ],
      });
    }
    if (path.includes('/teacher-stats')) return Promise.resolve({ tab: 'incentive', reportId: 1, rows: options.teacher || [] });
    if (path.includes('/group-compare')) return Promise.resolve({ tab: 'incentive', reportId: 1, rows: options.group || [] });
    if (path.includes('/manager-perf')) return Promise.resolve({ reportId: 1, rows: options.manager || [] });
    if (path.includes('/funnel')) return Promise.resolve({ reportId: 1, rows: options.funnel || [] });
    if (path.includes('/risk-list')) return Promise.resolve({ reportId: 1, rows: options.risk || [] });
    if (path.includes('/student-status')) {
      return Promise.resolve({
        reportId: 1,
        rows: [
          { status: 'renewed', count: 19 },
          { status: 'prepaid', count: 12 },
          { status: 'stopped', count: 5 },
          { status: 'closed', count: 3 },
        ],
      });
    }
    return Promise.reject(new Error('unexpected path: ' + path));
  });
}

beforeEach(() => {
  getMock.mockReset();
});

describe('续费看板', () => {
  it('还没有报表时提示上传', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/renewal/reports') return Promise.resolve({ reports: [] });
      return Promise.reject(new Error('unexpected path: ' + path));
    });
    renderWithProviders(<RenewalDashboard />);

    expect(await screen.findByText('还没有可展示的报表')).toBeInTheDocument();
    expect(screen.getByText('上传你做好的续费统计汇总表，看板会自动出图。')).toBeInTheDocument();
  });

  it('汇总卡与图例随最新报表出数', async () => {
    mockApi({ teacher: [makeTeacher(), makeTeacher({ teacherName: '李华', teacherNo: 'T002', baseCount: 10, renewedCount: 5, prepaidCount: 4, incentiveGap: 1 })] });
    renderWithProviders(<RenewalDashboard />);

    // 30 = 20 + 10 学生基数；19 = 14 + 5 已续科
    expect(await screen.findByText('30')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // 图例颜色说明来自 Excel 条件格式
    // 图例文案与 KPI 卡片同名（如「已预存」），故用 getAllByText
    expect(screen.getAllByText('已续费').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('已预存').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('结课').length).toBeGreaterThanOrEqual(1);
  });

  it('教师统计默认展开激励 tab，切换 tab 会重新取数', async () => {
    mockApi({ teacher: [makeTeacher()], group: [makeGroup()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    const table = await screen.findByRole('table');

    expect(within(table).getByText('张明')).toBeInTheDocument();
    expect(within(table).getByText('理科')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '课时' }));

    await waitFor(() => {
      const call = getMock.mock.calls.find(([p]) => String(p).includes('tab=hours'));
      expect(call).toBeDefined();
    });
  });

  it('点教师名展开学生色块明细', async () => {
    mockApi({ teacher: [makeTeacher()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    const table = await screen.findByRole('table');

    await user.click(within(table).getByRole('button', { name: '张明' }));

    expect(await screen.findByText('张明 的学生色块明细')).toBeInTheDocument();
    expect(screen.getByText('3 人')).toBeInTheDocument();
    expect(screen.getAllByText('李小四').length).toBeGreaterThanOrEqual(1);
  });

  it('科组对比视图展示续科人数与激励差额两组排名', async () => {
    // 两科组差额都归 0，验证「全部达标」分支
    mockApi({ teacher: [makeTeacher()], group: [makeGroup({ incentiveGap: 0 }), makeGroup({ subjectGroup: '文科', renewedCount: 12, incentiveGap: 0 })] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '科组对比' }));

    expect(await screen.findByText('续科人数排名（激励表）')).toBeInTheDocument();
    expect(screen.getByText('所有科组都已达标，没有缺口')).toBeInTheDocument();
  });

  it('学管业绩视图展示完成率进度条', async () => {
    mockApi({ teacher: [makeTeacher()], manager: [makeManager()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '学管业绩' }));

    expect(await screen.findByText('郑淼林')).toBeInTheDocument();
    expect(screen.getByText('110.0%')).toBeInTheDocument();
  });

  it('续生漏斗视图展示逐层收窄', async () => {
    mockApi({
      teacher: [makeTeacher()],
      funnel: [
        { managerName: '郑淼林', students: 34, classedLast1: 22, classedLast2: 30, renewed: 26, renewRate: 76.5 },
        { managerName: '林家琪', students: 26, classedLast1: 15, classedLast2: 21, renewed: 18, renewRate: 69.2 },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '续生漏斗' }));

    expect(await screen.findByText('学生总数')).toBeInTheDocument();
    expect(screen.getByText('本月已续费')).toBeInTheDocument();
    // 分学管漏斗明细
    expect(screen.getByText('林家琪')).toBeInTheDocument();
  });

  it('风险清单视图按信号区分上月消失与持续沉默', async () => {
    mockApi({
      teacher: [makeTeacher()],
      risk: [
        { managerName: '郑淼林', studentId: 'S1', studentName: '陈志强', grade: '初三', enrollDays: 420, coef: 1, type: '前2月有课消', courseProduct: '数学', classLast1: 0, classLast2: 1 },
        { managerName: '林家琪', studentId: 'S2', studentName: '刘小雨', grade: '初二', enrollDays: 96, coef: 1, type: '前2月无课消', courseProduct: '物理', classLast1: 0, classLast2: 0 },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '风险清单' }));

    expect(await screen.findByText('陈志强')).toBeInTheDocument();
    expect(screen.getByText('刘小雨')).toBeInTheDocument();
    expect(screen.getByText('上月消失')).toBeInTheDocument();
    expect(screen.getByText('持续沉默')).toBeInTheDocument();
  });
});
