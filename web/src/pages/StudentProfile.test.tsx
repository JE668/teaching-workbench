import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
    // 掌握程度以中文标签展示（限定在回访档案卡片内：走势卡片也会渲染同名标签）
    const timelineCard = screen.getByText('回访档案').closest('.rounded-2xl') as HTMLElement;
    expect(within(timelineCard).getByText('优秀')).toBeInTheDocument();
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

describe('学生档案 · 掌握程度走势', () => {
  it('两次回访且掌握程度有变化时，展示走势卡片并给出判定', async () => {
    get.mockResolvedValue(profilePayload());

    renderProfile();

    const card = (await screen.findByText('掌握程度走势')).closest('.rounded-2xl') as HTMLElement;

    // 前一条良好 → 后一条优秀，跨一档：稳步提升
    // 判定文案在头部和图例行各出现一次，这里断言头部那处
    const header = card.querySelector('.border-b') as HTMLElement;
    expect(within(header).getByText('稳步提升')).toBeInTheDocument();
    expect(within(card).getAllByTestId('progression-bar')).toHaveLength(2);

    // 首尾对照行：只出现首尾两次的掌握程度，图例不会算进来
    const summary = card.querySelector('.space-y-5 > div') as HTMLElement;
    expect(within(summary).getByText('首次回访')).toBeInTheDocument();
    expect(within(summary).getByText('最近一次')).toBeInTheDocument();
    expect(within(summary).getAllByText('良好')).toHaveLength(1);
    expect(within(summary).getAllByText('优秀')).toHaveLength(1);

    // 图例四项齐全，方便对照条柱颜色（限定在图例行，首尾对照行也有同名标签）
    const legend = card.querySelector('.space-y-5 > div:last-child') as HTMLElement;
    for (const label of ['优秀', '良好', '一般', '需加强']) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
  });

  it('只有一次回访时不硬凑趋势，隐藏走势卡片', async () => {
    get.mockResolvedValue(profilePayload({ followups: [makeFollowUp({ id: 1 })] }));

    renderProfile();
    await screen.findByText('回访次数');

    expect(screen.queryByText('掌握程度走势')).not.toBeInTheDocument();
  });

  it('掌握程度全是脏值时无法比较，同样隐藏', async () => {
    get.mockResolvedValue(
      profilePayload({
        followups: [
          makeFollowUp({ id: 1, mastery: '写得很好', createdAt: '2026-09-08 10:00:00' }),
          makeFollowUp({ id: 2, mastery: '还可以', createdAt: '2026-10-08 10:00:00' }),
        ],
      })
    );

    renderProfile();
    await screen.findByText('回访次数');

    expect(screen.queryByText('掌握程度走势')).not.toBeInTheDocument();
  });

  it('掌握程度倒退时给出下滑判定', async () => {
    get.mockResolvedValue(
      profilePayload({
        followups: [
          makeFollowUp({ id: 1, mastery: 'excellent', createdAt: '2026-09-08 10:00:00' }),
          makeFollowUp({ id: 2, mastery: 'needs_improvement', createdAt: '2026-10-08 10:00:00' }),
        ],
      })
    );

    renderProfile();

    const card = (await screen.findByText('掌握程度走势')).closest('.rounded-2xl') as HTMLElement;
    expect(within(card).getByText('明显下滑')).toBeInTheDocument();
  });

  it('按时间从早到晚排列，条柱数量等于回访数量', async () => {
    get.mockResolvedValue(
      profilePayload({
        followups: [
          makeFollowUp({ id: 4, mastery: 'excellent', createdAt: '2026-10-20 10:00:00' }),
          makeFollowUp({ id: 1, mastery: 'needs_improvement', createdAt: '2026-09-08 10:00:00' }),
          makeFollowUp({ id: 2, mastery: 'average', createdAt: '2026-09-22 10:00:00' }),
          makeFollowUp({ id: 3, mastery: 'good', createdAt: '2026-10-06 10:00:00' }),
        ],
      })
    );

    renderProfile();

    const card = (await screen.findByText('掌握程度走势')).closest('.rounded-2xl') as HTMLElement;
    const bars = within(card).getAllByTestId('progression-bar');
    expect(bars).toHaveLength(4);

    // 日期标签升序，即使入参是乱序
    const dates = within(card).getAllByText(/^\d{2}-\d{2}$/).map((el) => el.textContent!.trim());
    expect(dates).toEqual(['09-08', '09-22', '10-06', '10-20']);

    // 条柱高度随掌握程度递增：1 → 2 → 3 → 4 档
    const heights = bars.map((el) => parseInt(el.getAttribute('style')!.match(/height:\s*(\d+)px/)![1], 10));
    expect(heights[0]).toBeLessThan(heights[1]);
    expect(heights[1]).toBeLessThan(heights[2]);
    expect(heights[2]).toBeLessThan(heights[3]);
  });
});
