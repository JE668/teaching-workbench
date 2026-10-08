import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowUp from './FollowUp';
import { renderWithProviders } from '../test/test-utils';
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
const streamPost = api.streamPost as Mock;

const GENERATED =
  '【课堂内容】本节课重点讲解异分母分数加减法的通分原理与步骤，通过数轴与图形直观演示，帮助学生理解分数单位统一的数学本质，并结合生活情境设计练习。' +
  '【学生收获】李小明本节课专注度较高，能够主动举手回答问题，对通分方法的理解比较到位，独立完成基础题型时准确率良好，计算速度还有提升空间。' +
  '【课后任务】完成练习册第12页第1到8题，重点巩固通分步骤；每天用5分钟做10道口算，提升计算速度与准确率。';

/** 让 streamPost 立即以完整内容回调 onDone */
function stubStream(content = GENERATED) {
  streamPost.mockImplementation(async (_path: string, _body: any, handlers: any) => {
    handlers.onDone?.({ content, wordCount: 175, regenerated: false });
  });
}

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>, topic = '分数加减法运算') {
  await user.type(screen.getByLabelText(/学生姓名/), '李小明');
  await user.type(screen.getByLabelText(/课程主题|课程内容/), topic);
  await user.type(screen.getByLabelText(/课堂表现/), '专注度较高');
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  streamPost.mockReset();
  get.mockResolvedValue({ students: [] });
});

describe('课后回访 · 课次选择器', () => {
  it('默认选中 1 次课，且不显示阶段性提示', () => {
    renderWithProviders(<FollowUp />);

    for (const n of [1, 2, 3]) {
      expect(screen.getByRole('button', { name: n + ' 次课' })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/课程主题/)).toBeInTheDocument();
    expect(screen.queryByText(/作为一个阶段整体反馈/)).not.toBeInTheDocument();
  });

  it('选择 3 次课后出现阶段性提示，且主题标签随之变化', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '3 次课' }));

    expect(screen.getByText(/将把最近 3 次课作为一个阶段整体反馈/)).toBeInTheDocument();
    expect(screen.getByLabelText(/课程内容（这几次课）/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^课程主题$/)).not.toBeInTheDocument();
  });

  it('2 次课提示文案数字正确', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '2 次课' }));
    expect(screen.getByText(/将把最近 2 次课作为一个阶段整体反馈/)).toBeInTheDocument();
  });

  it('切回 1 次课提示消失', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '3 次课' }));
    expect(screen.getByText(/作为一个阶段整体反馈/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 次课' }));
    expect(screen.queryByText(/作为一个阶段整体反馈/)).not.toBeInTheDocument();
  });
});

describe('课后回访 · 课次数传递', () => {
  it('默认以 sessionCount=1 生成', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    const body = streamPost.mock.calls[0][1];
    expect(body.sessionCount).toBe(1);
  });

  it('选择 3 次课后以 sessionCount=3 生成', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '3 次课' }));
    await fillMinimalForm(user, '分数加减法、分数乘法、分数除法');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    const body = streamPost.mock.calls[0][1];
    expect(body.sessionCount).toBe(3);
    expect(body.topic).toBe('分数加减法、分数乘法、分数除法');
  });

  it('保存时同样带上课次数', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ followup: { id: 1 } });

    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '2 次课' }));
    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await screen.findByTestId('generated-content');
    await user.click(screen.getByRole('button', { name: /保存并归档到学生档案/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.sessionCount).toBe(2);
  });
});
