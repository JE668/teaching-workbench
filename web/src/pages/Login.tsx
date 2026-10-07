import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  User,
  Lock,
  Sparkles,
  ImageIcon,
  FileText,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';

const features = [
  { icon: Sparkles, title: 'AI 智能生成', desc: '基于 SenseNova 多模态大模型' },
  { icon: ImageIcon, title: '图片理解', desc: '粘贴作业、试卷，自动融入回访' },
  { icon: FileText, title: '规范三段式', desc: '课堂内容 · 学生收获 · 课后任务' },
  { icon: ShieldCheck, title: '档案归档', desc: '每次回访自动归入学生档案' },
];

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        if (password !== confirmPassword) throw new Error('两次密码输入不一致');
        if (password.length < 6) throw new Error('密码长度至少6位');
        await register(username, password);
        toast.success('注册成功，欢迎使用！');
      } else {
        await login(username, password);
        toast.success('登录成功');
      }
      navigate('/');
    } catch (err: any) {
      const msg = err.message || '操作失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (toRegister: boolean) => {
    setIsRegister(toRegister);
    setError('');
    setConfirmPassword('');
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* ===== 左侧品牌面板 ===== */}
      <div className="relative hidden w-[46%] overflow-hidden bg-gradient-to-br from-brand-700 via-violet-700 to-purple-800 lg:flex lg:flex-col">
        {/* 装饰光斑 */}
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-purple-400/20 blur-3xl" />
        <div className="absolute right-1/3 top-1/2 h-40 w-40 rounded-full bg-brand-300/20 blur-2xl" />

        <div className="relative z-10 flex flex-1 flex-col justify-between p-12">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <GraduationCap className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">教学工作台</h1>
              <p className="text-xs text-white/60">1对1教师服务系统</p>
            </div>
          </div>

          {/* 主标语 */}
          <div className="my-10">
            <h2 className="text-4xl font-bold leading-tight text-white">
              让每一次课后回访
              <br />
              <span className="bg-gradient-to-r from-amber-200 to-white bg-clip-text text-transparent">
                都专业而温暖
              </span>
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
              录入课堂信息，AI 自动生成规范的课后回访内容，图片与反馈同步归档到学生档案。
            </p>

            {/* 特性网格 */}
            <div className="mt-10 grid grid-cols-2 gap-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-white/15"
                >
                  <f.icon className="mb-2 h-5 w-5 text-amber-200" />
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-white/60">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-white/40">© 2026 教学服务工作台 · Powered by SenseNova</p>
        </div>
      </div>

      {/* ===== 右侧表单 ===== */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[400px] animate-fade-up">
          {/* 移动端 Logo */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 shadow-lift">
              <GraduationCap className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">教学工作台</h1>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-slate-800">
              {isRegister ? '创建账号' : '欢迎回来'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {isRegister ? '注册后即可开始管理学生与回访' : '登录以继续您的教学工作'}
            </p>
          </div>

          {/* 模式切换 */}
          <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
            {[
              { label: '登录', value: false },
              { label: '注册', value: true },
            ].map((tab) => (
              <button
                key={tab.label}
                onClick={() => switchMode(tab.value)}
                className={cn(
                  'flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200',
                  isRegister === tab.value
                    ? 'bg-white text-brand-700 shadow-soft'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="用户名"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              icon={<User className="h-4 w-4" />}
              autoComplete="username"
            />

            <Input
              label="密码"
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              icon={<Lock className="h-4 w-4" />}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />

            {isRegister && (
              <Input
                label="确认密码"
                required
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
                icon={<Lock className="h-4 w-4" />}
                autoComplete="new-password"
              />
            )}

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-100 animate-fade-in">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="gradient"
              size="lg"
              loading={loading}
              className="w-full"
              icon={!loading ? <ArrowRight className="h-4 w-4" /> : undefined}
            >
              {loading ? '处理中...' : isRegister ? '注册' : '登录'}
            </Button>
          </form>

          {/* 仅在开发环境提示默认账号，避免生产环境泄露默认凭据 */}
          {!isRegister && import.meta.env.DEV && (
            <div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-center ring-1 ring-slate-100">
              <p className="text-xs text-slate-400">
                开发环境默认账号
                <span className="ml-1.5 font-mono font-medium text-slate-600">admin / 123456</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
