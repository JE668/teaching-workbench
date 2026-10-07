import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        if (password !== confirmPassword) {
          setError('两次密码输入不一致');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('密码长度至少6位');
          setLoading(false);
          return;
        }
        await register(username, password);
      } else {
        await login(username, password);
      }
      navigate('/');
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">教学工作台</h1>
          <p className="text-gray-500 text-sm mt-1">1对1教师服务管理平台</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex mb-6 border-b">
            <button
              onClick={() => setIsRegister(false)}
              className={'flex-1 py-3 text-sm font-medium border-b-2 transition-colors ' + (!isRegister ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400')}
            >
              登录
            </button>
            <button
              onClick={() => setIsRegister(true)}
              className={'flex-1 py-3 text-sm font-medium border-b-2 transition-colors ' + (isRegister ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400')}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="请输入用户名"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="请输入密码"
                required
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">确认密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  placeholder="请再次输入密码"
                  required
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '处理中...' : isRegister ? '注册' : '登录'}
            </button>
          </form>

          {!isRegister && (
            <p className="text-center text-xs text-gray-400 mt-4">
              默认管理员账号: admin / 123456
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
