import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BiSettings from './BiSettings';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;
const post = api.post as Mock;
const patch = api.patch as Mock;
const del = api.delete as Mock;

const OVERRIDE_ROWS = [
  { id: 1, scope: 'mentor', key_type: 'name', key_value: '罗卢熙', indicator: 'xusheng_rate',
    override_value: '豁免', reason: '特殊学生', effective_from: '2026-11-01', effective_to: null },
];
const INCENTIVE_ROWS = [
  { id: 1, scope: 'mentor', scope_value: '李学管', target_rate: 0.8,
    effective_from: '2026-01-01', effective_to: null },
];
const TEACHER_ROWS = [
  { id: 1, teacher_no: 'T001', teacher_name: '张老师', student_id: 'STU001', student_name: '小明',
    is_prepaid: 1, prepaid_overridden: 0, grade: '高一', note: null },
];
const MENTOR_ROWS = [
  { id: 1, mentor_no: 'M001', mentor_name: '李学管', student_id: 'STU001', student_name: '小明',
    grade: '高一', note: null },
];

function mockGet() {
  get.mockImplementation((path: string) => {
    if (path.includes('/indicator-overrides')) return Promise.resolve({ overrides: OVERRIDE_ROWS });
    if (path.includes('/incentive-settings')) return Promise.resolve({ settings: INCENTIVE_ROWS });
    if (path.includes('/teacher-students')) return Promise.resolve({ teachers: TEACHER_ROWS });
    if (path.includes('/mentor-students')) return Promise.resolve({ mentors: MENTOR_ROWS });
    return Promise.reject(new Error('unmocked: ' + path));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet();
  window.confirm = vi.fn(() => true);
});

async function switchTab(label: string) {
  await userEvent.click(screen.getByRole('button', { name: label }));
}

// 新增按钮在页头，保存按钮在表单内部，避免同名冲突
function getOpenFormButton(name: string) {
  return screen.getAllByRole('button', { name }).find(b => !b.closest('form'))!;
}
function getSaveButton() {
  return screen.getAllByRole('button', { name: '保存' }).find(b => !!b.closest('div.rounded-lg'))!;
}

describe('BiSettings - 指标覆盖规则 tab', () => {
  it('默认展示覆盖规则列表', async () => {
    renderWithProviders(<BiSettings />);
    expect(await screen.findByText('罗卢熙')).toBeInTheDocument();
    expect(screen.getByText('豁免')).toBeInTheDocument();
  });

  it('点击"新增覆盖规则"→ 填写表单 → POST /bi/indicator-overrides', async () => {
    post.mockResolvedValue({ override: {} });
    renderWithProviders(<BiSettings />);
    await screen.findByText('罗卢熙');
    await userEvent.click(getOpenFormButton('新增覆盖规则'));
    // 表单出现后页面有两个 h3: 新增覆盖规则
    const formTitle = screen.getByRole('heading', { name: '新增覆盖规则' });
    const form = formTitle.parentElement!;
    await userEvent.type(within(form).getByLabelText(/key_type/), 'name');
    await userEvent.type(within(form).getByLabelText(/key_value/), '王学管');
    await userEvent.type(within(form).getByLabelText(/indicator/), 'xuke_rate');
    await userEvent.type(within(form).getByLabelText(/override_value/), '豁免');
    await userEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/bi/indicator-overrides', expect.objectContaining({
        key_type: 'name', key_value: '王学管',
      }));
    });
  });

  it('点击编辑按钮回填表单 → 显示已有 override_value', async () => {
    renderWithProviders(<BiSettings />);
    await screen.findByText('罗卢熙');
    await userEvent.click(screen.getByRole('button', { name: '编辑' }));
    const formTitle = screen.getByRole('heading', { name: '编辑覆盖规则' });
    const form = formTitle.parentElement!;
    const overrideInput = within(form).getByLabelText(/override_value/) as HTMLInputElement;
    expect(overrideInput.value).toBe('豁免');
    // 取消按钮
    await userEvent.click(within(form).getByRole('button', { name: '取消' }));
  });

  it('删除：点击删除 → DELETE /bi/indicator-overrides/:id', async () => {
    del.mockResolvedValue({ message: '已删除' });
    renderWithProviders(<BiSettings />);
    await screen.findByText('罗卢熙');
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(del).toHaveBeenCalledWith('/bi/indicator-overrides/1');
    });
  });
});

describe('BiSettings - 激励目标比例 tab', () => {
  it('展示激励列表，0.8 显示为 80%', async () => {
    renderWithProviders(<BiSettings />);
    await switchTab('激励目标比例');
    expect(await screen.findByText('李学管')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('新增激励：输入对象 + 80 → POST body.target_rate = 0.8', async () => {
    post.mockResolvedValue({ setting: {} });
    renderWithProviders(<BiSettings />);
    await switchTab('激励目标比例');
    await userEvent.click(getOpenFormButton('新增目标比例'));
    const formTitle = screen.getByRole('heading', { name: '新增激励目标' });
    const form = formTitle.parentElement!;
    await userEvent.type(within(form).getByLabelText(/对象（学管/), '王学管');
    const rateInput = within(form).getByLabelText(/目标比例（%）/) as HTMLInputElement;
    await userEvent.clear(rateInput);
    await userEvent.type(rateInput, '80');
    await userEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/bi/incentive-settings', expect.objectContaining({
        scope_value: '王学管',
        target_rate: 0.8, // 80/100
      }));
    });
  });

  it('编辑激励：表单回填 0.8 → 80', async () => {
    renderWithProviders(<BiSettings />);
    await switchTab('激励目标比例');
    await screen.findByText('李学管');
    await userEvent.click(screen.getByRole('button', { name: '编辑' }));
    const formTitle = screen.getByRole('heading', { name: '编辑激励目标' });
    const form = formTitle.parentElement!;
    const rateInput = within(form).getByLabelText(/目标比例（%）/) as HTMLInputElement;
    expect(rateInput.value).toBe('80');
  });
});

describe('BiSettings - 老师学生映射 tab', () => {
  it('展示映射列表 + 预存状态', async () => {
    renderWithProviders(<BiSettings />);
    await switchTab('老师-学生映射');
    expect(await screen.findByText('T001')).toBeInTheDocument();
    expect(screen.getByText('张老师')).toBeInTheDocument();
    expect(screen.getByText('是')).toBeInTheDocument(); // is_prepaid=1
  });

  it('新增映射 → POST /bi/teacher-students', async () => {
    post.mockResolvedValue({ row: {} });
    renderWithProviders(<BiSettings />);
    await switchTab('老师-学生映射');
    await userEvent.click(getOpenFormButton('新增映射'));
    const formTitle = screen.getByRole('heading', { name: '新增老师-学生映射' });
    const form = formTitle.parentElement!;
    await userEvent.type(within(form).getByLabelText(/老师工号/), 'T002');
    await userEvent.type(within(form).getByLabelText(/学生ID/), 'STU002');
    await userEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/bi/teacher-students', expect.objectContaining({
        teacher_no: 'T002', student_id: 'STU002',
      }));
    });
  });
});

describe('BiSettings - 学管学生映射 tab', () => {
  it('展示学管映射列表', async () => {
    renderWithProviders(<BiSettings />);
    await switchTab('学管-学生映射');
    expect(await screen.findByText('M001')).toBeInTheDocument();
    expect(screen.getByText('李学管')).toBeInTheDocument();
  });

  it('删除 → DELETE /bi/mentor-students/:id', async () => {
    del.mockResolvedValue({ message: '已删除' });
    renderWithProviders(<BiSettings />);
    await switchTab('学管-学生映射');
    await screen.findByText('M001');
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(del).toHaveBeenCalledWith('/bi/mentor-students/1');
    });
  });
});
