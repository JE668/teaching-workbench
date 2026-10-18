import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ObservationStats from './ObservationStats';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';
import type { CoverageData } from '../types/index';

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

const TEACHERS = [
  { id: 1, name: '王老师', subject: '数学' },
  { id: 2, name: '李老师', subject: '语文' },
  { id: 3, name: '张老师', subject: null },
];

/** 默认 90 天窗：1/3 被听过，张老师从未听过，李老师 200 天前听过 */
function coverageFor(days: number): CoverageData {
  return {
    window: { days, from: '2026-07-20', to: '2026-10-17' },
    totalTeachers: 3,
    observedCount: 1,
    unobservedCount: 2,
    coverage: 1 / 3,
    observed: [
      { teacherId: 1, teacherName: '王老师', subject: '数学', windowCount: 2, lastObservedAt: '2026-10-14', daysSince: 3 },
    ],
    unobserved: [
      { teacherId: 3, teacherName: '张老师', subject: null, windowCount: 0, lastObservedAt: null, daysSince: null },
      { teacherId: 2, teacherName: '李老师', subject: '语文', windowCount: 0, lastObservedAt: '2025-04-01', daysSince: 200 },
    ],
  };
}

/** 覆盖率请求的 days 全部按请求 URL 回显，便于断言切换时间窗真的生效 */
let nextCoverage: (days: number) => CoverageData = coverageFor;

beforeEach(() => {
  nextCoverage = coverageFor;
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) => {
    if (path === '/teachers') return { teachers: TEACHERS };
    if (path.startsWith('/observations/coverage')) {
      const days = Number(new URLSearchParams(path.split('?')[1]).get('days')) || 90;
      return nextCoverage(days);
    }
    return { teachers: [] };
  });
});

function renderStats() {
  return renderWithProviders(<ObservationStats />);
}

describe('听课覆盖率', () => {
  it('默认按近 90 天拉取，展示百分比、分母与未听课名单', async () => {
    renderStats();
    await screen.findByText('33%');

    expect(screen.getByText(/近 90 天内 1\/3 位老师被听过/)).toBeInTheDocument();
    expect(screen.getByText(/还有 2 位没听过/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');

    // 未听课名单：从未听过的排最前，且标出"从未"
    // （限定在名单容器内 —— 老师名字在上方筛选下拉里也会出现）
    const list = within(
      screen.getByText('这些老师近 90 天还没被听过').parentElement as HTMLElement
    );
    expect(list.getByText('张老师')).toBeInTheDocument();
    expect(list.getByText('从未')).toBeInTheDocument();
    // 有过历史的标出具体天数，好判断该从谁补起
    expect(list.getByText('李老师')).toBeInTheDocument();
    expect(list.getByText('200 天')).toBeInTheDocument();
  });

  it('切时间窗会带新的 days 重新请求', async () => {
    const user = userEvent.setup();
    renderStats();
    await screen.findByText('33%');

    await user.selectOptions(screen.getByLabelText('覆盖率时间窗'), '30');

    await waitFor(() => {
      const calls = get.mock.calls.map((c: any[]) => String(c[0]));
      expect(calls).toContain('/observations/coverage?days=30');
    });
    // 文案跟着窗口走，不会停留在旧值
    expect(await screen.findByText(/近 30 天内 1\/3 位老师被听过/)).toBeInTheDocument();
  });

  it('全部老师都被听过时给出正向提示，不再列名单', async () => {
    nextCoverage = (days) => ({
      window: { days, from: '2026-07-20', to: '2026-10-17' },
      totalTeachers: 3,
      observedCount: 3,
      unobservedCount: 0,
      coverage: 1,
      observed: [],
      unobserved: [],
    });

    renderStats();
    await screen.findByText('100%');

    expect(screen.getByText(/所有老师最近 90 天都被听过课了/)).toBeInTheDocument();
    expect(screen.queryByText(/还没有被听过/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('一个老师都还没有时展示空状态', async () => {
    nextCoverage = () => ({
      window: { days: 90, from: '2026-07-20', to: '2026-10-17' },
      totalTeachers: 0,
      observedCount: 0,
      unobservedCount: 0,
      coverage: 0,
      observed: [],
      unobserved: [],
    });
    renderStats();
    await screen.findByText('还没有老师');
    expect(screen.queryByText('33%')).not.toBeInTheDocument();
  });

  it('时间窗下拉只有明确起止的选项，没有"全部时间"这一说', async () => {
    renderStats();
    await screen.findByText('33%');

    const opts = within(screen.getByLabelText('覆盖率时间窗'))
      .getAllByRole('option')
      .map((o) => o.textContent?.trim() as string);
    expect(opts).toEqual(['近 30 天', '近 90 天', '近 180 天', '近 365 天']);
  });
});
