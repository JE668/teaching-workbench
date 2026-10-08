import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowUpList from './FollowUpList';
import { renderWithProviders, makeFollowUp } from '../test/test-utils';
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
const put = api.put as Mock;
const del = api.delete as Mock;

const page = (items: unknown[], pagination: Record<string, unknown> = {}) => ({
  followups: items,
  pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...pagination },
});

/** 确认弹窗容器（与行内"删除"图标按钮重名） */
function confirmDialog(): HTMLElement {
  return screen.getByText(/删除该条回访记录/).closest('div.relative') as HTMLElement;
}

/** 详情弹窗容器（同一课次文案在列表行里也会出现，需限定范围） */
function detailDialog(): HTMLElement {
  return screen.getByRole('heading', { name: '回访详情' }).closest('div.relative') as HTMLElement;
}

/**
 * 取分页文案。
 * 形如：第 <span>1</span> / 3 页 · 共 45 条 —— 数字被 span 包着，
 * 直接用 getByText(regex) 无法跨元素匹配，所以按整段 textContent 找。
 */
function paginationText(): string {
  const el = screen.getByText((_, node) => {
    if (!node || node.tagName !== 'P') return false;
    return /第\s*\d+\s*\/\s*\d+\s*页/.test(node.textContent || '');
  });
  return el.textContent || '';
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
});

describe('回访历史 · 加载与渲染', () => {
  it('渲染记录与总数', async () => {
    get.mockResolvedValue(page([makeFollowUp({ topic: '分数加减法运算' })]));

    renderWithProviders(<FollowUpList />);

    expect(await screen.findByText('分数加减法运算')).toBeInTheDocument();
    expect(screen.getByText('共 1 条回访记录')).toBeInTheDocument();
    // 掌握程度以中文标签展示
    expect(screen.getByText('良好')).toBeInTheDocument();
  });

  it('无记录时显示空状态', async () => {
    get.mockResolvedValue(page([]));

    renderWithProviders(<FollowUpList />);

    expect(await screen.findByText('暂无回访记录')).toBeInTheDocument();
  });

  it('字数不在区间时用不同颜色提示', async () => {
    get.mockResolvedValue(page([makeFollowUp({ wordCount: 20 })]));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    const badge = screen.getByText('20 字');
    expect(badge.querySelector('span')?.className).toMatch(/amber/);
  });
});

describe('回访历史 · 课次展示', () => {
  it('多次课时显示课次徽章，单次课不显示', async () => {
    get.mockResolvedValue(
      page([
        makeFollowUp({ id: 1, sessionCount: 3, topic: '三次课合集' }),
        makeFollowUp({ id: 2, sessionCount: 1, topic: '单次课' }),
      ])
    );

    renderWithProviders(<FollowUpList />);
    await screen.findByText('三次课合集');

    // 只有多课次记录带徽章；单次课不显示
    expect(screen.getAllByText('3 次课').length).toBeGreaterThan(0);
    expect(screen.queryByText('1 次课')).not.toBeInTheDocument();
  });

  it('详情弹窗标注涵盖课次', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp({ sessionCount: 3 })]));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByTitle('查看详情'));

    const modal = detailDialog();
    expect(within(modal).getByText('涵盖课次')).toBeInTheDocument();
    expect(within(modal).getByText('3 次课')).toBeInTheDocument();
  });

  it('编辑弹窗可修改课次数并提交', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp({ id: 4, sessionCount: 1, topic: '待改课次' })]));
    put.mockResolvedValue({ followup: makeFollowUp({ id: 4, sessionCount: 3, topic: '待改课次' }) });

    renderWithProviders(<FollowUpList />);
    await screen.findByText('待改课次');

    await user.click(screen.getByTitle('编辑'));
    await user.click(screen.getByRole('button', { name: '3 次课' }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/followups/4', expect.objectContaining({ sessionCount: 3 }));
    });
  });
});

describe('回访历史 · 筛选', () => {
  it('切换学科时带上查询参数并重置到第一页', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp()]));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    get.mockClear();
    await user.selectOptions(screen.getByDisplayValue('全部学科'), '英语');

    await waitFor(() => {
      const url = get.mock.calls[get.mock.calls.length - 1][0] as string;
      expect(url).toContain('page=1');
      expect(url).toContain('subject=' + encodeURIComponent('英语'));
    });
  });
});

describe('回访历史 · 分页', () => {
  it('仅一页时不显示分页控件', async () => {
    get.mockResolvedValue(page([makeFollowUp()], { totalPages: 1 }));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument();
  });

  it('多页时可翻页且按钮在边界禁用', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp()], { page: 1, total: 45, totalPages: 3 }));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    expect(paginationText()).toMatch(/第\s*1\s*\/\s*3\s*页/);
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();

    get.mockResolvedValue(page([makeFollowUp({ topic: '第二页课程' })], { page: 2, total: 45, totalPages: 3 }));
    await user.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => {
      expect(get.mock.calls[get.mock.calls.length - 1][0]).toContain('page=2');
    });
    expect(await screen.findByText('第二页课程')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
  });
});

describe('回访历史 · 详情', () => {
  it('可打开详情并查看完整内容', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp()]));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByTitle('查看详情'));

    expect(screen.getByRole('heading', { name: '回访详情' })).toBeInTheDocument();
    // 详情里展示三段式正文
    expect(screen.getAllByText(/【课后任务】/).length).toBeGreaterThan(0);
  });
});

describe('回访历史 · 编辑', () => {
  it('打开编辑弹窗并预填课程主题与内容', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp({ topic: '原始主题' })]));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('原始主题');

    await user.click(screen.getByTitle('编辑'));

    expect(screen.getByRole('heading', { name: '编辑回访' })).toBeInTheDocument();
    expect(screen.getByLabelText(/课程主题/)).toHaveValue('原始主题');

    const contentBox = screen.getByLabelText(/回访内容/) as HTMLTextAreaElement;
    expect(contentBox.value).toContain('【课堂内容】');
    expect(contentBox.value).toContain('【课后任务】');
  });

  it('保存修改调用 PUT 并更新列表', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp({ id: 7, topic: '原始主题' })]));
    put.mockResolvedValue({ followup: makeFollowUp({ id: 7, topic: '改后主题' }) });

    renderWithProviders(<FollowUpList />);
    await screen.findByText('原始主题');

    await user.click(screen.getByTitle('编辑'));
    await user.clear(screen.getByLabelText(/课程主题/));
    await user.type(screen.getByLabelText(/课程主题/), '改后主题');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/followups/7', expect.objectContaining({ topic: '改后主题' }));
    });
    expect(await screen.findByText(/回访内容已更新/)).toBeInTheDocument();
    expect(await screen.findByText('改后主题')).toBeInTheDocument();
  });

  it('主题或内容为空时拒绝提交', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp({ topic: '原始主题' })]));

    renderWithProviders(<FollowUpList />);
    await screen.findByText('原始主题');

    await user.click(screen.getByTitle('编辑'));
    await user.clear(screen.getByLabelText(/课程主题/));
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('课程主题与回访内容不能为空')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('回访历史 · 删除', () => {
  it('二次确认后调用删除接口', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp({ id: 9, studentName: '李小明' })]));
    del.mockResolvedValue({ success: true });

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByTitle('删除'));
    expect(del).not.toHaveBeenCalled();

    await user.click(within(confirmDialog()).getByRole('button', { name: '删除' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/followups/9'));
    expect(await screen.findByText(/已删除该条回访记录/)).toBeInTheDocument();
  });
});

describe('回访历史 · 复制', () => {
  it('复制成功给出提示', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(page([makeFollowUp()]));

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    renderWithProviders(<FollowUpList />);
    await screen.findByText('分数加减法运算');

    await user.click(screen.getByTitle('复制内容'));

    expect(await screen.findByText('已复制回访内容')).toBeInTheDocument();
  });
});
