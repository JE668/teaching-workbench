import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RenewalUpload from './RenewalUpload';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';
import type { ReportSummary } from '../lib/renewal';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const getMock = api.get as Mock;
const deleteMock = api.delete as Mock;

function makeReport(reportId: number): ReportSummary {
  return {
    reportId,
    fileName: `batch-${reportId}.xlsx`,
    fileSize: 100,
    statMonth: '2026-11',
    centerName: null,
    rowCount: 1,
    errorCount: 1,
    status: 'committed_with_warnings',
    uploadedAt: '2026-11-23 10:00:00',
  };
}

function errorResult(message: string) {
  return {
    errors: [{
      sheet_name: 'import-sheet',
      row_number: 1,
      column_number: 1,
      error_type: 'invalid_value',
      severity: 'error',
      error_message: message,
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function clickErrorBadge(user: ReturnType<typeof userEvent.setup>, reportIndex: number) {
  const history = await screen.findByRole('table');
  const rows = within(history).getAllByRole('row');
  await user.click(within(rows[reportIndex]).getByTitle('查看导入问题与警告'));
}

beforeEach(() => {
  getMock.mockReset();
  deleteMock.mockReset();
  deleteMock.mockResolvedValue({ success: true });
});

describe('RenewalUpload 错误明细请求竞态', () => {
  it('两个批次逆序完成时只展示当前批次，旧响应不会覆盖新明细', async () => {
    const first = deferred<ReturnType<typeof errorResult>>();
    const second = deferred<ReturnType<typeof errorResult>>();
    getMock.mockImplementation((path: string) => {
      if (path === '/renewal/reports') {
        return Promise.resolve({ reports: [makeReport(1), makeReport(2)] });
      }
      if (path === '/renewal/reports/1/errors') return first.promise;
      if (path === '/renewal/reports/2/errors') return second.promise;
      return Promise.reject(new Error('unexpected path: ' + path));
    });

    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    await clickErrorBadge(user, 1);
    expect(await screen.findByText('导入问题与警告 · 批次 #1')).toBeInTheDocument();

    await clickErrorBadge(user, 2);
    expect(await screen.findByText('导入问题与警告 · 批次 #2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('批次 #2');

    await act(async () => {
      second.resolve(errorResult('batch-2-current-detail'));
      await second.promise;
    });
    expect(await screen.findByText('batch-2-current-detail')).toBeInTheDocument();

    await act(async () => {
      first.resolve(errorResult('batch-1-stale-detail'));
      await first.promise;
    });
    await waitFor(() => {
      expect(screen.getByText('batch-2-current-detail')).toBeInTheDocument();
      expect(screen.queryByText('batch-1-stale-detail')).not.toBeInTheDocument();
      expect(screen.getByText('导入问题与警告 · 批次 #2')).toBeInTheDocument();
    });
  });

  it('错误明细加载失败时显示批次和原因，并可重试至成功', async () => {
    const detailMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary detail failure'))
      .mockResolvedValueOnce(errorResult('batch-3-retry-success'));
    getMock.mockImplementation((path: string) => {
      if (path === '/renewal/reports') return Promise.resolve({ reports: [makeReport(3)] });
      if (path === '/renewal/reports/3/errors') return detailMock();
      return Promise.reject(new Error('unexpected path: ' + path));
    });

    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    await clickErrorBadge(user, 1);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('批次 #3');
    expect(alert).toHaveTextContent('temporary detail failure');
    expect(screen.getByText('导入问题与警告 · 批次 #3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试加载错误明细' }));
    expect(await screen.findByText('batch-3-retry-success')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('导入问题与警告 · 批次 #3')).toBeInTheDocument();
    expect(detailMock).toHaveBeenCalledTimes(2);
  });

  it('删除当前批次会使未完成的问题请求失效，旧响应不会复活已删明细', async () => {
    const pending = deferred<ReturnType<typeof errorResult>>();
    getMock.mockImplementation((path: string) => {
      if (path === '/renewal/reports') return Promise.resolve({ reports: [makeReport(1)] });
      if (path === '/renewal/reports/1/errors') return pending.promise;
      return Promise.reject(new Error('unexpected path: ' + path));
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    await clickErrorBadge(user, 1);
    expect(screen.getByText('导入问题与警告 · 批次 #1')).toBeInTheDocument();

    const history = screen.getByRole('table');
    await user.click(within(history).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/renewal/reports/1'));
    await waitFor(() => expect(screen.queryByText('导入问题与警告 · 批次 #1')).not.toBeInTheDocument());

    await act(async () => {
      pending.resolve(errorResult('deleted-batch-stale-detail'));
      await pending.promise;
    });
    expect(screen.queryByText('deleted-batch-stale-detail')).not.toBeInTheDocument();
    expect(screen.queryByText('导入问题与警告 · 批次 #1')).not.toBeInTheDocument();
  });

  it('删除其他批次时保留当前问题明细', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/renewal/reports') return Promise.resolve({ reports: [makeReport(1), makeReport(2)] });
      if (path === '/renewal/reports/1/errors') return Promise.resolve(errorResult('current-batch-detail'));
      return Promise.reject(new Error('unexpected path: ' + path));
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    await clickErrorBadge(user, 1);
    expect(await screen.findByText('current-batch-detail')).toBeInTheDocument();

    const otherRow = screen.getByText('batch-2.xlsx').closest('tr');
    expect(otherRow).not.toBeNull();
    await user.click(within(otherRow!).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/renewal/reports/2'));
    expect(screen.getByText('current-batch-detail')).toBeInTheDocument();
    expect(screen.getByText('导入问题与警告 · 批次 #1')).toBeInTheDocument();
  });
});
