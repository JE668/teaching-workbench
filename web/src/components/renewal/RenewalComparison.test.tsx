import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RenewalComparison from './RenewalComparison';
import { renderWithProviders } from '../../test/test-utils';
import { api } from '../../api/client';
import type { ReportSummary } from '../../lib/renewal';

vi.mock('../../api/client', () => ({ api: { get: vi.fn() } }));
const getMock = api.get as Mock;

function report(reportId: number, centerName = '中心A', status = 'committed'): ReportSummary {
  return { reportId, centerName, status, fileName: `批次${reportId}.xlsx`, fileSize: 1, statMonth: `2026-${String(reportId).padStart(2, '0')}`, rowCount: 1, errorCount: 0, uploadedAt: '2026-11-01 10:00:00' };
}

const response = {
  tab: 'stage',
  currentReport: { reportId: 2, statMonth: '2026-02', uploadedAt: '2026-02-02' },
  previousReport: { reportId: 1, statMonth: '2026-01', uploadedAt: '2026-01-02' },
  summary: {
    baseCount: { current: 306, previous: 300, delta: 6 },
    prepaidCount: { current: 226, previous: 220, delta: 6 },
    prepaidRate: { current: 73.9, previous: 73.3, delta: 0.6 },
    renewedCount: { current: null, previous: 3, delta: null },
  },
  teachers: [{ teacherKey: 'row:5', teacherName: '张老师', teacherNo: 'T01', subjectGroup: '理科', current: {}, previous: {}, delta: { baseCount: 2, prepaidCount: null, renewedCount: null } }],
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('续费多期对比', () => {
  beforeEach(() => getMock.mockReset());

  it('只列同中心有效批次，展示真实差值和缺失语义', async () => {
    getMock.mockResolvedValue(response);
    const user = userEvent.setup();
    renderWithProviders(<RenewalComparison reports={[report(2), report(1), report(3, '中心B'), report(4, '中心A', 'failed')]} currentReportId={2} tab="stage" />);

    const select = screen.getByLabelText('选择对比批次');
    expect(select).toHaveTextContent('批次1.xlsx');
    expect(select).not.toHaveTextContent('批次3.xlsx');
    expect(select).not.toHaveTextContent('批次4.xlsx');
    await user.selectOptions(select, '1');

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/renewal/compare?reportId=2&compareReportId=1&tab=stage'));
    expect(await screen.findByText('306')).toBeInTheDocument();
    expect(screen.getAllByText('+6')).toHaveLength(2);
    expect(screen.getByText('+0.6 个百分点')).toBeInTheDocument();
    expect(screen.getByText('张老师')).toBeInTheDocument();
    expect(screen.queryByText(/^0 个百分点$/)).not.toBeInTheDocument();
  });

  it('接口失败显示错误而不是空数据', async () => {
    getMock.mockResolvedValue({ error: '对比批次不可用' });
    renderWithProviders(<RenewalComparison reports={[report(2), report(1)]} currentReportId={2} tab="stage" />);
    fireEvent.change(screen.getByLabelText('选择对比批次'), { target: { value: '1' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('对比批次不可用');
  });

  it.each([
    { name: '切换当前批次', currentReportId: 3, tab: 'stage' },
    { name: '切换统计 tab', currentReportId: 2, tab: 'subject' },
  ])('$name 时清除加载并忽略迟到响应，之后可重新选择批次', async ({ currentReportId: nextReportId, tab: nextTab }) => {
    const firstRequest = createDeferred<typeof response>();
    const freshResponse = {
      ...response,
      tab: nextTab,
      currentReport: { ...response.currentReport, reportId: nextReportId },
      summary: { ...response.summary, baseCount: { current: 999, previous: 300, delta: 699 } },
      teachers: [{ ...response.teachers[0], teacherName: '新老师' }],
    };
    getMock.mockReturnValueOnce(firstRequest.promise).mockResolvedValue(freshResponse);
    const reports = [report(2), report(1), report(3)];
    const { rerender } = render(<RenewalComparison reports={reports} currentReportId={2} tab="stage" />);

    fireEvent.change(screen.getByLabelText('选择对比批次'), { target: { value: '1' } });
    expect(screen.getByText('正在计算同口径变化…')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);

    rerender(<RenewalComparison reports={reports} currentReportId={nextReportId} tab={nextTab} />);
    expect(screen.getByLabelText('选择对比批次')).toHaveValue('');
    expect(screen.queryByText('正在计算同口径变化…')).not.toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRequest.resolve(response);
      await firstRequest.promise;
    });
    expect(screen.queryByText('正在计算同口径变化…')).not.toBeInTheDocument();
    expect(screen.queryByText('张老师')).not.toBeInTheDocument();
    expect(screen.queryByText('306')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('选择对比批次'), { target: { value: '1' } });
    expect(await screen.findByText('新老师')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.queryByText('正在计算同口径变化…')).not.toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenLastCalledWith(`/renewal/compare?reportId=${nextReportId}&compareReportId=1&tab=${nextTab}`);
  });

  it('旧请求的 finally 不会结束新请求的加载状态', async () => {
    const firstRequest = createDeferred<typeof response>();
    const secondRequest = createDeferred<typeof response>();
    const freshResponse = {
      ...response,
      previousReport: { ...response.previousReport, reportId: 3 },
      summary: { ...response.summary, baseCount: { current: 999, previous: 300, delta: 699 } },
      teachers: [{ ...response.teachers[0], teacherName: '新老师' }],
    };
    getMock.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
    render(<RenewalComparison reports={[report(2), report(1), report(3)]} currentReportId={2} tab="stage" />);

    fireEvent.change(screen.getByLabelText('选择对比批次'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('选择对比批次'), { target: { value: '3' } });
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('正在计算同口径变化…')).toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve(response);
      await firstRequest.promise;
    });
    expect(screen.getByText('正在计算同口径变化…')).toBeInTheDocument();
    expect(screen.queryByText('张老师')).not.toBeInTheDocument();

    await act(async () => {
      secondRequest.resolve(freshResponse);
      await secondRequest.promise;
    });
    expect(screen.queryByText('正在计算同口径变化…')).not.toBeInTheDocument();
    expect(screen.getByText('新老师')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.queryByText('张老师')).not.toBeInTheDocument();
  });
});
