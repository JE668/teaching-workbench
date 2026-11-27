import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import ManagerViewEnhanced from './ManagerViewEnhanced';
import { api } from '../../api/client';
import { ToastProvider } from '../ui/Toast';
import type { ManagerPerfRow } from '../../lib/renewal';

vi.mock('../../api/client', () => ({ api: { put: vi.fn() } }));
const putMock = api.put as Mock;

type ViewProps = {
  rows: ManagerPerfRow[];
  reportId: number;
  onSaved: (rows: ManagerPerfRow[]) => void;
};

function viewUi(props: ViewProps) {
  return <ToastProvider><ManagerViewEnhanced {...props} /></ToastProvider>;
}

function renderView(props: ViewProps) {
  return render(viewUi(props));
}

function makeRow(overrides: Partial<ManagerPerfRow> = {}): ManagerPerfRow {
  return {
    managerName: '学管甲',
    renew: { one2one: 30000, one2many: null, small: 10000, other: null, total: 40000 },
    newsign: { one2one: 20000, one2many: null, small: 5000, other: null, total: 25000 },
    renewedCount: 4,
    tutoredCount: 10,
    renewRate: 50,
    taskAmount: 120000,
    importedTaskAmount: 100000,
    productTargets: { one2one: 40000, one2many: null, small: 10000, other: null },
    productCashflow: { one2one: 50000, one2many: null, small: 15000, other: null, total: 65000 },
    cashflowTotal: 65000,
    completionRate: 54.2,
    actualStudents: 5,
    perStudent: 13000,
    avgOrder: 16250,
    gap80: null,
    ...overrides,
  };
}

describe('学管业绩与现金流任务', () => {
  beforeEach(() => putMock.mockReset());

  it('打开逐学管编辑器并保留有效任务、产品目标和空值', async () => {
    const user = userEvent.setup();
    renderView({ rows: [makeRow()], reportId: 7, onSaved: vi.fn() });
    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));

    expect(screen.getByRole('dialog', { name: '设置现金流任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('学管甲 总任务')).toHaveValue('120000');
    expect(screen.getByLabelText('学管甲 一对一目标')).toHaveValue('40000');
    expect(screen.getByLabelText('学管甲 一对多目标')).toHaveValue('');
    expect(screen.getByLabelText('学管甲 小班目标')).toHaveValue('10000');
    expect(screen.getByLabelText('学管甲 其他目标')).toHaveValue('');
  });

  it('按单项 targets 保存有效数字并回调响应行后关闭', async () => {
    const savedRows = [makeRow({ taskAmount: 130000 })];
    putMock.mockResolvedValue({ reportId: 7, rows: savedRows });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderView({ rows: [makeRow()], reportId: 7, onSaved });
    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));

    const total = screen.getByLabelText('学管甲 总任务');
    await user.clear(total);
    await user.type(total, '130000');
    await user.type(screen.getByLabelText('学管甲 一对多目标'), '20000');
    await user.clear(screen.getByLabelText('学管甲 小班目标'));
    await user.type(screen.getByLabelText('学管甲 其他目标'), '0');
    await user.click(screen.getByRole('button', { name: '保存 学管甲任务' }));

    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/renewal/analytics/manager-targets', {
      reportId: 7,
      targets: [{
        managerName: '学管甲',
        targetAmount: 130000,
        productTargets: { one2one: 40000, one2many: 20000, small: null, other: 0 },
      }],
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedRows));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('恢复单个学管 Excel 任务时清除总任务和全部产品覆盖', async () => {
    const savedRows = [makeRow({ taskAmount: 100000 })];
    putMock.mockResolvedValue({ reportId: 7, rows: savedRows });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderView({ rows: [makeRow()], reportId: 7, onSaved });
    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));
    await user.click(screen.getByRole('button', { name: '恢复 学管甲 Excel 任务' }));

    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/renewal/analytics/manager-targets', {
      reportId: 7,
      targets: [{ managerName: '学管甲', targetAmount: null, productTargets: null }],
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedRows));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('拦截负数和非有限数，不发请求', async () => {
    const user = userEvent.setup();
    renderView({ rows: [makeRow()], reportId: 7, onSaved: vi.fn() });
    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));
    const total = screen.getByLabelText('学管甲 总任务');

    await user.clear(total);
    await user.type(total, '-1');
    await user.click(screen.getByRole('button', { name: '保存 学管甲任务' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('学管甲总任务须为非负有限数');

    await user.clear(total);
    await user.type(total, 'Infinity');
    await user.click(screen.getByRole('button', { name: '保存 学管甲任务' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('学管甲总任务须为非负有限数');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('分产品展示续费、新签、实际现金流、目标与完成率', () => {
    renderView({ rows: [makeRow()], reportId: 7, onSaved: vi.fn() });
    const row = screen.getByRole('row', { name: '学管甲 一对一现金流' });
    expect(within(row).getByText('3.0 万')).toBeInTheDocument();
    expect(within(row).getByText('2.0 万')).toBeInTheDocument();
    expect(within(row).getByText('5.0 万')).toBeInTheDocument();
    expect(within(row).getByText('4.0 万')).toBeInTheDocument();
    expect(within(row).getByText('125.0%')).toBeInTheDocument();
    expect(screen.getByLabelText('已调整，Excel 原值 10.0 万')).toHaveTextContent('已调整');
  });

  it('产品实际、目标及其组成均为 null 时显示破折号而不是零', () => {
    renderView({ rows: [makeRow()], reportId: 7, onSaved: vi.fn() });
    const row = screen.getByRole('row', { name: '学管甲 其他现金流' });
    expect(within(row).getAllByText('—')).toHaveLength(5);
    expect(row).not.toHaveTextContent('0.0 万');
    expect(row).not.toHaveTextContent('0.0%');
  });

  it('现金流榜与完成率榜均按数值降序', () => {
    const rows = [
      makeRow({ managerName: '低现金流高完成', cashflowTotal: 10000, completionRate: 120 }),
      makeRow({ managerName: '高现金流低完成', cashflowTotal: 90000, completionRate: 50 }),
    ];
    renderView({ rows, reportId: 7, onSaved: vi.fn() });
    const cashflow = screen.getByRole('heading', { name: '现金流 TOP 10（高→低）' }).parentElement;
    const completion = screen.getByRole('heading', { name: '完成率 TOP 10（高→低）' }).parentElement;
    expect(cashflow?.textContent?.indexOf('高现金流低完成')).toBeLessThan(cashflow?.textContent?.indexOf('低现金流高完成') ?? -1);
    expect(completion?.textContent?.indexOf('低现金流高完成')).toBeLessThan(completion?.textContent?.indexOf('高现金流低完成') ?? -1);
  });

  it('切换 reportId 会重置编辑器并忽略迟到响应', async () => {
    let resolvePut!: (value: { reportId: number; rows: ManagerPerfRow[] }) => void;
    putMock.mockReturnValue(new Promise(resolve => { resolvePut = resolve; }));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const view = renderView({ rows: [makeRow()], reportId: 7, onSaved });
    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));
    await user.click(screen.getByRole('button', { name: '保存 学管甲任务' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));

    view.rerender(viewUi({ rows: [makeRow({ managerName: '新批次学管', taskAmount: 88000 })], reportId: 8, onSaved }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => {
      resolvePut({ reportId: 7, rows: [makeRow({ managerName: '旧批次响应' })] });
      await Promise.resolve();
    });
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));
    expect(screen.getByLabelText('新批次学管 总任务')).toHaveValue('88000');
  });

  it('响应 reportId 与当前请求不一致时不回调', async () => {
    putMock.mockResolvedValue({ reportId: 6, rows: [makeRow({ managerName: '错误批次' })] });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderView({ rows: [makeRow()], reportId: 7, onSaved });
    await user.click(screen.getByRole('button', { name: '设置现金流任务' }));
    await user.click(screen.getByRole('button', { name: '保存 学管甲任务' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存响应批次不一致，请重试');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
