import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Button from './Button';
import Badge from './Badge';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import { Input, Select, Textarea } from './Field';
import { ToastProvider, useToast } from './Toast';

describe('Button', () => {
  it('渲染子元素并响应点击', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>保存</Button>);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading 时禁用并阻止点击', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>提交</Button>);

    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled 属性生效', () => {
    render(<Button disabled>不可用</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('variant 与 size 影响类名', () => {
    const { rerender } = render(<Button variant="gradient">A</Button>);
    expect(screen.getByRole('button').className).toMatch(/gradient/);

    rerender(<Button variant="danger" size="sm">A</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toMatch(/red-500/);
    expect(cls).toMatch(/h-8/);
  });
});

describe('Badge', () => {
  it('不同 tone 使用不同配色', () => {
    const { rerender } = render(<Badge tone="success">优秀</Badge>);
    expect(screen.getByText('优秀').className).toMatch(/emerald/);

    rerender(<Badge tone="danger">需加强</Badge>);
    expect(screen.getByText('需加强').className).toMatch(/red/);
  });
});

describe('Field 表单控件', () => {
  it('Input 渲染 label 与必填星号', () => {
    render(<Input label="学生姓名" required placeholder="请输入" />);
    expect(screen.getByText('学生姓名')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入')).toBeInTheDocument();
  });

  it('Input 默认 type 为 text', () => {
    render(<Input label="账号" />);
    expect(screen.getByLabelText(/账号/)).toHaveAttribute('type', 'text');
  });

  it('Input 触发 onChange', () => {
    const onChange = vi.fn();
    render(<Input label="主题" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/主题/), { target: { value: '分数' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('Textarea 与 Select 正常渲染选项', () => {
    render(
      <>
        <Textarea label="备注" placeholder="写点什么" />
        <Select
          label="年级"
          options={[
            { value: 'g1', label: '小学一年级' },
            { value: 'g2', label: '小学二年级' },
          ]}
          placeholder="请选择"
        />
      </>
    );

    expect(screen.getByPlaceholderText('写点什么')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '小学一年级' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '请选择' })).toBeInTheDocument();
  });
});

describe('Modal', () => {
  it('open=false 时不渲染内容', () => {
    render(<Modal open={false} onClose={() => {}} title="标题">内容</Modal>);
    expect(screen.queryByText('标题')).not.toBeInTheDocument();
  });

  it('open=true 时渲染标题与内容', () => {
    render(<Modal open onClose={() => {}} title="编辑回访" description="说明">正文</Modal>);
    expect(screen.getByText('编辑回访')).toBeInTheDocument();
    expect(screen.getByText('正文')).toBeInTheDocument();
  });

  it('按 Escape 触发 onClose', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="标题">正文</Modal>);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('点击遮罩触发 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<Modal open onClose={onClose} title="标题">正文</Modal>);

    const backdrop = container.querySelector('.backdrop-blur-sm');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('打开时锁定 body 滚动，关闭后恢复', () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="t">x</Modal>);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Modal open={false} onClose={() => {}} title="t">x</Modal>);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('ConfirmDialog', () => {
  it('确认与取消分别回调', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="删除学生？" confirmText="删除" onConfirm={onConfirm} onCancel={onCancel} />
    );

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onConfirm).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('EmptyState', () => {
  it('渲染标题、描述与操作', () => {
    render(
      <EmptyState title="暂无学生" description="先添加一位吧" action={<button>添加</button>} />
    );

    expect(screen.getByText('暂无学生')).toBeInTheDocument();
    expect(screen.getByText('先添加一位吧')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument();
  });
});

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function Trigger() {
    const toast = useToast();
    return (
      <div>
        <button onClick={() => toast.success('保存成功')}>成功</button>
        <button onClick={() => toast.error('保存失败')}>失败</button>
      </div>
    );
  }

  it('success 与 error 各自展示消息', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: '成功' }));
    expect(screen.getByText('保存成功')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    expect(screen.getByText('保存失败')).toBeInTheDocument();
  });

  it('到时间后自动消失', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: '成功' }));
    expect(screen.getByText('保存成功')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText('保存成功')).not.toBeInTheDocument();
  });

  it('可以手动关闭', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: '成功' }));
    const toastEl = screen.getByText('保存成功').closest('div')!;
    const closeBtn = toastEl.querySelector('button')!;

    fireEvent.click(closeBtn);
    expect(screen.queryByText('保存成功')).not.toBeInTheDocument();
  });
});
