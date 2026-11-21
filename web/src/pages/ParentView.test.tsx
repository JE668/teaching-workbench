import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParentView from './ParentView';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: {
    request: vi.fn(),
    post: vi.fn(),
  },
}));

const request = api.request as Mock;
const post = api.post as Mock;

const payload = {
  studentName: '李小明',
  subject: '数学',
  sourceType: 'followup' as const,
  sourceId: 8,
  createdAt: '2026-11-01 10:00:00',
  viewData: {
    key_progress: ['能独立运用通分方法'],
    focus_areas: ['计算后主动检查'],
    action_for_parent: '每天陪同完成五分钟口算。',
    teacher_note: '保持主动提问的好习惯。',
  },
  readAt: null,
  parentFeedback: null,
};

function renderParentView() {
  return renderWithProviders(<ParentView />, {
    route: '/parent-view/public-token',
    path: '/parent-view/:token',
  });
}

beforeEach(() => {
  request.mockReset();
  post.mockReset();
  request.mockResolvedValue({ success: true, data: payload });
  post.mockResolvedValue({ success: true });
});

describe('家长公开视图', () => {
  it('展示老师整理的反馈并自动记录首次阅读', async () => {
    renderParentView();

    expect(await screen.findByRole('heading', { name: '李小明的学习反馈' })).toBeInTheDocument();
    expect(screen.getByText('能独立运用通分方法')).toBeInTheDocument();
    expect(screen.getByText('计算后主动检查')).toBeInTheDocument();
    expect(screen.getByText('每天陪同完成五分钟口算。')).toBeInTheDocument();
    expect(screen.getByText('保持主动提问的好习惯。')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/parent-view/public-token');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/parent-view/public-token/read', {}));
  });

  it('已读视图不重复上报阅读', async () => {
    request.mockResolvedValue({ success: true, data: { ...payload, readAt: '2026-11-02T08:00:00.000Z' } });
    renderParentView();

    expect(await screen.findByRole('heading', { name: '李小明的学习反馈' })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('提交留言后展示已提交状态', async () => {
    const user = userEvent.setup();
    renderParentView();
    const textarea = await screen.findByLabelText('反馈内容');

    await user.type(textarea, '孩子在家会主动复习，谢谢老师。');
    await user.click(screen.getByRole('button', { name: '提交反馈' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/parent-view/public-token/feedback', {
      feedback: '孩子在家会主动复习，谢谢老师。',
    }));
    expect(await screen.findByText('反馈已提交，老师可以在工作台查看')).toBeInTheDocument();
    expect(screen.getByText('孩子在家会主动复习，谢谢老师。')).toBeInTheDocument();
    expect(screen.queryByLabelText('反馈内容')).not.toBeInTheDocument();
  });

  it('无效或过期链接显示不可查看提示', async () => {
    request.mockRejectedValue(new Error('404 Not Found'));
    renderParentView();

    expect(await screen.findByRole('heading', { name: '暂时无法查看' })).toBeInTheDocument();
    expect(screen.getByText('链接不存在或已过期，请联系老师重新生成。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
  });
});
