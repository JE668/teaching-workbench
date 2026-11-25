import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Modal from './Modal';

function ControlledModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开弹窗
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <button type="button">弹窗操作</button>
      </Modal>
    </>
  );
}

describe('Modal 可访问性', () => {
  it('提供对话框语义并自动关联标题、描述和中文关闭按钮', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="编辑资料" description="更新基础信息">
        正文
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: '编辑资料' });
    const title = screen.getByRole('heading', { name: '编辑资料' });
    const description = screen.getByText('更新基础信息');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
    expect(title.id).not.toBe('');
    expect(description.id).not.toBe('');
    expect(screen.getByRole('button', { name: '关闭' })).toHaveAttribute('aria-label', '关闭');

    rerender(<Modal open onClose={() => {}}>正文</Modal>);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('打开后聚焦首个可交互控件', () => {
    render(
      <Modal open onClose={() => {}}>
        <input aria-label="不可用" disabled />
        <input aria-label="名称" />
        <button type="button">保存</button>
      </Modal>
    );

    expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus();
  });

  it('没有可交互控件时聚焦弹窗本体并拦住 Tab', async () => {
    const user = userEvent.setup();
    render(
      <Modal open onClose={() => {}}>
        <p>只读内容</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toHaveFocus();
  });

  it('Tab 和 Shift+Tab 在弹窗内循环且不会移到外部', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">外部操作</button>
        <Modal open onClose={() => {}} title="键盘测试">
          <button type="button">第一项</button>
          <button type="button">第二项</button>
        </Modal>
      </>
    );

    const closeButton = screen.getByRole('button', { name: '关闭' });
    const firstButton = screen.getByRole('button', { name: '第一项' });
    const lastButton = screen.getByRole('button', { name: '第二项' });

    expect(closeButton).toHaveFocus();
    await user.tab();
    expect(firstButton).toHaveFocus();
    await user.tab();
    expect(lastButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(firstButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeButton).toHaveFocus();
  });

  it('Escape 关闭弹窗并恢复打开前的焦点', async () => {
    const user = userEvent.setup();
    render(<ControlledModal />);

    const trigger = screen.getByRole('button', { name: '打开弹窗' });
    await user.click(trigger);
    expect(screen.getByRole('button', { name: '弹窗操作' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('关闭后将 body overflow 恢复为打开前的值', () => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'scroll';

    try {
      const { rerender } = render(
        <Modal open onClose={() => {}} title="滚动测试">
          正文
        </Modal>
      );
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <Modal open={false} onClose={() => {}} title="滚动测试">
          正文
        </Modal>
      );
      expect(document.body.style.overflow).toBe('scroll');
    } finally {
      document.body.style.overflow = originalOverflow;
    }
  });
});
