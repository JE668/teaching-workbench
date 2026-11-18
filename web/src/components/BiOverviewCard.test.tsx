import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen } from '@testing-library/react';
import BiOverviewCard from './BiOverviewCard';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;

const REPORT = {
  month: '2026-11',
  xuke: { total_base: 100, total_renewed: 80, overall_rate: 0.8, teacher_count: 12 },
  xusheng: { total_base: 50, total_renewed: 40, overall_rate: 0.8, mentor_count: 6 },
  presale: { total_vouchers: 20, total_students: 25, total_amount: 50000, learning_center_count: 2 },
  incentive: { entries: 4, total_gap: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BiOverviewCard', () => {
  it('有数据时渲染四项指标', async () => {
    get.mockResolvedValue({ report: REPORT });
    renderWithProviders(<BiOverviewCard />);
    expect(await screen.findByText(/本月 BI 概览/)).toBeInTheDocument();
    expect(screen.getAllByText('80.0%').length).toBe(2); // 续科率 + 续生率
    expect(screen.getByText('80/100')).toBeInTheDocument();
    expect(screen.getByText('40/50')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument(); // 预存学生数
    expect(screen.getByText('3')).toBeInTheDocument(); // 激励差额
  });

  it('接口失败时静默降级（不渲染）', async () => {
    get.mockRejectedValue(new Error('network'));
    renderWithProviders(<BiOverviewCard />);
    // 等微任务跑完，确认没渲染
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/本月 BI 概览/)).not.toBeInTheDocument();
  });

  it('显示「查看完整看板」链接', async () => {
    get.mockResolvedValue({ report: REPORT });
    renderWithProviders(<BiOverviewCard />);
    expect(await screen.findByText('查看完整看板')).toBeInTheDocument();
  });
});
