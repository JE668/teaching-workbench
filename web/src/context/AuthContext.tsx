import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client';
import { User } from '../types/index';

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
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    api.setTokenFromStorage();
    if (api.getToken()) {
      setToken(api.getToken());
      setUser(api.getUser());
    }
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
