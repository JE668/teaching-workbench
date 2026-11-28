import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeachingData from './TeachingData';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
    downloadFile: vi.fn(),
  },
}));

const getMock = api.get as Mock;
const postMock = api.post as Mock;
const requestMock = api.request as Mock;
const downloadMock = api.downloadFile as Mock;

const CONFIG = {
  campus: {
    branchId: 'BR001',
    branchName: '中山分公司',
    campusId: 'CP001',
    campusName: '小榄龙山学习中心',
  },
  pageSize: 50,
  maxPages: 200,
  retryTimes: 3,
};

const RESULT = {
  data: [
    { 所属组: '数学一组', 统计口径: '按上课次数', 教师: '陈老师', 日期: '2026-11-01', 学生: '李小明', 状态: '已完成', 课程标签: '正常' },
  ],
  total: 12,
  fetchId: 'fetch-owner-bound',
  warnings: ['理综组第 2 页重试后仍失败，已跳过'],
  stats: { okPages: 3, failedPages: 1, emptyDepartments: [], truncated: [], elapsedSeconds: 1.25 },
};

async function connectManual(user: ReturnType<typeof userEvent.setup>, token = 'upstream-secret-token') {
  await user.click(screen.getByRole('button', { name: '手动 Token' }));
  await user.type(screen.getByLabelText('教学平台 Token'), token);
  await user.click(screen.getByRole('button', { name: '使用此 Token 连接' }));
  await screen.findByText('现在可以设置筛选条件并提取数据。刷新页面后需重新连接。');
}

describe('TeachingData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    getMock.mockResolvedValue(CONFIG);
    requestMock.mockResolvedValue(RESULT);
    downloadMock.mockResolvedValue({ blob: new Blob(['xlsx']), filename: '课堂反馈_2026-11.xlsx' });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:teaching-data') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('uses a manual upstream token only in memory and renders preview, stats and warnings', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeachingData />);
    expect(await screen.findByText(/单页提取上限 50 条/)).toBeInTheDocument();
    await connectManual(user);

    await user.click(screen.getByRole('button', { name: '开始提取数据' }));
    expect(await screen.findByText('数学一组')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('理综组第 2 页重试后仍失败，已跳过')).toBeInTheDocument();
    expect(screen.getByText('页面仅显示前 10 条，下载文件包含全部提取结果')).toBeInTheDocument();

    const options = requestMock.mock.calls[0][1];
    const payload = JSON.parse(options.body);
    expect(requestMock.mock.calls[0][0]).toBe('/teaching-data/fetch');
    expect(options.timeoutMs).toBe(300000);
    expect(payload.token).toBe('upstream-secret-token');
    expect(payload.modelType).toBe('feedback');
    expect(payload.branchName).toBe('中山分公司');
    expect(payload.courseTags).toEqual([]);
    expect(JSON.stringify(localStorage)).not.toContain('upstream-secret-token');
    expect(JSON.stringify(sessionStorage)).not.toContain('upstream-secret-token');
  });

  it('completes account login and SMS two-step verification', async () => {
    const user = userEvent.setup();
    postMock.mockImplementation(async (path: string) => {
      if (path === '/teaching-data/login') return { needTwoStep: true, twoStepId: 'two-step-id', methods: ['sms', 'wx'], message: '请选择验证方式' };
      if (path === '/teaching-data/two-step/send') return { message: '短信验证码已发送' };
      if (path === '/teaching-data/two-step/verify') return { token: 'verified-upstream-token' };
      throw new Error('unexpected request');
    });
    renderWithProviders(<TeachingData />);
    await screen.findByText(/单页提取上限 50 条/);
    await user.type(screen.getByLabelText('教学平台账号'), 'teacher@example.com');
    await user.type(screen.getByLabelText('教学平台密码'), 'account-password');
    await user.click(screen.getByRole('button', { name: '登录并连接' }));

    expect(await screen.findByText('请选择验证方式')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByText('短信验证码已发送')).toBeInTheDocument();
    await user.type(screen.getByLabelText('验证码'), '123456');
    await user.click(screen.getByRole('button', { name: '完成二次验证' }));
    await screen.findByText('现在可以设置筛选条件并提取数据。刷新页面后需重新连接。');

    expect(postMock.mock.calls.map((call) => call[0])).toEqual([
      '/teaching-data/login',
      '/teaching-data/two-step/send',
      '/teaching-data/two-step/verify',
    ]);
    expect(postMock.mock.calls[2][1]).toEqual({ twoStepId: 'two-step-id', code: '123456' });
    expect(JSON.stringify(localStorage)).not.toContain('verified-upstream-token');
    expect(JSON.stringify(localStorage)).not.toContain('account-password');
  });

  it('switches to evaluation filters and preserves the dual-sheet both option', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeachingData />);
    await screen.findByText(/单页提取上限 50 条/);
    await connectManual(user);
    await user.click(screen.getByRole('button', { name: /阶段评估/ }));

    expect(screen.getByLabelText('统计口径')).toHaveValue('both');
    expect(screen.getByLabelText('学年')).toBeInTheDocument();
    expect(screen.queryByLabelText(/开始日期/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('学期'), '3');
    expect(screen.queryByLabelText('考试类型')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '开始提取数据' }));

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const payload = JSON.parse(requestMock.mock.calls[0][1].body);
    expect(payload.modelType).toBe('evaluate_analysis');
    expect(payload.colType).toBe('both');
    expect(payload.term).toBe('3');
    expect(payload.examType).toBe('');
  });

  it('blocks an invalid date range before calling the server', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeachingData />);
    await screen.findByText(/单页提取上限 50 条/);
    await connectManual(user);
    await user.clear(screen.getByLabelText(/开始日期/));
    await user.type(screen.getByLabelText(/开始日期/), '2026-11-30');
    await user.clear(screen.getByLabelText(/结束日期/));
    await user.type(screen.getByLabelText(/结束日期/), '2026-11-01');
    await user.click(screen.getByRole('button', { name: '开始提取数据' }));

    expect(await screen.findByText('开始日期不能晚于结束日期')).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('downloads the complete workbook with the server-provided Chinese filename', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeachingData />);
    await screen.findByText(/单页提取上限 50 条/);
    await connectManual(user);
    await user.click(screen.getByRole('button', { name: '开始提取数据' }));
    await screen.findByText('数学一组');
    await user.click(screen.getByRole('button', { name: '下载完整 Excel' }));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('/teaching-data/download/fetch-owner-bound'));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(await screen.findByText('Excel 已下载')).toBeInTheDocument();
  });
});
