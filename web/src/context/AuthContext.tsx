import React, { createContext, useContext, useState } from 'react';
import { api } from '../api/client';
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
