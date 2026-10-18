import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportEdit from './ReportEdit';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    request: vi.fn(),
    upload: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const request = api.request as Mock;

const REPORT_ID = 7;

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    user_id: 1,
    student_id: 3,
    student_name: '李小明',
    year_month: '2026-10',
    term: '秋季',
    grade: '初二',
    subject: '物理',
    summary_enabled: true,
    plan_enabled: true,
    summary_intro: '',
    plan_intro: '',
    farewell: '',
    item_count: 0,
    created_at: '2026-10-18 09:00:00',
    updated_at: '2026-10-18 09:00:00',
    ...overrides,
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 0,
    report_id: REPORT_ID,
    kind: 'plan',
    seq: 1,
    content: '',
    type: '',
    score: '',
    difficulty: '',
    scheduled_at: '',
    attendance: '',
    notes_done: '',
    mistakes_done: '',
    homework_done: '',
    exam: '',
    sort: 1,
    created_at: '2026-10-18 09:00:00',
    updated_at: '2026-10-18 09:00:00',
    ...overrides,
  };
}

let storeSeq = 100;

/**
 * 内存版的月度报告接口。
 * 用一个可变 store 模拟数据库，让「新增 / 改格 / 排序 / 删除」都有真实副作用，
 * 这样才能测出前端状态和请求是否一致。
 */
function mockStore(opts: { report?: any; items?: any[]; notFound?: boolean } = {}) {
  const report = { ...baseReport(), ...(opts.report || {}) };
  let items = (opts.items || []).map((i) => ({ ...i, id: ++storeSeq }));
  report.item_count = items.length;

  request.mockImplementation((path: string, init?: any) => {
    const method = init?.method || 'GET';

    if (path === `/reports/${REPORT_ID}` && method === 'GET') {
      if (opts.notFound) return Promise.reject(new Error('报告不存在'));
      return Promise.resolve({
        report: { ...report, item_count: items.length },
        items: items.map((i) => ({ ...i })),
      });
    }
    if (path === `/reports/${REPORT_ID}` && method === 'PATCH') {
      const body = JSON.parse(init.body);
      for (const [k, v] of Object.entries(body)) {
        if (k === 'summaryEnabled') report.summary_enabled = v;
        else if (k === 'planEnabled') report.plan_enabled = v;
        else if (k === 'summaryIntro') report.summary_intro = v;
        else if (k === 'planIntro') report.plan_intro = v;
        else if (k === 'farewell') report.farewell = v;
        else if (k === 'term') report.term = v;
      }
      return Promise.resolve({ report: { ...report, item_count: items.length } });
    }
    if (path === `/reports/${REPORT_ID}` && method === 'DELETE') {
      return Promise.resolve({ deleted: 1, itemsDeleted: items.length });
    }

    if (path === `/reports/${REPORT_ID}/exams` && method === 'POST') {
      const body = JSON.parse(init.body);
      const suggestions = [
        { date: '2026-11-08', ordinal: '第一次', prefix: '秋季度', content: '秋季度第一次阶测安排：时间11月8日：' },
        { date: '2026-11-29', ordinal: '第二次', prefix: '秋季度', content: '秋季度第二次阶测安排：时间11月29日：' },
      ];
      if (body.insert) {
        for (const s of suggestions) {
          items = [
            ...items,
            makeItem({ id: ++storeSeq, kind: 'exam', content: s.content, scheduled_at: s.date, sort: ++storeSeq }),
          ];
        }
      }
      return Promise.resolve({
        suggestions,
        inserted: body.insert ? suggestions.length : 0,
        startDate: '2026-09-30',
        endDate: '2026-11-16',
      });
    }

    if (path === `/reports/${REPORT_ID}/items/move` && method === 'POST') {
      const body = JSON.parse(init.body);
      const idx = items.findIndex((i) => i.id === body.itemId);
      const dir = body.dir === 'up' ? -1 : 1;
      const target = idx + dir;
      const moved = idx >= 0 && target >= 0 && target < items.length;
      if (moved) [items[idx], items[target]] = [items[target], items[idx]];
      return Promise.resolve({ items: items.map((i) => ({ ...i })), moved });
    }

    if (path === `/reports/${REPORT_ID}/items` && method === 'POST') {
      const body = JSON.parse(init.body);
      const item = makeItem({ id: ++storeSeq, ...body, seq: body.seq ?? items.length + 1, sort: items.length + 1 });
      items = [
        ...items.filter((i) => i.kind !== body.kind),
        item,
        ...items.filter((i) => i.kind === body.kind),
      ];
      return Promise.resolve({ item: { ...item } });
    }

    const itemMatch = path.match(new RegExp(`^/reports/${REPORT_ID}/items/(\\d+)$`));
    if (itemMatch) {
      const targetId = Number(itemMatch[1]);
      if (method === 'PATCH') {
        const body = JSON.parse(init.body);
        items = items.map((i) => (i.id === targetId ? { ...i, ...body } : i));
        return Promise.resolve({ item: items.find((i) => i.id === targetId) });
      }
      if (method === 'DELETE') {
        const before = items.length;
        items = items.filter((i) => i.id !== targetId);
        return Promise.resolve({ deleted: before - items.length, sort: items.length });
      }
    }

    if (path.startsWith('/catalog/courses')) {
      return Promise.resolve({
        total: 2,
        courses: [
          { id: 11, content: '凸透镜成像的规律', type: '同步', score: '8', difficulty: '★★★★★', textbook: '人教版（2024）' },
          { id: 12, content: '眼睛与眼镜', type: '同步', score: '6', difficulty: '★★★★★', textbook: '人教版（2024）' },
        ],
      });
    }

    return Promise.reject(new Error('unexpected ' + method + ' ' + path));
  });
}

function render() {
  return renderWithProviders(<ReportEdit />, { route: `/reports/${REPORT_ID}`, path: '/reports/:id' });
}

/** 表格里按显示值找到单元格所在行 */
function trOf(value: string): HTMLElement {
  return screen.getByDisplayValue(value).closest('tr') as HTMLElement;
}

function patchCalls() {
  return request.mock.calls.filter(([p, init]) => p === `/reports/${REPORT_ID}` && init?.method === 'PATCH');
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

function itemPatchCalls() {
  return request.mock.calls.filter(
    ([p, init]) => typeof p === 'string' && p.includes(`/reports/${REPORT_ID}/items/`) && init?.method === 'PATCH'
  );
}

function itemPostCalls() {
  return request.mock.calls.filter(
    ([p, init]) => p === `/reports/${REPORT_ID}/items` && init?.method === 'POST'
  );
}

beforeEach(() => {
  request.mockReset();
});

describe('月度报告编辑器', () => {
  it('显示学生、月份、学期和条目数', async () => {
    mockStore({ items: [makeItem({ kind: 'plan', content: '凸透镜成像' })] });
    render();

    expect(await screen.findByText('李小明')).toBeInTheDocument();
    expect(screen.getByText('2026年10月')).toBeInTheDocument();
    expect(screen.getByText('初二 · 物理')).toBeInTheDocument();
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('凸透镜成像')).toBeInTheDocument();
  });

  it('报告不存在时给出提示和返回链接', async () => {
    mockStore({ notFound: true });
    render();

    expect(await screen.findByText('没有找到这块报告，可能已经被删除了')).toBeInTheDocument();
    expect(screen.getByText(/返回报告列表/)).toBeInTheDocument();
  });

  it('可以切换学期', async () => {
    mockStore();
    const user = userEvent.setup();
    render();
    await screen.findByText('李小明');

    await user.selectOptions(screen.getByLabelText('学期'), '寒假');

    await waitFor(() => {
      const patch = last(patchCalls());
      expect(JSON.parse(patch![1].body)).toEqual({ term: '寒假' });
    });
  });

  it('关闭总结面板会提交 summaryEnabled=false，并隐藏表格', async () => {
    mockStore({ items: [makeItem({ kind: 'summary', content: '凸透镜成像' })] });
    const user = userEvent.setup();
    render();
    await screen.findByDisplayValue('凸透镜成像');

    const [summarySwitch] = screen.getAllByRole('switch');
    await user.click(summarySwitch);

    await waitFor(() => {
      const patch = last(patchCalls());
      expect(JSON.parse(patch![1].body)).toEqual({ summaryEnabled: false });
    });
    expect(screen.queryByLabelText('凸透镜成像 课程内容')).not.toBeInTheDocument();
    expect(screen.getByText('已关闭')).toBeInTheDocument();
  });

  it('可以关掉规划面板', async () => {
    mockStore();
    const user = userEvent.setup();
    render();
    await screen.findByText('自动推算阶测');

    const [, planSwitch] = screen.getAllByRole('switch');
    await user.click(planSwitch);

    await waitFor(() => {
      const patch = last(patchCalls());
      expect(JSON.parse(patch![1].body)).toEqual({ planEnabled: false });
    });
    expect(screen.queryByText('自动推算阶测')).not.toBeInTheDocument();
  });

  it('加空行会带上当前序号 + 1', async () => {
    mockStore({ items: [makeItem({ kind: 'summary', seq: 2, content: '第二课' })] });
    const user = userEvent.setup();
    render();
    await screen.findByDisplayValue('第二课');

    // 两个面板各有一个「加空行」，取总结面板那个（DOM 在前）
    await user.click(screen.getAllByRole('button', { name: '加空行' })[0]);

    await waitFor(() => {
      const post = last(itemPostCalls());
      expect(JSON.parse(post![1].body)).toMatchObject({ kind: 'summary', seq: 3 });
    });
    await waitFor(() => expect(screen.getAllByLabelText(/^.* 课程内容$/).length).toBe(2));
  });

  it('改单元格失焦后提交对应字段', async () => {
    mockStore({ items: [makeItem({ kind: 'summary', content: '凸透镜成像' })] });
    const user = userEvent.setup();
    render();
    await screen.findByLabelText('凸透镜成像 课程内容');

    await user.type(screen.getByLabelText('凸透镜成像 课程内容'), '探究实验');
    await user.tab();

    await waitFor(() => {
      const patch = last(itemPatchCalls());
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1].body)).toEqual({ content: '凸透镜成像探究实验' });
    });
    expect(screen.getByDisplayValue('凸透镜成像探究实验')).toBeInTheDocument();
  });

  it('内容没改过就不发请求', async () => {
    mockStore({ items: [makeItem({ kind: 'summary', content: '凸透镜成像' })] });
    const user = userEvent.setup();
    render();
    await screen.findByLabelText('凸透镜成像 课程内容');

    await user.click(screen.getByLabelText('凸透镜成像 课程内容'));
    await user.tab();

    await waitFor(() => expect(screen.getByDisplayValue('凸透镜成像')).toBeInTheDocument());
    expect(itemPatchCalls()).toHaveLength(0);
  });

  it('考试情况可以填分数', async () => {
    mockStore({ items: [makeItem({ kind: 'summary', content: '凸透镜成像' })] });
    const user = userEvent.setup();
    render();
    await screen.findByLabelText('凸透镜成像 考试情况');

    await user.type(screen.getByLabelText('凸透镜成像 考试情况'), '87');
    await user.tab();

    await waitFor(() => {
      const patch = last(itemPatchCalls());
      expect(JSON.parse(patch![1].body)).toEqual({ exam: '87' });
    });
  });

  it('自动推算阶测先预览，确认后才加入', async () => {
    mockStore();
    const user = userEvent.setup();
    render();
    await screen.findByText('自动推算阶测');

    await user.click(screen.getByRole('button', { name: /自动推算阶测/ }));

    const dialog = (await screen.findByText('自动推算的阶测安排')).closest('.fixed') as HTMLElement;
    expect(within(dialog).getByText('秋季度第一次阶测安排：时间11月8日：')).toBeInTheDocument();
    expect(within(dialog).getByText('秋季度第二次阶测安排：时间11月29日：')).toBeInTheDocument();
    // 只预览时不应插库
    expect(
      request.mock.calls.find(([p, init]) => p === `/reports/${REPORT_ID}/exams` && JSON.parse(init.body).insert === true)
    ).toBeUndefined();

    await user.click(within(dialog).getByRole('button', { name: '全部加入规划' }));

    await waitFor(() => {
      const post = request.mock.calls.find(
        ([p, init]) => p === `/reports/${REPORT_ID}/exams` && JSON.parse(init.body).insert === true
      );
      expect(post).toBeDefined();
    });
    expect(await screen.findByText('阶测安排（2）')).toBeInTheDocument();
  });

  it('可以手动加一条阶测', async () => {
    mockStore();
    const user = userEvent.setup();
    render();
    await screen.findByText('手动加阶测');

    await user.click(screen.getByRole('button', { name: '手动加阶测' }));

    await waitFor(() => {
      const post = last(itemPostCalls());
      expect(JSON.parse(post![1].body)).toMatchObject({ kind: 'exam', content: '阶测安排' });
    });
    expect(await screen.findByText('阶测安排（1）')).toBeInTheDocument();
    expect(screen.getByLabelText('阶测内容')).toBeInTheDocument();
  });

  it('可以在课程目录里勾选并批量添加', async () => {
    mockStore();
    const user = userEvent.setup();
    render();
    await screen.findByText('自动推算阶测');

    // 规划面板的「从课程目录添加」在第二个
    const pickerButtons = screen.getAllByRole('button', { name: /从课程目录添加/ });
    await user.click(pickerButtons[pickerButtons.length - 1]);

    const dialog = (await screen.findByText('从课程目录添加 · 规划')).closest('.fixed') as HTMLElement;
    const rows = within(dialog).getAllByRole('checkbox');
    await user.click(rows[0]);
    expect(within(dialog).getByText('已选 1 门')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '添加 1 门' }));

    await waitFor(() => {
      const post = last(itemPostCalls());
      expect(JSON.parse(post![1].body)).toMatchObject({ kind: 'plan', content: '凸透镜成像的规律', score: '8' });
    });
    expect(await screen.findByDisplayValue('凸透镜成像的规律')).toBeInTheDocument();
  });

  it('总结摘要和祝福语失焦后保存', async () => {
    mockStore();
    const user = userEvent.setup();
    render();
    await screen.findByText('李小明');

    await user.type(screen.getByPlaceholderText(/课堂情况/), '本月完成 7 次课');
    await user.tab();
    await user.type(screen.getByLabelText('结尾祝福语'), '继续加油');
    await user.tab();

    await waitFor(() => {
      const patches = patchCalls().map(([, init]) => JSON.parse(init.body));
      expect(patches).toContainEqual({ summaryIntro: '本月完成 7 次课' });
      expect(patches).toContainEqual({ farewell: '继续加油' });
    });
  });

  it('上移会把相邻两行交换', async () => {
    mockStore({
      items: [
        makeItem({ kind: 'summary', seq: 1, content: '第一课' }),
        makeItem({ kind: 'summary', seq: 2, content: '第二课' }),
      ],
    });
    const user = userEvent.setup();
    render();
    await screen.findByDisplayValue('第二课');

    await user.click(within(trOf('第二课')).getByLabelText('上移'));

    await waitFor(() => {
      const call = request.mock.calls.find(([p, init]) => p === `/reports/${REPORT_ID}/items/move`);
      expect(JSON.parse(call![1].body)).toMatchObject({ dir: 'up' });
    });
    await waitFor(() => {
      const values = (screen.getAllByLabelText(/^.* 课程内容$/) as HTMLInputElement[]).map((e) => e.value);
      expect(values[0]).toContain('第二课');
      expect(values[1]).toContain('第一课');
    });
  });

  it('第一行不能再上移', async () => {
    mockStore({
      items: [makeItem({ kind: 'summary', content: '第一课' }), makeItem({ kind: 'summary', content: '第二课' })],
    });
    render();
    await screen.findByDisplayValue('第一课');
    expect(within(trOf('第一课')).getByLabelText('上移')).toBeDisabled();
    expect(within(trOf('第二课')).getByLabelText('下移')).toBeDisabled();
  });

  it('删除一条明细', async () => {
    mockStore({ items: [makeItem({ kind: 'plan', content: '凸透镜成像' })] });
    const user = userEvent.setup();
    render();
    await screen.findByDisplayValue('凸透镜成像');

    await user.click(within(trOf('凸透镜成像')).getByLabelText('删除'));

    await waitFor(() => {
      const del = request.mock.calls.find(
        ([p, init]) => typeof p === 'string' && p.includes(`/reports/${REPORT_ID}/items/`) && init?.method === 'DELETE'
      );
      expect(del).toBeDefined();
    });
    await waitFor(() => expect(screen.queryByDisplayValue('凸透镜成像')).not.toBeInTheDocument());
  });

  it('删除整块报告要确认，并请求删除接口', async () => {
    mockStore({ items: [makeItem({ kind: 'plan', content: '凸透镜成像' })] });
    const user = userEvent.setup();
    render();
    await screen.findByText('李小明');

    await user.click(screen.getByRole('button', { name: '删除报告' }));
    expect(screen.getByText('删除这块报告？')).toBeInTheDocument();
    expect(screen.getByText(/2026年10月 及其 1 条明细会一起删掉/)).toBeInTheDocument();

    // 行内删除与确认按钮同名，取弹窗里那个（DOM 在后）
    const deletes = screen.getAllByRole('button', { name: '删除' });
    await user.click(deletes[deletes.length - 1]);

    await waitFor(() => {
      const del = request.mock.calls.find(([p, init]) => p === `/reports/${REPORT_ID}` && init?.method === 'DELETE');
      expect(del).toBeDefined();
    });
  });
});
