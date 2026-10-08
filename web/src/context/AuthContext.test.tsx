import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

/** 记录每次渲染时观察到的认证状态，用于验证"首帧"是否已认证 */
let observed: boolean[] = [];

function Probe() {
  const { isAuthenticated, user } = useAuth();
  observed.push(isAuthenticated);
  return (
    <div>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="username">{user?.username ?? 'none'}</span>
    </div>
  );
}

function renderWithProvider() {
  observed = [];
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

const USER = { id: 1, username: 'admin', createdAt: '2026-10-08 10:00:00' };
const TOKEN = 'header.payload.signature';

beforeEach(() => {
  localStorage.clear();
});

describe('AuthContext 登录态恢复', () => {
  it('无本地登录态时首帧即为未认证', () => {
    renderWithProvider();
    expect(screen.getByTestId('authed')).toHaveTextContent('false');
    expect(observed[0]).toBe(false);
  });

  /**
   * 回归测试：深链接被踢回首页
   *
   * 原实现在 useEffect 里异步恢复登录态，首帧 isAuthenticated=false，
   * 导致受保护路由把用户重定向到 /login，随后登录态恢复又弹回 /。
   * 表现为"刷新页面或直接访问子页面 URL 会被踢回工作台"。
   *
   * 因此必须断言【首帧】就已认证，而不只是最终状态。
   */
  it('有本地登录态时【首帧】即已认证（回归：深链接被重定向）', () => {
    localStorage.setItem('token', TOKEN);
    localStorage.setItem('user', JSON.stringify(USER));

    renderWithProvider();

    expect(observed[0]).toBe(true);
    expect(screen.getByTestId('authed')).toHaveTextContent('true');
    expect(screen.getByTestId('username')).toHaveTextContent('admin');
  });

  it('仅有 token 而无 user 时，仍视为已认证（用户名可能稍后补齐）', () => {
    localStorage.setItem('token', TOKEN);
    renderWithProvider();

    expect(observed[0]).toBe(true);
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });

  it('本地 user 数据损坏时不崩溃，且退化为未认证', () => {
    localStorage.setItem('token', TOKEN);
    localStorage.setItem('user', '{ 这不是合法 JSON');

    // 不应抛错
    expect(() => renderWithProvider()).not.toThrow();
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });
});

describe('AuthContext 登录/登出', () => {
  it('logout 清除本地存储并回到未认证', async () => {
    localStorage.setItem('token', TOKEN);
    localStorage.setItem('user', JSON.stringify(USER));

    let auth: ReturnType<typeof useAuth>;
    function Capture() {
      auth = useAuth();
      return <span data-testid="authed">{String(auth.isAuthenticated)}</span>;
    }

    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>
    );

    expect(screen.getByTestId('authed')).toHaveTextContent('true');

    await act(async () => {
      auth!.logout();
    });

    expect(screen.getByTestId('authed')).toHaveTextContent('false');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
