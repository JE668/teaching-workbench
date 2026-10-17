import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { OfflineBanner } from './OfflineBanner';

/** jsdom 默认在线，这里按用例覆盖 navigator.onLine */
function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

describe('OfflineBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('在线时不渲染任何内容', () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/网络不可用/)).toBeNull();
  });

  it('离线时显示提示，并说明哪些操作会失败', () => {
    setOnline(false);
    render(<OfflineBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/网络不可用/);
    expect(banner).toHaveTextContent(/AI 生成/);
  });

  it('网络状态变化时实时显隐', () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    setOnline(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('status')).toBeInTheDocument();

    setOnline(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
