import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BiDashboard from './BiDashboard';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;

const XUKE_ROWS = [
  { teacher_no: 'T001', teacher_name: '张老师', subject_group: '数学', base_count: 10, renewed_count: 8, rate: 80 },
];
const XUSHENG_ROWS = [
  { mentor_name: '李学管', base_count: 12, renewed_count: 10, rate: 83.33 },
];
const PRESALE_ROWS = [
  { branch_company: '小榄分公司', learning_center: '龙山', valid_voucher_count: 5, presale_student_count: 7, total_amount: 35000 },
];
const PERF_ROWS = [
  { performer: '郑淼林', performer_no: 'X49763', learning_center: '龙山', perf_total: 1000, grand_total: 1000, contract_count: 2 },
];
const INCENTIVE_ROWS = [
  { scope: 'mentor', scope_value: '李学管', target_rate: 80, base_count: 12, target_count: 10, renewed_count: 9, gap: 1 },
];
const REPORT = {
  month: '2026-11',
  xuke: { total_base: 100, total_renewed: 80, overall_rate: 80, teacher_count: 5 },
  xusheng: { total_base: 200, total_renewed: 160, overall_rate: 80, mentor_count: 3 },
  presale: { total_vouchers: 10, total_students: 14, total_amount: 70000, learning_center_count: 2 },
  incentive: { entries: 1, total_gap: 1 },
};

function mockGet() {
  get.mockImplementation((path: string) => {
    if (path.includes('/metrics/months')) {
      return Promise.resolve({ months: ['2026-11', '2026-10'] });
    }
    if (path.includes('/metrics/xuke-rates')) {
      return Promise.resolve({ rows: XUKE_ROWS });
    }
    if (path.includes('/metrics/xusheng-rates')) {
      return Promise.resolve({ rows: XUSHENG_ROWS });
    }
    if (path.includes('/metrics/presale')) {
      return Promise.resolve({ rows: PRESALE_ROWS });
    }
    if (path.includes('/metrics/incentive')) {
      return Promise.resolve({ rows: INCENTIVE_ROWS });
    }
    if (path.includes('/metrics/personal-perf')) {
      return Promise.resolve({ rows: PERF_ROWS });
    }
    if (path.includes('/metrics/report')) {
      return Promise.resolve({ report: REPORT });
    }
    return Promise.reject(new Error('unmocked: ' + path));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet();
});

async function switchTab(label: string) {
  await userEvent.click(screen.getByRole('button', { name: label }));
}

describe('BiDashboard', () => {
  it('默认续科率 tab：加载并渲染老师续科率行', async () => {
    renderWithProviders(<BiDashboard />);
    expect(await screen.findByText('张老师')).toBeInTheDocument();
    expect(screen.getByText('80.00%')).toBeInTheDocument();
    expect(screen.getByText('T001')).toBeInTheDocument();
  });

  it('月份下拉加载成功并展示选项', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    const monthSelect = screen.getByLabelText('月份') as HTMLSelectElement;
    await waitFor(() => {
      expect(monthSelect.options.length).toBe(3); // 最新批次 + 2 月份
    });
  });

  it('切换到总览 tab 展示四张概览卡片', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    await switchTab('总览');
    expect(await screen.findByText('续科率')).toBeInTheDocument();
    expect(screen.getByText('续生率')).toBeInTheDocument();
    expect(screen.getByText('预存学生数')).toBeInTheDocument();
    expect(screen.getByText('激励差额（总）')).toBeInTheDocument();
    expect(screen.getByText('80 / 100 科次 · 5 老师')).toBeInTheDocument();
  });

  it('切换到续生率 tab 展示学管行', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    await switchTab('续生率（学管）');
    expect(await screen.findByText('李学管')).toBeInTheDocument();
    expect(screen.getByText('83.33%')).toBeInTheDocument();
  });

  it('切换到预存 tab 展示分公司/校区行', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    await switchTab('预存（校区）');
    expect(await screen.findByText('小榄分公司')).toBeInTheDocument();
    expect(screen.getByText('龙山')).toBeInTheDocument();
    expect(screen.getByText('¥35,000.00')).toBeInTheDocument();
  });

  it('切换到激励 tab 展示差额行 + 正差额高亮红色', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    await switchTab('激励差额');
    expect(await screen.findByText('李学管')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    const gapCell = screen.getByText('+1');
    expect(gapCell.className).toContain('text-red-600');
  });

  it('切换到个人业绩 tab 展示业绩人员行', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    // Reset mock calls to isolate this test
    get.mockClear();
    await switchTab('个人业绩');
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/bi/metrics/personal-perf');
    });
    await waitFor(() => {
      expect(screen.getByText('郑淼林')).toBeInTheDocument();
    });
    expect(screen.getByText('X49763')).toBeInTheDocument();
    expect(screen.getByText('龙山')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // 合同数
  });

  it('续科率表格按科组分组：切换 groupBy 后调用接口带 groupBy 参数', async () => {
    renderWithProviders(<BiDashboard />);
    await screen.findByText('张老师');
    const groupSelect = screen.getByLabelText('分组') as HTMLSelectElement;
    await userEvent.selectOptions(groupSelect, 'subject_group');
    await waitFor(() => {
      const calls = get.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('/metrics/xuke-rates'));
      const lastCall = calls[calls.length - 1][0] as string;
      expect(lastCall).toContain('groupBy=subject_group');
    });
  });

  it('空数据：续科率表格显示"暂无数据"提示', async () => {
    get.mockImplementation((path: string) => {
      if (path.includes('/metrics/months')) return Promise.resolve({ months: [] });
      if (path.includes('/metrics/xuke-rates')) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error('unmocked'));
    });
    renderWithProviders(<BiDashboard />);
    expect(await screen.findByText('暂无数据，请先上传续科率明细')).toBeInTheDocument();
  });
});
