import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Students from './Students';
import { renderWithProviders, makeStudent } from '../test/test-utils';
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
const post = api.post as Mock;
const put = api.put as Mock;
const del = api.delete as Mock;

/** 找到确认弹窗容器，避免与行内"删除"图标按钮重名冲突 */
function confirmDialog(): HTMLElement {
  const title = screen.getByText(/删除学生「/);
  return title.closest('div.relative') as HTMLElement;
}

/**
 * 页头右上角的「添加学生」按钮。
 * 空状态里还有一个同名按钮，DOM 中页头在前，故取第一个。
 */
function headerAddButton(): HTMLElement {
  return screen.getAllByRole('button', { name: /添加学生/ })[0];
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe('学生管理 · 加载与渲染', () => {
  it('加载中显示骨架屏', () => {
    get.mockReturnValue(new Promise(() => {})); // 永不 resolve
    const { container } = renderWithProviders(<Students />);

    expect(screen.getByRole('heading', { name: '学生管理' })).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('渲染学生列表与统计', async () => {
    get.mockResolvedValue({
      students: [
        makeStudent({ id: 1, name: '李小明' }),
        makeStudent({ id: 2, name: '王思涵', subject: '英语', notes: null, phone: null }),
      ],
    });

    renderWithProviders(<Students />);

    expect(await screen.findByText('李小明')).toBeInTheDocument();
    expect(screen.getByText('王思涵')).toBeInTheDocument();
    expect(screen.getByText('共 2 名学生')).toBeInTheDocument();
    // 无备注/电话时显示占位符
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('无数据时显示空状态并提供入口', async () => {
    get.mockResolvedValue({ students: [] });

    renderWithProviders(<Students />);

    expect(await screen.findByText('还没有学生')).toBeInTheDocument();
    expect(screen.getByText('添加第一位学生，开始记录学习成长')).toBeInTheDocument();
  });

  it('加载失败给出 Toast 提示且不崩溃', async () => {
    get.mockRejectedValue(new Error('网络异常'));

    renderWithProviders(<Students />);

    expect(await screen.findByText(/加载学生失败：网络异常/)).toBeInTheDocument();
  });
});

describe('学生管理 · 搜索', () => {
  it('输入关键字后按防抖调用搜索接口', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [makeStudent()] });

    renderWithProviders(<Students />);
    await screen.findByText('李小明');

    get.mockClear();
    get.mockResolvedValue({ students: [makeStudent({ name: '搜索命中' })] });

    await user.type(screen.getByPlaceholderText('搜索姓名 / 学科 / 年级'), '王');

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/students/search?keyword=' + encodeURIComponent('王'));
    });
    expect(await screen.findByText('搜索命中')).toBeInTheDocument();
  });

  it('清空关键字后回到完整列表', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [makeStudent()] });

    renderWithProviders(<Students />);
    await screen.findByText('李小明');

    const input = screen.getByPlaceholderText('搜索姓名 / 学科 / 年级');
    get.mockClear();
    await user.type(input, '王');
    await user.clear(input);

    await waitFor(() => {
      // 最终应回落到 /students
      expect(get.mock.calls.some((c) => c[0] === '/students')).toBe(true);
    });
  });
});

describe('学生管理 · 新增', () => {
  it('打开弹窗、填写并提交', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [] });
    post.mockResolvedValue({ student: makeStudent({ id: 9, name: '新同学' }) });

    renderWithProviders(<Students />);
    await screen.findByText('还没有学生');

    await user.click(headerAddButton());
    expect(screen.getByRole('heading', { name: '添加学生' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/姓名/), '新同学');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/students',
        expect.objectContaining({ name: '新同学', grade: '小学一年级', subject: '数学' })
      );
    });

    expect(await screen.findByText(/学生添加成功/)).toBeInTheDocument();
    expect(await screen.findByText('新同学')).toBeInTheDocument();
  });

  it('姓名为空时不提交并提示', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [] });

    renderWithProviders(<Students />);
    await screen.findByText('还没有学生');

    await user.click(headerAddButton());
    await user.click(screen.getByRole('button', { name: '添加' }));

    expect(await screen.findByText('请填写学生姓名')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('学生管理 · 编辑', () => {
  it('打开编辑弹窗并预填原有信息', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [makeStudent({ name: '李小明', notes: '原有备注' })] });

    renderWithProviders(<Students />);
    await screen.findByText('李小明');

    await user.click(screen.getByTitle('编辑'));

    expect(screen.getByRole('heading', { name: '编辑学生' })).toBeInTheDocument();
    expect(screen.getByLabelText(/姓名/)).toHaveValue('李小明');
    expect(screen.getByLabelText(/备注/)).toHaveValue('原有备注');
  });

  it('保存修改调用 PUT 并更新列表', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [makeStudent({ id: 3, name: '李小明' })] });
    put.mockResolvedValue({ student: makeStudent({ id: 3, name: '李小明', grade: '小学六年级' }) });

    renderWithProviders(<Students />);
    await screen.findByText('李小明');

    await user.click(screen.getByTitle('编辑'));
    await user.selectOptions(screen.getByLabelText(/年级/), '小学六年级');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/students/3', expect.objectContaining({ grade: '小学六年级' }));
    });
    expect(await screen.findByText(/学生信息已更新/)).toBeInTheDocument();
    expect(await screen.findByText('小学六年级')).toBeInTheDocument();
  });
});

describe('学生管理 · 删除', () => {
  it('删除前必须二次确认', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [makeStudent({ id: 5, name: '待删除' })] });
    del.mockResolvedValue({ success: true });

    renderWithProviders(<Students />);
    await screen.findByText('待删除');

    await user.click(screen.getByTitle('删除'));

    // 出现确认弹窗，此时尚未调用接口
    expect(screen.getByText(/删除学生「待删除」/)).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();

    await user.click(within(confirmDialog()).getByRole('button', { name: '删除' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/students/5'));
    expect(await screen.findByText(/已删除学生「待删除」/)).toBeInTheDocument();
    expect(screen.queryByText('待删除')).not.toBeInTheDocument();
  });

  it('取消确认不会删除', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: [makeStudent({ id: 5, name: '不要删' })] });

    renderWithProviders(<Students />);
    await screen.findByText('不要删');

    await user.click(screen.getByTitle('删除'));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText('不要删')).toBeInTheDocument();
  });
});
