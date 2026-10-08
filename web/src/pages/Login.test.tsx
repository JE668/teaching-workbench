import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import { renderWithProviders } from '../test/test-utils';

const login = vi.fn();
const register = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login,
    register,
    logout: vi.fn(),
    isAuthenticated: false,
    user: null,
  }),
}));

/** 登录页里的提交按钮（顶部还有个"登录"标签页，故按 type 定位） */
function submitButton(): HTMLElement {
  return document.querySelector('form button[type="submit"]') as HTMLElement;
}

/**
 * 只在表单内查找错误文案。
 * 注意：错误同时会以 Toast 形式出现，全局查询会命中多个元素。
 */
function formError(text: string | RegExp) {
  const form = document.querySelector('form') as HTMLElement;
  return within(form).queryByText(text);
}

beforeEach(() => {
  login.mockReset();
  register.mockReset();
});

describe('登录页 · 登录', () => {
  it('提交正确凭据调用 login', async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(undefined);

    renderWithProviders(<Login />);
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/密码/), 'secret123');
    await user.click(submitButton());

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin', 'secret123'));
  });

  it('登录失败展示错误信息', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new Error('用户名或密码错误'));

    renderWithProviders(<Login />);
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/密码/), 'wrong');
    await user.click(submitButton());

    await waitFor(() => expect(formError('用户名或密码错误')).toBeInTheDocument());
  });
});

describe('登录页 · 注册校验', () => {
  async function switchToRegister(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: '注册' }));
  }

  it('两次密码不一致时阻止提交', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Login />);

    await switchToRegister(user);
    await user.type(screen.getByLabelText(/用户名/), 'newuser');
    await user.type(screen.getByLabelText(/^密码/), 'secret123');
    await user.type(screen.getByLabelText(/确认密码/), 'different');
    await user.click(submitButton());

    await waitFor(() => expect(formError('两次密码输入不一致')).toBeInTheDocument());
    expect(register).not.toHaveBeenCalled();
  });

  it('密码短于 6 位时阻止提交', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Login />);

    await switchToRegister(user);
    await user.type(screen.getByLabelText(/用户名/), 'newuser');
    await user.type(screen.getByLabelText(/^密码/), '123');
    await user.type(screen.getByLabelText(/确认密码/), '123');
    await user.click(submitButton());

    await waitFor(() => expect(formError('密码长度至少6位')).toBeInTheDocument());
    expect(register).not.toHaveBeenCalled();
  });

  it('校验通过时调用 register', async () => {
    const user = userEvent.setup();
    register.mockResolvedValue(undefined);

    renderWithProviders(<Login />);
    await switchToRegister(user);
    await user.type(screen.getByLabelText(/用户名/), 'newuser');
    await user.type(screen.getByLabelText(/^密码/), 'secret123');
    await user.type(screen.getByLabelText(/确认密码/), 'secret123');
    await user.click(submitButton());

    await waitFor(() => expect(register).toHaveBeenCalledWith('newuser', 'secret123'));
  });

  it('切换模式会清空错误提示', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new Error('用户名或密码错误'));

    renderWithProviders(<Login />);
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/密码/), 'wrong');
    await user.click(submitButton());
    await waitFor(() => expect(formError('用户名或密码错误')).toBeInTheDocument());

    await switchToRegister(user);

    // 表单内错误应被清空（Toast 会按自己的生命周期自然消失，不在断言范围）
    expect(formError('用户名或密码错误')).not.toBeInTheDocument();
  });
});
