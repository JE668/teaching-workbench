import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KnowledgeBase from './KnowledgeBase';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const get = api.get as Mock;
const post = api.post as Mock;
const GROUP = {
  id: 41,
  name: '分数教研组',
  subject_group: '数学',
  role: 'member',
  member_count: 2,
  created_at: '2026-11-20 10:00:00',
  joined_at: '2026-11-20 10:00:00',
};
const STATS = {
  subject_group: '数学',
  total_chunks: 8,
  by_source_type: [{ source_type: 'followup', count: 8 }],
  latest_indexed: '2026-11-20 10:00:00',
  unique_students: 2,
};
const RESULT = {
  id: 7,
  subject_group: '数学',
  source_type: 'followup',
  source_id: 71,
  chunk_text: '先让学生用面积模型解释通分，再检查分子是否同步变化。',
  metadata_json: JSON.stringify({ student_id: 12, student_name: '李小明' }),
  similarity: 0.82,
  indexed_at: '2026-11-20 10:00:00',
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path === '/knowledge/groups') return Promise.resolve({ groups: [] });
    if (path.startsWith('/knowledge/stats?')) return Promise.resolve(STATS);
    return Promise.resolve({});
  });
});

describe('KnowledgeBase 显式群组与异常响应防御', () => {
  it('只在已加入组的共享请求携带数字 groupId，并明确标记共享范围', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/knowledge/groups') return Promise.resolve({ groups: [GROUP] });
      if (path.startsWith('/knowledge/stats?')) return Promise.resolve(STATS);
      if (path.startsWith('/knowledge/search?')) return Promise.resolve({ results: [RESULT] });
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await screen.findByRole('option', { name: '共享：分数教研组（数学）' });

    await user.selectOptions(screen.getByLabelText('知识库范围'), '41');
    expect(await screen.findByText(/共享范围：分数教研组/)).toBeInTheDocument();
    expect(screen.getByLabelText('科组')).toBeDisabled();
    expect(screen.getByRole('button', { name: '增量索引' })).toBeDisabled();
    await waitFor(() => expect(get).toHaveBeenCalledWith(
      '/knowledge/stats?subjectGroup=%E6%95%B0%E5%AD%A6&groupId=41'
    ));

    await user.type(screen.getByLabelText('检索内容'), '通分讲解');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText(RESULT.chunk_text)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/knowledge/search?subjectGroup=%E6%95%B0%E5%AD%A6&q=%E9%80%9A%E5%88%86%E8%AE%B2%E8%A7%A3&limit=10&groupId=41'
    );
    expect(screen.getByText(/共享组/)).toBeInTheDocument();
  });

  it('创建组后立即切换共享范围，邀请码只在创建响应中显示一次', async () => {
    post.mockResolvedValue({
      group: { ...GROUP, id: 42, name: '新语文组', subject_group: '语文', role: 'owner', member_count: 1 },
      joinCode: 'only-once-code',
      notice: 'one-time',
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/knowledge/groups'));
    expect(screen.queryByText('only-once-code')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('新教研组名称'), '新语文组');
    await user.selectOptions(screen.getByLabelText('新组科目'), '语文');
    await user.click(screen.getByRole('button', { name: '创建教研组' }));

    expect(post).toHaveBeenCalledWith('/knowledge/groups', { name: '新语文组', subjectGroup: '语文' });
    expect(await screen.findByText('only-once-code')).toBeInTheDocument();
    expect(screen.getByText('一次性邀请码（仅本次显示，请通过安全渠道发送）')).toBeInTheDocument();
    expect(screen.getByText(/共享范围：新语文组/)).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith(
      '/knowledge/stats?subjectGroup=%E8%AF%AD%E6%96%87&groupId=42'
    ));
  });

  it('可用一次性码加入组，重复成员响应也保持幂等切换', async () => {
    post.mockResolvedValue({ group: { ...GROUP, id: 43, name: '已加入小组' }, alreadyMember: true });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await user.type(screen.getByLabelText('一次性邀请码'), '  invite-code  ');
    await user.click(screen.getByRole('button', { name: '加入教研组' }));

    expect(post).toHaveBeenCalledWith('/knowledge/groups/join', { joinCode: 'invite-code' });
    expect(await screen.findByText(/共享范围：已加入小组/)).toBeInTheDocument();
    expect(screen.getByText('你已经是该组成员，已切换到共享范围')).toBeInTheDocument();
    expect(screen.getByLabelText('一次性邀请码')).toHaveValue('');
  });

  it('过滤坏搜索结果、空片段和非法 metadata，并容错统计字段', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/knowledge/groups') return Promise.resolve({ groups: [null, { id: 'bad' }, {}] });
      if (path.startsWith('/knowledge/stats?')) return Promise.resolve({
        subject_group: { bad: true },
        total_chunks: 'many',
        by_source_type: { bad: true },
        latest_indexed: { bad: true },
        unique_students: null,
      });
      if (path.startsWith('/knowledge/search?')) return Promise.resolve({
        results: [
          null,
          { ...RESULT, id: 8, chunk_text: '', metadata_json: 'not-json' },
          { ...RESULT, id: 'bad', chunk_text: '坏 id 不应显示' },
          { ...RESULT, id: 9, metadata_json: JSON.stringify({ student_name: { bad: true }, student_id: 'bad' }), similarity: {} },
        ],
      });
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    expect((await screen.findAllByText('0')).length).toBeGreaterThan(0);
    expect(screen.getByText('—')).toBeInTheDocument();

    await user.type(screen.getByLabelText('检索内容'), '异常响应');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText(RESULT.chunk_text)).toBeInTheDocument();
    expect(screen.queryByText('坏 id 不应显示')).not.toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '个人知识库（仅本人）' })).toBeInTheDocument();
  });

  it('非法周报不伪装成功，相似学生忽略空片段和异常记录', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/knowledge/groups') return Promise.resolve({ groups: [] });
      if (path.startsWith('/knowledge/stats?')) return Promise.resolve(STATS);
      if (path.startsWith('/knowledge/weekly-digest?')) return Promise.resolve({
        digest: { subject_group: '数学', key_topics: 'not-an-array' },
      });
      return Promise.resolve({});
    });
    post.mockResolvedValue({
      similar: [
        null,
        { student_id: 'bad', student_name: '坏学生', matching_chunks: [] },
        {
          student_id: 22,
          student_name: '王小雨',
          grade: '五年级',
          similarity: 0.76,
          matching_chunks: [
            { ...RESULT, id: 10, chunk_text: '' },
            null,
            { ...RESULT, id: 11, chunk_text: '有效匹配片段', metadata_json: 'bad-json' },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeBase />);
    await user.click(screen.getByRole('button', { name: '生成周报' }));
    expect(await screen.findByText('周报响应格式异常，未展示不完整结果')).toBeInTheDocument();
    expect(screen.queryByText('周报摘要已生成')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('学生 ID'), '12');
    await user.click(screen.getByRole('button', { name: '查找相似学生' }));
    expect(await screen.findByText('王小雨')).toBeInTheDocument();
    expect(screen.getByText('有效匹配片段')).toBeInTheDocument();
    expect(screen.queryByText('坏学生')).not.toBeInTheDocument();
  });
});
