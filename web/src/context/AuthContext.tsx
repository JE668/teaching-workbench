import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { User } from '../types/index';

/**
 * 同步读取本地登录态。
 * 关键：必须在首帧渲染前完成，否则受保护路由会因为 isAuthenticated 尚为 false
 * 而跳转到 /login，登录态随后恢复又弹回 /，表现为"刷新或直接访问子页面被踢回首页"。
 */
function readStoredToken(): string | null {
  const token = localStorage.getItem('token');
  if (token) {
    // 同步注入 api 客户端，确保紧接着的请求就带上 Authorization
    api.setToken(token);
  }
  return token;
}

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // 使用惰性初始值：仅在首次渲染时执行一次，且发生在渲染期间（早于任何副作用）
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [user, setUser] = useState<User | null>(readStoredUser);

  const toast = useToast();
  // 用 ref 持有最新 toast：注册回调只做一次，不因 toast 身份变化反复注册
  const toastRef = useRef(toast);
  toastRef.current = toast;

  /**
   * 全局「登录态失效」处理。
   *
   * 为什么需要：令牌可能因过期（7 天）或 JWT_SECRET 变更而失效。
   * 此时任何接口都返回 401，若不统一处理，用户看到的是
   * 「保存失败：认证令牌无效或已过期」这类无从下手的提示，
   * 页面还停在原地、数据看起来像坏了。
   *
   * 这里清掉本地登录态后，ProtectedRoute 会自动把用户送到登录页，
   * 并明确告知原因。
   */
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      toastRef.current.error('登录已过期，请重新登录');
    });
    return () => api.setUnauthorizedHandler(null);
  }, []);

  const login = async (username: string, password: string) => {
    const result = await api.post('/auth/login', { username, password });
    api.setToken(result.token);
    api.setUser(result.user);
    setToken(result.token);
    setUser(result.user);
  };

  const register = async (username: string, password: string) => {
    const result = await api.post('/auth/register', { username, password });
    api.setToken(result.token);
    api.setUser(result.user);
    setToken(result.token);
    setUser(result.user);
  };

  const logout = () => {
    // 通知服务端收回图片访问 cookie。
    // 不等待结果：登出必须立刻生效，不能因为网络问题卡住界面。
    // 共用设备上若不收回，登出后仍可直接打开图片 URL。
    api.post('/auth/logout', {}).catch(() => {});

    api.clearAuth();
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
