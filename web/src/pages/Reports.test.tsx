import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Reports from './Reports';
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

const STUDENTS = [
  { id: 1, name: '李小明', grade: '初二', subject: '物理', phone: '', notes: '' },
  { id: 2, name: '王一可', grade: '初二', subject: '数学', phone: '', notes: '' },
];

let reportSeq = 50;

function makeReport(overrides: Record<string, unknown> = {}) {
  reportSeq += 1;
  return {
    id: reportSeq,
    student_id: 1,
    student_name: '李小明',
    year_month: '2026-09',
    term: '秋季',
    grade: '初二',
    subject: '物理',
    summary_enabled: true,
    plan_enabled: true,
    summary_intro: '',
    plan_intro: '',
    farewell: '',
    item_count: 0,
    created_at: '2026-10-18 10:00:00',
    updated_at: '2026-10-18 10:00:00',
    ...overrides,
  };
}

function mockApi(list: any[] = []) {
  request.mockImplementation((path: string, init?: any) => {
    if (path.startsWith('/reports?') || path === '/reports') {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body);
        const stu = STUDENTS.find((s) => s.id === body.studentId);
        const created = makeReport({
          student_id: body.studentId,
          student_name: stu?.name || '',
          year_month: body.yearMonth,
          term: body.term,
          grade: stu?.grade || '',
          subject: stu?.subject || '',
        });
        list.push(created);
        return Promise.resolve({ report: created, duplicated: false });
      }
      let data = list;
      const stu = path.split('studentId=')[1];
      if (stu) data = data.filter((r) => String(r.student_id) === stu);
      // 接口真的返回 { reports: [...] }。这里必须保持同样的形状 ——
      // 早先 mock 直接返回数组，页面里 reports.map 崩了整页白屏也没被测出来。
      return Promise.resolve({ reports: data });
    }
    if (/^\/reports\/\d+$/.test(path) && init?.method === 'DELETE') {
      const before = list.length;
      const idx = list.findIndex((r) => r.id === Number(path.split('/')[2]));
      if (idx >= 0) list.splice(idx, 1);
      return Promise.resolve({ deleted: list.length !== before ? 1 : 0, itemsDeleted: 0 });
    }
    if (path === '/students') return Promise.resolve({ students: STUDENTS });
    return Promise.reject(new Error('unexpected ' + path));
  });
}

/** 表格里的文本（选项里的同名文本不算） */
function inTable() {
  return within(screen.getByRole('table'));
}

/** 页头和空状态各有一个「新建月份」按钮，取页头那个（DOM 在前） */
function newButton() {
  return screen.getAllByRole('button', { name: /新建月份/ })[0];
}

/** 行内删除与确认弹窗里的删除同名，取弹窗里那个（DOM 在后） */
function confirmDeleteButton() {
  return screen.getAllByRole('button', { name: '删除' })[screen.getAllByRole('button', { name: '删除' }).length - 1];
}

beforeEach(() => {
  request.mockReset();
});

describe('月度报告列表', () => {
  it('还没有报告时显示空状态', async () => {
    mockApi();
    renderWithProviders(<Reports />);

    expect(await screen.findByText('还没有月度报告')).toBeInTheDocument();
    expect(screen.getByText('先选一个学生和月份，把本月课程排起来')).toBeInTheDocument();
  });

  it('列表展示学生、月份、学期与条目数', async () => {
    mockApi([
      makeReport({ student_name: '李小明', term: '秋季', year_month: '2026-09', item_count: 7 }),
      makeReport({ id: 52, student_id: 2, student_name: '王一可', term: '秋季', year_month: '2026-10', item_count: 3 }),
    ]);
    renderWithProviders(<Reports />);

    await waitFor(() => expect(inTable().getByText('李小明')).toBeInTheDocument());
    expect(inTable().getByText('王一可')).toBeInTheDocument();
    expect(inTable().getByText('2026年9月')).toBeInTheDocument();
    expect(inTable().getByText('2026年10月')).toBeInTheDocument();
    expect(inTable().getByText('7')).toBeInTheDocument();
    expect(inTable().getAllByText('秋季').length).toBe(2);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('学期筛选生效', async () => {
    mockApi([
      makeReport({ term: '秋季' }),
      makeReport({ id: 52, student_id: 2, student_name: '王一可', term: '寒假' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Reports />);
    await waitFor(() => expect(inTable().getByText('李小明')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('学期'), '寒假');
    await waitFor(() => expect(inTable().queryByText('李小明')).not.toBeInTheDocument());
    expect(inTable().getByText('王一可')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('学期'), '');
    await waitFor(() => expect(inTable().getByText('李小明')).toBeInTheDocument());
  });

  it('按学生筛选会请求带 studentId 的接口', async () => {
    mockApi([
      makeReport({ student_id: 1 }),
      makeReport({ id: 52, student_id: 2, student_name: '王一可' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Reports />);
    await waitFor(() => expect(inTable().getByText('李小明')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('学生'), '2');

    await waitFor(() => {
      const call = request.mock.calls.find(([p]) => String(p).includes('studentId=2'));
      expect(call).toBeDefined();
    });
    expect(inTable().getByText('王一可')).toBeInTheDocument();
    expect(inTable().queryByText('李小明')).not.toBeInTheDocument();
  });

  it('新建月份弹窗：选学生和学期后提交', async () => {
    const list: any[] = [];
    mockApi(list);
    const user = userEvent.setup();
    renderWithProviders(<Reports />);

    await user.click(newButton());
    const dialog = (await screen.findByText('新建月份报告')).closest('.fixed') as HTMLElement;

    await user.selectOptions(within(dialog).getByLabelText('学生'), '1');
    await user.selectOptions(within(dialog).getByLabelText('学期'), '寒假');

    expect(within(dialog).getByRole('button', { name: '创建' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      const post = request.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/reports');
      const body = JSON.parse(post![1].body);
      expect(body.studentId).toBe(1);
      expect(body.term).toBe('寒假');
      expect(/^\d{4}-\d{2}$/.test(body.yearMonth)).toBe(true);
    });

    await waitFor(() => expect(inTable().getByText('李小明')).toBeInTheDocument());
    expect(inTable().getByText('寒假')).toBeInTheDocument();
  });

  it('没选学生时创建按钮不可点', async () => {
    mockApi();
    const user = userEvent.setup();
    renderWithProviders(<Reports />);

    await user.click(newButton());
    const dialog = (await screen.findByText('新建月份报告')).closest('.fixed') as HTMLElement;
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('删除报告要经过确认，确认后从列表移除', async () => {
    const list: any[] = [makeReport({ item_count: 4 })];
    const targetId = list[0].id;
    mockApi(list);
    const user = userEvent.setup();
    renderWithProviders(<Reports />);
    await waitFor(() => expect(inTable().getByText('李小明')).toBeInTheDocument());

    await user.click(await screen.findByLabelText('删除'));

    expect(screen.getByText('删除这块报告？')).toBeInTheDocument();
    expect(screen.getByText(/2026年9月 及其 4 条明细会一起删掉/)).toBeInTheDocument();

    await user.click(confirmDeleteButton());

    await waitFor(() => {
      const del = request.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del?.[0]).toBe('/reports/' + targetId);
    });
    // 列表清空后表格被空状态取代
    await screen.findByText('还没有月度报告');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
