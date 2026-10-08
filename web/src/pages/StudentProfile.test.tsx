import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudentProfile from './StudentProfile';
import { renderWithProviders, makeStudent, makeFollowUp } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    streamPost: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;
const download = api.download as Mock;

function profilePayload(overrides: Record<string, unknown> = {}) {
  const student = makeStudent({ id: 6, name: '李小明' });
  const followups = [
    makeFollowUp({ id: 1, topic: '分数加减法运算' }),
    makeFollowUp({ id: 2, topic: '分数乘法与约分', mastery: 'excellent' }),
  ];
  return {
    student,
    followups,
    stats: {
      totalFollowups: followups.length,
      totalWords: 350,
      totalImages: 3,
      subjects: ['数学'],
      grades: ['小学五年级'],
      lastFollowUpAt: '2026-10-08 10:00:00',
    },
    ...overrides,
  };
}

const renderProfile = () =>
  renderWithProviders(<StudentProfile />, { route: '/students/6', path: '/students/:id' });

beforeEach(() => {
  get.mockReset();
  download.mockReset();
});

describe('学生档案 · 渲染', () => {
  it('展示学生信息、统计与备注', async () => {
    get.mockResolvedValue(profilePayload());

    renderProfile();

    // 注意：Testing Library 的 getByRole 没有 exact 选项，字符串 name 本就是精确匹配
    expect(await screen.findByRole('heading', { name: '李小明' })).toBeInTheDocument();
    expect(screen.getByText(/小学五年级/)).toBeInTheDocument();
    expect(screen.getByText('13900139000')).toBeInTheDocument();

    expect(screen.getByText('回访次数')).toBeInTheDocument();
    expect(screen.getByText('归档图片')).toBeInTheDocument();
    expect(screen.getByText('累计字数')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();

    expect(screen.getByText('学生备注')).toBeInTheDocument();
    expect(screen.getByText('计算能力较弱')).toBeInTheDocument();
  });

  it('按时间线渲染回访记录', async () => {
    get.mockResolvedValue(profilePayload());

    renderProfile();

    expect(await screen.findByText('分数加减法运算')).toBeInTheDocument();
    expect(screen.getByText('分数乘法与约分')).toBeInTheDocument();
    // 掌握程度以中文标签展示
    expect(screen.getByText('优秀')).toBeInTheDocument();
    expect(screen.getByText('2 条记录')).toBeInTheDocument();
  });

  it('档案不存在时给出提示', async () => {
    get.mockRejectedValue(new Error('学生不存在'));

    renderProfile();

    expect(await screen.findByText('学生档案不存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回学生列表' })).toBeInTheDocument();
  });

  it('无回访记录时显示空状态', async () => {
    get.mockResolvedValue(
      profilePayload({
        followups: [],
        stats: {
          totalFollowups: 0,
          totalWords: 0,
          totalImages: 0,
          subjects: [],
          grades: [],
          lastFollowUpAt: null,
        },
      })
    );

    renderProfile();

    expect(await screen.findByText('暂无回访记录')).toBeInTheDocument();
  });
});

describe('学生档案 · 展开与复制', () => {
  it('默认折叠，点击后完整展示正文', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(profilePayload());

    renderProfile();
    await screen.findByText('分数加减法运算');

    const toggles = screen.getAllByRole('button', { name: /展开全文/ });
    expect(toggles.length).toBeGreaterThan(0);

    await user.click(toggles[0]);
    expect(screen.getAllByRole('button', { name: /收起/ }).length).toBeGreaterThan(0);
  });

  it('复制成功给出提示', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(profilePayload());

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    renderProfile();
    await screen.findByText('分数加减法运算');

    await user.click(screen.getAllByRole('button', { name: /复制/ })[0]);

    expect(await screen.findByText('已复制回访内容')).toBeInTheDocument();
  });
});

describe('学生档案 · 导出', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom 没有 objectURL 与真实下载，需打桩避免报错
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('无回访记录时导出按钮禁用', async () => {
    get.mockResolvedValue(
      profilePayload({
        followups: [],
        stats: {
          totalFollowups: 0,
          totalWords: 0,
          totalImages: 0,
          subjects: [],
          grades: [],
          lastFollowUpAt: null,
        },
      })
    );

    renderProfile();
    await screen.findByText('暂无回访记录');

    expect(screen.getByRole('button', { name: /导出档案/ })).toBeDisabled();
  });

  it('选择 Markdown 后触发下载并提示成功', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(profilePayload());
    download.mockResolvedValue(new Blob(['# 李小明 · 学习档案'], { type: 'text/markdown' }));

    renderProfile();
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByRole('button', { name: /导出档案/ }));
    expect(screen.getByRole('heading', { name: '导出学习档案' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => {
      expect(download).toHaveBeenCalledWith(expect.stringContaining('/students/6/export?format=md'));
    });
    expect(clickSpy).toHaveBeenCalled();
    expect(await screen.findByText('档案已导出')).toBeInTheDocument();
  });

  it('切换到 CSV 并带日期区间', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(profilePayload());
    download.mockResolvedValue(new Blob(['a,b'], { type: 'text/csv' }));

    renderProfile();
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByRole('button', { name: /导出档案/ }));
    await user.click(screen.getByRole('button', { name: /CSV 表格/ }));
    await user.type(screen.getByLabelText(/起始日期/), '2026-01-01');
    await user.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => {
      const url = download.mock.calls[download.mock.calls.length - 1][0] as string;
      expect(url).toContain('format=csv');
      expect(url).toContain('from=2026-01-01');
    });
  });

  it('导出失败给出错误提示', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(profilePayload());
    download.mockRejectedValue(new Error('导出失败'));

    renderProfile();
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByRole('button', { name: /导出档案/ }));
    await user.click(screen.getByRole('button', { name: '导出' }));

    expect(await screen.findByText(/导出失败：导出失败/)).toBeInTheDocument();
  });
});
