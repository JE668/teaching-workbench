import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BiReconciliation from './BiReconciliation';
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

const ROWS = [
  { student_id: 'S001', student_name: '小明', voucher_prepaid: true, map_prepaid: 1,
    map_overridden: false, teacher_no: 'T001', status: 'MATCH' },
  { student_id: 'S002', student_name: '小红', voucher_prepaid: true, map_prepaid: null,
    map_overridden: false, teacher_no: null, status: 'ONLY_VOUCHER' },
  { student_id: 'S003', student_name: '小刚', voucher_prepaid: false, map_prepaid: 1,
    map_overridden: false, teacher_no: 'T002', status: 'ONLY_MAP' },
  { student_id: 'S004', student_name: '小华', voucher_prepaid: false, map_prepaid: 1,
    map_overridden: true, teacher_no: 'T003', status: 'OVERRIDE_KEEP' },
];
const SUMMARY = { match: 1, onlyVoucher: 1, onlyMap: 1, overrideKeep: 1, total: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ rows: ROWS, summary: SUMMARY });
});

describe('BiReconciliation', () => {
  it('展示汇总卡片', async () => {
    renderWithProviders(<BiReconciliation />);
    expect(await screen.findByText('总数')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getAllByText('一致').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('仅定金券').length).toBeGreaterThan(0);
  });

  it('展示所有对账行', async () => {
    renderWithProviders(<BiReconciliation />);
    expect(await screen.findByText('S001')).toBeInTheDocument();
    expect(screen.getByText('S002')).toBeInTheDocument();
    expect(screen.getByText('S003')).toBeInTheDocument();
    expect(screen.getByText('S004')).toBeInTheDocument();
  });

  it('状态列显示正确文案', async () => {
    renderWithProviders(<BiReconciliation />);
    await screen.findByText('S001');
    expect(screen.getAllByText('一致').length).toBeGreaterThan(0);
    expect(screen.getAllByText('仅定金券（建议补映射）').length).toBeGreaterThan(0);
    expect(screen.getAllByText('仅映射表（可能老数据）').length).toBeGreaterThan(0);
    expect(screen.getAllByText('人工已确认').length).toBeGreaterThan(0);
  });

  it('按状态筛选：点击"仅定金券"只显示对应行', async () => {
    renderWithProviders(<BiReconciliation />);
    await screen.findByText('S001');
    await userEvent.click(screen.getByRole('button', { name: '仅定金券（建议补映射）' }));
    expect(screen.getByText('S002')).toBeInTheDocument();
    expect(screen.queryByText('S001')).not.toBeInTheDocument();
  });

  it('空数据：显示提示文字', async () => {
    get.mockResolvedValue({ rows: [], summary: { match: 0, onlyVoucher: 0, onlyMap: 0, overrideKeep: 0, total: 0 } });
    renderWithProviders(<BiReconciliation />);
    expect(await screen.findByText('暂无数据（请先上传定金券报表和老师-学生映射）')).toBeInTheDocument();
  });

  it('刷新按钮重新调用接口', async () => {
    renderWithProviders(<BiReconciliation />);
    await screen.findByText('S001');
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(get).toHaveBeenCalledTimes(2); // 初始 + 刷新
  });
});
