import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KnowledgeBase from './KnowledgeBase';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const get = api.get as Mock;
const post = api.post as Mock;
const deleteRequest = api.delete as Mock;

const STATS = {
  subject_group: '数学',
  total_chunks: 128,
  by_source_type: [{ source_type: 'followup', count: 128 }],
  latest_indexed: '2026-11-20 10:00:00',
  unique_students: 18,
};

const OWNER_GROUP = {
  id: 41,
  name: '分数教研组',
  subject_group: '数学',
  role: 'owner',
  member_count: 2,
  created_at: '2026-11-20 10:00:00',
  joined_at: '2026-11-20 10:00:00',
};

const GROUP_MEMBERS = [
  { user_id: 1, username: '王老师', role: 'owner', joined_at: '2026-11-20 10:00:00' },
  { user_id: 2, username: '李老师', role: 'member', joined_at: '2026-11-20 11:00:00' },
];

function mockGroupApi(group = OWNER_GROUP) {
  get.mockImplementation((path: string) => {
    if (path === '/knowledge/groups') return Promise.resolve({ groups: [group] });
    if (path === '/knowledge/groups/41/members') return Promise.resolve({ groupId: 41, members: GROUP_MEMBERS });
    if (path.startsWith('/knowledge/stats?')) return Promise.resolve(STATS);
    return Promise.resolve({});
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const SEARCH_RESULT = {
  id: 1,
  subject_group: '语文',
  source_type: 'report',
  source_id: 31,
  chunk_text: '先借助面积图理解分数单位，再比较通分前后的分子变化。',
  metadata_json: JSON.stringify({ student_id: 11, student_name: '李小明' }),
  similarity: 0.873,
  indexed_at: '2026-11-19 09:00:00',
};

beforeEach(() => {
  vi.restoreAllMocks();
  get.mockReset();
  post.mockReset();
  deleteRequest.mockReset();
  get.mockResolvedValue(STATS);
});

describe('教研组知识库', () => {
  it('按科组和 trim 后的关键词检索，并展示来源、学生和相似度', async () => {
    get.mockImplementation((path: string) => {
      if (path.startsWith('/knowledge/search?')) {
        return Promise.resolve({ results: [SEARCH_RESULT] });
      }
      return Promise.resolve(STATS);
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByText('128');

    await user.selectOptions(screen.getByLabelText('科组'), '语文');
    fireEvent.change(screen.getByLabelText('检索内容'), {
      target: { value: '  分数通分  ' },
    });
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText(SEARCH_RESULT.chunk_text)).toBeInTheDocument();
    expect(screen.getByText('月度报告')).toBeInTheDocument();
    expect(screen.getByText('#31')).toBeInTheDocument();
    expect(screen.getByText('李小明')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText(/检索于 .* · 科组 语文/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/knowledge/search?subjectGroup=%E8%AF%AD%E6%96%87&q=%E5%88%86%E6%95%B0%E9%80%9A%E5%88%86&limit=10'
    );
  });

  it('检索接口失败时展示错误和可恢复的空结果状态', async () => {
    get.mockImplementation((path: string) => {
      if (path.startsWith('/knowledge/search?')) {
        return Promise.reject(new Error('向量服务暂不可用'));
      }
      return Promise.resolve(STATS);
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByText('128');

    await user.type(screen.getByLabelText('检索内容'), '通分讲解');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText('向量服务暂不可用')).toBeInTheDocument();
    expect(
      screen.getByText('没有达到相似度阈值的片段。可以先点下方「增量索引」把最新内容入库。')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeEnabled();
    expect(get).toHaveBeenCalledWith(
      '/knowledge/search?subjectGroup=%E6%95%B0%E5%AD%A6&q=%E9%80%9A%E5%88%86%E8%AE%B2%E8%A7%A3&limit=10'
    );
  });

  it('按完整学生画像查找相似学生，拆分薄弱点并展示匹配片段', async () => {
    post.mockResolvedValue({
      similar: [
        {
          student_id: 22,
          student_name: '王小雨',
          subject_group: '数学',
          grade: '五年级',
          similarity: 0.764,
          matching_chunks: [
            {
              ...SEARCH_RESULT,
              id: 9,
              chunk_text: '先用画图建立分数概念，再让学生口述通分步骤。',
            },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByText('128');

    await user.type(screen.getByLabelText('学生 ID'), '12');
    await user.selectOptions(screen.getByLabelText('学习风格'), 'reading_writing');
    fireEvent.change(screen.getByLabelText('薄弱点（逗号分隔）'), {
      target: { value: '分数运算， 应用题建模, 单位换算' },
    });
    fireEvent.change(screen.getByLabelText('优势点（逗号分隔）'), {
      target: { value: '几何直观, 逻辑推理' },
    });
    await user.click(screen.getByRole('button', { name: '查找相似学生' }));

    expect(await screen.findByText('王小雨')).toBeInTheDocument();
    expect(screen.getByText('五年级')).toBeInTheDocument();
    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText('先用画图建立分数概念，再让学生口述通分步骤。')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/knowledge/similar-students', {
      subjectGroup: '数学',
      studentId: 12,
      studentProfile: {
        weak_points: ['分数运算', '应用题建模', '单位换算'],
        strong_points: ['几何直观', '逻辑推理'],
        learning_style: 'reading_writing',
      },
      limit: 5,
    });
  });

  it('按所选日期生成教研周报，结束日期覆盖到当天最后一刻', async () => {
    get.mockImplementation((path: string) => {
      if (path.startsWith('/knowledge/weekly-digest?')) {
        return Promise.resolve({
          digest: {
            subject_group: '数学',
            period: { start: '2026-11-01', end: '2026-11-20' },
            key_topics: ['分数意义与通分'],
            teacher_insights: ['先诊断错误类型，再选择讲解方式'],
            common_challenges: ['学生容易漏乘分子'],
            recommendations: ['下次课增加三分钟错题回访'],
          },
        });
      }
      return Promise.resolve(STATS);
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByText('128');

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-11-20' } });
    await user.click(screen.getByRole('button', { name: '生成周报' }));

    expect(await screen.findByText('分数意义与通分')).toBeInTheDocument();
    expect(screen.getByText('先诊断错误类型，再选择讲解方式')).toBeInTheDocument();
    expect(screen.getByText('学生容易漏乘分子')).toBeInTheDocument();
    expect(screen.getByText('下次课增加三分钟错题回访')).toBeInTheDocument();
    expect(screen.getByText('周报摘要已生成')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/knowledge/weekly-digest?subjectGroup=%E6%95%B0%E5%AD%A6&startDate=2026-11-01&endDate=2026-11-20%2023%3A59%3A59'
    );
  });
});

describe('教研组 owner 生命周期管理', () => {
  it('owner 加载实际成员，owner 行没有移除操作', async () => {
    mockGroupApi();
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByRole('option', { name: '共享：分数教研组（数学）' });
    await user.selectOptions(screen.getByLabelText('知识库范围'), '41');

    await user.click(screen.getByRole('button', { name: '查看成员' }));

    expect(await screen.findByText('李老师')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/knowledge/groups/41/members');
    const ownerRow = screen.getByText('王老师').closest('li');
    expect(ownerRow).not.toBeNull();
    expect(within(ownerRow as HTMLElement).getByText('owner 不可移除')).toBeInTheDocument();
    expect(within(ownerRow as HTMLElement).queryByRole('button', { name: /移除成员/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除成员 李老师' })).toBeInTheDocument();
  });

  it('普通 member 不显示管理操作，也不请求成员枚举', async () => {
    mockGroupApi({ ...OWNER_GROUP, name: '普通成员组', role: 'member' });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByRole('option', { name: '共享：普通成员组（数学）' });
    await user.selectOptions(screen.getByLabelText('知识库范围'), '41');

    expect(await screen.findByText(/共享范围：普通成员组/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '教研组管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看成员' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '轮换邀请码' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销邀请码' })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('/knowledge/groups/41/members');
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('轮换需确认并展示 loading，旧码失效提示与新码只显示一次', async () => {
    mockGroupApi();
    const rotation = createDeferred<unknown>();
    post.mockReturnValue(rotation.promise);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByRole('option', { name: '共享：分数教研组（数学）' });
    await user.selectOptions(screen.getByLabelText('知识库范围'), '41');

    await user.click(screen.getByRole('button', { name: '轮换邀请码' }));
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '轮换邀请码' }));
    expect(screen.getByRole('button', { name: '轮换中' })).toBeDisabled();
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('旧邀请码会立即失效'));

    await act(async () => {
      rotation.resolve({ group: OWNER_GROUP, joinCode: 'new-only-once-code', notice: 'one-time' });
      await rotation.promise;
    });

    expect(await screen.findByText('new-only-once-code')).toBeInTheDocument();
    expect(screen.getByText('新一次性邀请码（旧码已失效，仅本次显示）')).toBeInTheDocument();
    expect(screen.getByText(/旧邀请码已失效；新邀请码只可由一位新成员使用/)).toBeInTheDocument();
    expect(screen.getByText('邀请码已轮换；旧邀请码已失效，新邀请码仅本次显示')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/knowledge/groups/41/join-code/rotate', {});
    await user.click(screen.getByRole('button', { name: '关闭邀请码' }));
    expect(screen.queryByText('new-only-once-code')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('撤销异常响应不伪造成功，确认重试成功后才提示失效', async () => {
    mockGroupApi();
    const revocation = createDeferred<unknown>();
    deleteRequest.mockReturnValueOnce(revocation.promise).mockResolvedValueOnce({ group: OWNER_GROUP, revoked: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByRole('option', { name: '共享：分数教研组（数学）' });
    await user.selectOptions(screen.getByLabelText('知识库范围'), '41');

    await user.click(screen.getByRole('button', { name: '撤销邀请码' }));
    expect(screen.getByRole('button', { name: '撤销中' })).toBeDisabled();
    await act(async () => {
      revocation.resolve({});
      await revocation.promise;
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('撤销响应格式异常，未确认撤销成功');
    expect(screen.queryByText('邀请码已撤销，旧邀请码均已失效')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '撤销邀请码' }));
    expect(await screen.findByText('邀请码已撤销，旧邀请码均已失效')).toBeInTheDocument();
    expect(deleteRequest).toHaveBeenCalledTimes(2);
    expect(deleteRequest).toHaveBeenCalledWith('/knowledge/groups/41/join-code');
  });

  it('移除失败保留成员，确认后的成功响应才更新列表和人数', async () => {
    mockGroupApi();
    deleteRequest.mockRejectedValueOnce(new Error('移除成员失败，请重试'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByRole('option', { name: '共享：分数教研组（数学）' });
    await user.selectOptions(screen.getByLabelText('知识库范围'), '41');
    await user.click(screen.getByRole('button', { name: '查看成员' }));
    await screen.findByText('李老师');

    await user.click(screen.getByRole('button', { name: '移除成员 李老师' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('移除成员失败，请重试');
    expect(screen.getByText('李老师')).toBeInTheDocument();
    expect(screen.queryByText('已移除成员「李老师」')).not.toBeInTheDocument();

    const removal = createDeferred<unknown>();
    deleteRequest.mockReturnValueOnce(removal.promise);
    await user.click(screen.getByRole('button', { name: '移除成员 李老师' }));
    expect(screen.getByRole('button', { name: '移除中' })).toBeDisabled();
    await act(async () => {
      removal.resolve({ group: { ...OWNER_GROUP, member_count: 1 }, removedMemberId: 2 });
      await removal.promise;
    });

    await waitFor(() => expect(screen.queryByText('李老师')).not.toBeInTheDocument());
    expect(screen.getByText('王老师')).toBeInTheDocument();
    expect(screen.getByText('已移除成员「李老师」')).toBeInTheDocument();
    expect(screen.getByText(/共享范围：分数教研组/).parentElement?.textContent).toContain('1 名成员');
    expect(deleteRequest).toHaveBeenLastCalledWith('/knowledge/groups/41/members/2');
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('立即失去此共享范围的访问权限'));
  });
});
