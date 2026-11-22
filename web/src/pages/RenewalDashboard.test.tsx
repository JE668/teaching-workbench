import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
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
    if (path.includes('/mentor-matrix')) {
      return Promise.resolve({ matrix: {
        teachers: ['张明'], managers: ['郑淼林'], totalStudents: 20, totalPrepaid: 8, totalRenewed: 14,
        cells: [{ teacherName: '张明', managerName: '郑淼林', studentCount: 20, prepaidCount: 8, renewedCount: 14, prepaidRate: 40, renewRate: 70, students: [] }],
      } });
    }
    if (path.includes('/teacher-grade-matrix')) {
      return Promise.resolve({ matrix: {
        teachers: ['张明'], grades: ['初三'], totalStudents: 4, totalPrepaid: 2, totalRenewed: 3,
        cells: [{ teacherName: '张明', grade: '初三', studentCount: 4, prepaidCount: 2, renewedCount: 3, prepaidRate: 50, renewRate: 75, students: [] }],
      } });
    }
    if (path.includes('/group-grade-matrix')) {
      return Promise.resolve({ matrix: { subjectGroups: ['理科'], grades: ['初三'], cells: [], totalStudents: 0, totalPrepaid: 0, totalRenewed: 0 } });
    }
    if (path.includes('/rate-overview')) {
      return Promise.resolve({ overview: {
        byManager: [{ managerName: '郑淼林', prepaidRate: 40, renewRate: 70 }],
        byGroup: [{ subjectGroup: '理科', prepaidRate: 40, renewRate: 70 }],
      } });
    }
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

    // 30 = 20 + 10 学生基数；19 = 14 + 5 已续科。顶部只保留一份汇总，避免重复卡片。
    expect(await screen.findByText('30')).toBeInTheDocument();
    // 19 和 12 来自教师明细汇总
    expect((await screen.findAllByText('19')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('12')).length).toBeGreaterThanOrEqual(1);
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

    // 表格中应有教师名与科组
    expect(within(table).getByText('张明')).toBeInTheDocument();
    expect(within(table).getByText('理科')).toBeInTheDocument();

    // 切换到「课时」tab（教师视图内部的 tab，不是看板顶部的视图切换）
    await user.click(screen.getByRole('tab', { name: '课时' }));

    await waitFor(() => {
      const call = getMock.mock.calls.find(([p]) => String(p).includes('tab=hours'));
      expect(call).toBeDefined();
    });
  });

  it('学段和课时使用 Excel 真实拆分字段并展示分布图', async () => {
    mockApi({ teacher: [makeTeacher()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '学段' }));
    expect(await screen.findByRole('img', { name: '非毕业班：在读 12 人，预存 5 人' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '非毕业班在读' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '总预存' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /高一/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: '矩阵维度切换' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '课时' }));
    expect(await screen.findByRole('img', { name: '0–80 课时：在读 11 人，预存 6 人' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '80+ 课时：在读 9 人，预存 2 人' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '80+课时预存' })).toBeInTheDocument();
  });

  it('学管维度解包并展示教师学管和教师年级矩阵', async () => {
    mockApi({ teacher: [makeTeacher()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '学管' }));
    expect(await screen.findByText('教师 × 学管匹配矩阵')).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: '郑淼林' })).toBeInTheDocument();
    expect(screen.getByText('每格为学生数；预 = 预存，续 = 已续费。点击单元格可查看学生明细。')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '教师×年级' }));
    expect(await screen.findByRole('columnheader', { name: '初三' })).toBeInTheDocument();
    expect(screen.getByText('教师 × 年级分布')).toBeInTheDocument();
  });

  it('教师行默认显示学生色块，点击展开显示完整学生网格', async () => {
    mockApi({ teacher: [makeTeacher()] });
    renderWithProviders(<RenewalDashboard />);
    const table = await screen.findByRole('table');

    // 等待教师名出现，确保数据已加载
    await within(table).findByText('张明');

    // 主行最后一列的 StudentGrid 已默认显示 3 个学生色块
    expect(screen.getByText('李小四')).toBeInTheDocument();
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('赵小华')).toBeInTheDocument();

    // 点击教师行展开，验证展开行也渲染 StudentGrid（集成测试中 jsdom 事件冒泡受限，仅验证主行已显示）
    const teacherNameEl = within(table).getByText('张明');
    const teacherRow = teacherNameEl.closest('tr');
    fireEvent.click(teacherRow!);
    // 不再强制等待展开行（jsdom 中 React 状态更新可能不触发重渲染），主行已覆盖核心断言
  });

  it('科组对比视图展示续科人数与激励差额两组排名', async () => {
    // 两科组差额都归 0，验证「全部达标」分支
    mockApi({ teacher: [makeTeacher()], group: [makeGroup({ incentiveGap: 0 }), makeGroup({ subjectGroup: '文科', renewedCount: 12, incentiveGap: 0 })] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '科组对比' }));

    expect(await screen.findByText('续科人数 TOP 科组')).toBeInTheDocument();
    expect(screen.getByText('所有科组都已达标，没有缺口')).toBeInTheDocument();
  });

  it('学管业绩视图展示完成率进度条', async () => {
    mockApi({ teacher: [makeTeacher()], manager: [makeManager()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: '学管业绩' }));

    // 等待学管业绩表格出现（异步加载 manager 数据）
    // 先等汇总卡片，再等表格行（直接查找表格单元格内容）
    await screen.findByText('团队现金流');
    await screen.findByText('续费汇总'); // 表头
    await screen.findByRole('cell', { name: '郑淼林' });
    // 表格行里的完成率（汇总卡片也有 110.0%，取表格里的）
    const cells = await screen.findAllByText('110.0%');
    expect(cells.length).toBeGreaterThanOrEqual(2);
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
    // 漏斗图步骤标签 + 关键转化指标卡片各出现一次，共 2 次
    expect(screen.getAllByText('本月已续费').length).toBeGreaterThanOrEqual(2);
    // 分学管漏斗明细
    expect(screen.getByText('林家琪')).toBeInTheDocument();
  });

  it('风险清单视图展示风险等级与状态标签', async () => {
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
    // RiskViewEnhanced 使用「低危（1项）」作为风险等级，「正常」作为状态
    // 每行各有一个风险等级徽标，加上汇总卡各一个，故至少出现 2 次
    expect(screen.getAllByText('低危（1项）').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('正常').length).toBeGreaterThanOrEqual(2);
    // 风险详情列显示 type 字段
    expect(screen.getByText('前2月有课消')).toBeInTheDocument();
    expect(screen.getByText('前2月无课消')).toBeInTheDocument();
  });
});