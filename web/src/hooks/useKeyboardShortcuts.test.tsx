import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function TestComponent({ onNavigate }: { onNavigate: () => void }) {
  useKeyboardShortcuts([
    {
      key: 'g f',
      description: '跳转到回访页',
      onTrigger: onNavigate,
    },
  ]);
  return <input aria-label="回访内容" ref={inputRef} />;
}

const inputRef = createRef<HTMLInputElement>();

describe('useKeyboardShortcuts', () => {
  it('输入框中的字母序列键不会触发导航', () => {
    const onNavigate = vi.fn();
    render(<TestComponent onNavigate={onNavigate} />);

    inputRef.current?.focus();
    fireEvent.keyDown(document, { key: 'g' });
    fireEvent.keyDown(document, { key: 'f' });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('页面空白处的字母序列键仍会触发导航', () => {
    const onNavigate = vi.fn();
    render(<TestComponent onNavigate={onNavigate} />);

    document.body.focus();
    fireEvent.keyDown(document, { key: 'g' });
    fireEvent.keyDown(document, { key: 'f' });

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
