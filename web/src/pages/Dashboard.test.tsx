import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './Dashboard';
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

/**
 * 取统计卡片的数值文案。
 * 卡片里数值与单位在同一个 <p> 内（如 "2人"），
 * 直接 getByText('2') 因精确匹配会落空，故先定位卡片再读整段。
 */
function statValue(label: string): string {
  const card = screen.getByText(label).closest('div.rounded-2xl') as HTMLElement;
  return card.querySelector('p')?.textContent || '';
}

/** 按路径分发不同的 mock 返回 */
function mockApi(
  students: unknown[],
  stats: Record<string, unknown>,
  pending: unknown[] = []
) {
  get.mockImplementation((path: string) => {
    if (path === '/students') return Promise.resolve({ students });
    if (path === '/followups/stats') return Promise.resolve(stats);
    if (path.startsWith('/students/needs-followup')) return Promise.resolve({ students: pending });
    return Promise.reject(new Error('unexpected path: ' + path));
  });
}

beforeEach(() => {
  get.mockReset();
});

describe('工作台 · 统计', () => {
  it('统计数据来自 /followups/stats（而非列表长度）', async () => {
    mockApi(
      [makeStudent({ id: 1, subject: '数学' }), makeStudent({ id: 2, subject: '英语' })],
      // 故意让 stats 的数量大于列表长度，验证确实用了统计接口
      { totalFollowUps: 137, totalImages: 42, subjects: 5, recent: [] }
    );

    renderWithProviders(<Dashboard />);

    // 学生总数取自学生列表
    expect(await screen.findByText('学生总数')).toBeInTheDocument();
    expect(statValue('学生总数')).toBe('2人');

    // 回访次数 / 归档图片取自 stats，而非列表长度
    expect(statValue('回访次数')).toBe('137次');
    expect(statValue('归档图片')).toBe('42张');
  });

  it('覆盖学科按学生学科去重统计', async () => {
    mockApi(
      [
        makeStudent({ id: 1, subject: '数学' }),
        makeStudent({ id: 2, subject: '数学' }),
        makeStudent({ id: 3, subject: '英语' }),
      ],
      { totalFollowUps: 0, totalImages: 0, subjects: 0, recent: [] }
    );

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('覆盖学科')).toBeInTheDocument();
    // 数学 + 英语，去重后为 2
    expect(statValue('覆盖学科')).toBe('2科');
  });
});

describe('工作台 · 待回访', () => {
  it('列出超期未回访的学生及已过天数', async () => {
    mockApi([], { totalFollowUps: 0, totalImages: 0, subjects: 0, recent: [] }, [
      { id: 1, name: '小明', grade: '小学五年级', subject: '数学', daysSince: 12 },
      { id: 2, name: '小红', grade: '小学六年级', subject: '英语', daysSince: null },
    ]);

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('待回访')).toBeInTheDocument();
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('12 天前')).toBeInTheDocument();
    expect(screen.getByText('从未回访')).toBeInTheDocument();
  });

  it('没有待回访时显示"都回访过了"', async () => {
    mockApi([], { totalFollowUps: 0, totalImages: 0, subjects: 0, recent: [] }, []);

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText(/全部学生都已在 7 天内回访过/)).toBeInTheDocument();
  });

  it('切换天数会重新拉取', async () => {
    const user = userEvent.setup();
    mockApi([], { totalFollowUps: 0, totalImages: 0, subjects: 0, recent: [] }, []);

    renderWithProviders(<Dashboard />);
    await screen.findByText('待回访');

    get.mockClear();
    await user.click(screen.getByRole('button', { name: '30 天' }));

    await waitFor(() => {
      expect(get.mock.calls.some((c) => String(c[0]).includes('days=30'))).toBe(true);
    });
  });
});

describe('工作台 · 近期回访', () => {
  it('展示最近记录及其学科与主题', async () => {
    mockApi([], {
      totalFollowUps: 1,
      totalImages: 0,
      subjects: 1,
      recent: [makeFollowUp({ topic: '分数加减法运算', subject: '数学' })],
    });

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('李小明')).toBeInTheDocument();
    expect(screen.getByText(/数学 · 分数加减法运算/)).toBeInTheDocument();
    expect(screen.getByText('良好')).toBeInTheDocument();
  });

  it('无回访时显示空状态与引导入口', async () => {
    mockApi([], { totalFollowUps: 0, totalImages: 0, subjects: 0, recent: [] });

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('还没有回访记录')).toBeInTheDocument();
    expect(screen.getByText('开始生成')).toBeInTheDocument();
  });

  it('无学生时显示空状态', async () => {
    mockApi([], { totalFollowUps: 0, totalImages: 0, subjects: 0, recent: [] });

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('还没有学生')).toBeInTheDocument();
    expect(screen.getByText('添加学生')).toBeInTheDocument();
  });
});

describe('工作台 · 加载失败', () => {
  it('接口异常时不崩溃', async () => {
    get.mockRejectedValue(new Error('网络异常'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<Dashboard />);

    // 仍应渲染页面骨架内容，而不是白屏
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByText('学生总数')).toBeInTheDocument();

    spy.mockRestore();
  });
});
