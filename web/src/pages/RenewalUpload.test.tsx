import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RenewalUpload from './RenewalUpload';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const getMock = api.get as Mock;
const uploadMock = api.upload as Mock;
const deleteMock = api.delete as Mock;

/** 一个批次：默认无错误，按需覆盖 */
function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 1,
    fileName: '小榄龙山学习中心 2026年秋寒个性化学生续费统计.xlsx',
    fileSize: 2403891,
    statMonth: '2026-10',
    centerName: '小榄龙山学习中心',
    rowCount: 547,
    errorCount: 0,
    status: 'ok',
    uploadedAt: '2026-11-18 20:00:00',
    ...overrides,
  };
}

function mockApi(reports: unknown[] = []) {
  getMock.mockImplementation((path: string) => {
    if (path === '/renewal/reports') return Promise.resolve({ reports });
    if (path.startsWith('/renewal/dashboard/teacher-stats?tab=stage&reportId=')) {
      return Promise.resolve({ rows: [
        { baseCount: 200, prepaidCount: 150, extra: { prepaid_nongrad: 100 } },
        { baseCount: 106, prepaidCount: 76, extra: { prepaid_nongrad: 60 } },
      ] });
    }
    if (path.startsWith('/renewal/analytics/manager-perf?reportId=')) {
      return Promise.resolve({ rows: Array.from({ length: 6 }, (_, index) => ({ managerName: `学管${index + 1}` })) });
    }
    if (/^\/renewal\/reports\/\d+\/errors$/.test(path)) {
      return Promise.resolve({
        errors: [
          { sheet_name: '老师学生', row_number: 42, column_number: 3, error_type: 'missing_value', severity: 'error', error_message: '学生姓名为空', field_name: 'student_name' },
          { sheet_name: '续科率', row_number: 88, error_type: 'invalid_value', severity: 'warning', error_message: '本月是否续科不是 是/否', details_json: '{"summaryCount":88,"detailCount":86}' },
        ],
      });
    }
    return Promise.reject(new Error('unexpected path: ' + path));
  });
}

function fakeFile(name: string) {
  return new File(['xlsx-bytes'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** 模拟拖拽：事件结束后 dataTransfer 会被清空，所以只能在事件内同步读 */
async function dropFile(target: HTMLElement, file: File) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
  target.dispatchEvent(event);
}

beforeEach(() => {
  getMock.mockReset();
  uploadMock.mockReset();
  deleteMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('续费统计表上传', () => {
  it('还没有批次时显示空状态', async () => {
    mockApi();
    renderWithProviders(<RenewalUpload />);

    expect(await screen.findByText('还没有任何续费统计批次')).toBeInTheDocument();
    expect(screen.getByText('上传你做好的汇总表，看板就会自动出图。')).toBeInTheDocument();
  });

  it('历史批次按文件/月份/解析行数/状态展示', async () => {
    mockApi([makeReport(), makeReport({ reportId: 2, statMonth: '2026-09', errorCount: 3, rowCount: 612 })]);
    renderWithProviders(<RenewalUpload />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('2026-10')).toBeInTheDocument();
    expect(within(table).getByText('2026-09')).toBeInTheDocument();
    expect(within(table).getByText('547')).toBeInTheDocument();
    expect(within(table).getByText('612')).toBeInTheDocument();
    expect(within(table).getByText('正常')).toBeInTheDocument();
    expect(within(table).getByText('3 条错误')).toBeInTheDocument();
    expect(within(table).getAllByText(/小榄龙山学习中心/).length).toBeGreaterThan(0);
  });

  it('上传成功调用 upload 接口并带 file 字段', async () => {
    const uploaded = makeReport({ reportId: 3, fileName: '2026-10 续费统计汇总.xlsx' });
    // 上传成功后页面会重新拉批次列表，这里返回的就是刚上传的那份
    mockApi([uploaded]);
    uploadMock.mockResolvedValue({ report: uploaded });
    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    await screen.findByRole('table');

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, fakeFile('续费统计表.xlsx'));
    expect(screen.getByText('续费统计表.xlsx')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /上传并解析/ }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    const [path, form] = uploadMock.mock.calls[0] as unknown as [string, FormData];
    expect(path).toBe('/renewal/upload');
    expect((form.get('file') as File).name).toBe('续费统计表.xlsx');
    await screen.findByText('解析完成：2026-10 续费统计汇总.xlsx');
    expect(await screen.findByText('306')).toBeInTheDocument();
    expect(screen.getByText('226')).toBeInTheDocument();
    expect(screen.getByText('160')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看这个批次的看板' })).toHaveAttribute('href', '/renewal?reportId=3');
  });

  it('重复文件定位原批次，警告不会被成功提示掩盖', async () => {
    const uploaded = makeReport({
      reportId: 8,
      fileName: '带警告的续费统计.xlsx',
      status: 'committed_with_warnings',
      errorCount: 2,
    });
    mockApi([uploaded]);
    uploadMock.mockResolvedValue({ report: uploaded, deduplicated: true });
    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    await screen.findByRole('table');

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, fakeFile('带警告的续费统计.xlsx'));
    await user.click(screen.getByRole('button', { name: /上传并解析/ }));

    expect(await screen.findByText('解析完成，请先核对：带警告的续费统计.xlsx')).toBeInTheDocument();
    expect(screen.getByText('原批次')).toBeInTheDocument();
    expect(await screen.findByText('导入问题与警告 · 批次 #8')).toBeInTheDocument();
    expect(screen.getByText('第 42 行 · 第 3 列')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看这个批次的看板' })).toHaveAttribute('href', '/renewal?reportId=8');
  });

  it('拖拽 xlsx 文件即可选中', async () => {
    mockApi([]);
    renderWithProviders(<RenewalUpload />);
    const zone = await screen.findByLabelText('选择或拖拽上传续费统计表');
    await dropFile(zone, fakeFile('续费统计表.xlsx'));

    await waitFor(() => expect(screen.getByText('续费统计表.xlsx')).toBeInTheDocument());
  });

  it('拖拽非 xlsx 文件被拒', async () => {
    mockApi([]);
    renderWithProviders(<RenewalUpload />);
    const zone = await screen.findByLabelText('选择或拖拽上传续费统计表');
    await dropFile(zone, fakeFile('说明.txt'));

    await screen.findByText('请上传 xlsx / xls 文件');
    expect(screen.queryByText('说明.txt')).not.toBeInTheDocument();
  });

  it('点错误数徽章拉取解析错误明细并做 snake_case 映射', async () => {
    mockApi([makeReport({ reportId: 2, errorCount: 3 })]);
    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    const table = await screen.findByRole('table');

    await user.click(within(table).getByText('3 条错误'));

    expect(await screen.findByText('导入问题与警告 · 批次 #2')).toBeInTheDocument();
    const errTable = screen.getAllByRole('table')[0];
    expect(within(errTable).getByText('老师学生')).toBeInTheDocument();
    expect(within(errTable).getByText('学生姓名为空')).toBeInTheDocument();
    expect(within(errTable).getByText('续科率')).toBeInTheDocument();
    expect(within(errTable).getByText('C42 · 学生姓名')).toBeInTheDocument();
    expect(within(errTable).getByText('汇总值：88 · 明细值：86')).toBeInTheDocument();
  });

  it('删除批次要经过确认', async () => {
    mockApi([makeReport()]);
    const user = userEvent.setup();
    renderWithProviders(<RenewalUpload />);
    const table = await screen.findByRole('table');

    await user.click(within(table).getByRole('button', { name: '删除' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/renewal/reports/1'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });
});
