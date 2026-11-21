import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ParentViewPushButton } from './ParentViewPushButton';

describe('ParentViewPushButton', () => {
  it('校验并提交 OpenID，成功后关闭弹窗', async () => {
    const onPush = vi.fn().mockResolvedValue(true);
    render(<ParentViewPushButton onPush={onPush} />);

    fireEvent.click(screen.getByRole('button', { name: '微信推送' }));
    fireEvent.click(screen.getByRole('button', { name: '生成并推送' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1–128 个字符');
    expect(onPush).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('家长公众号 OpenID'), { target: { value: '  parent-open-id  ' } });
    fireEvent.click(screen.getByRole('button', { name: '生成并推送' }));
    await waitFor(() => expect(onPush).toHaveBeenCalledWith('parent-open-id'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('生成失败时保留弹窗和输入，便于修正后重试', async () => {
    const onPush = vi.fn().mockResolvedValue(false);
    render(<ParentViewPushButton onPush={onPush} />);

    fireEvent.click(screen.getByRole('button', { name: '微信推送' }));
    fireEvent.change(screen.getByLabelText('家长公众号 OpenID'), { target: { value: 'parent-open-id' } });
    fireEvent.click(screen.getByRole('button', { name: '生成并推送' }));

    await waitFor(() => expect(onPush).toHaveBeenCalled());
    expect(screen.getByLabelText('家长公众号 OpenID')).toHaveValue('parent-open-id');
    expect(screen.getByRole('button', { name: '生成并推送' })).toBeInTheDocument();
  });

  it('未保存实体或正在生成时禁止打开推送弹窗', () => {
    const { rerender } = render(<ParentViewPushButton disabled onPush={vi.fn()} />);
    expect(screen.getByRole('button', { name: '微信推送' })).toBeDisabled();
    rerender(<ParentViewPushButton loading onPush={vi.fn()} />);
    expect(screen.getByRole('button', { name: '微信推送' })).toBeDisabled();
  });
});
