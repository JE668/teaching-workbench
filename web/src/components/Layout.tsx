import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  MessageSquarePlus,
  History,
  LogOut,
  GraduationCap,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/', label: '工作台', icon: LayoutDashboard, end: true },
  { to: '/students', label: '学生管理', icon: Users },
  { to: '/followups', label: '课后回访', icon: MessageSquarePlus },
  { to: '/followups/history', label: '回访历史', icon: History },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initial = user?.username?.charAt(0).toUpperCase() || 'U';

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* ===== 侧边栏 ===== */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-slate-200/80 bg-white">
        {/* 品牌 */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-600 to-purple-600 shadow-lift">
            <GraduationCap className="h-6 w-6 text-white" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 ring-2 ring-white">
              <Sparkles className="h-2.5 w-2.5 text-white" />
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-bold tracking-tight text-slate-800">教学工作台</h1>
            <p className="truncate text-[11px] text-slate-400">1对1教师服务系统</p>
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            教学管理
          </p>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-gradient-to-r from-brand-50 to-violet-50 text-brand-700 shadow-sm'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-500 to-violet-600" />
                  )}
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-colors',
                      isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'
                    )}
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* AI 提示卡片 */}
        <div className="mx-3 mb-3 rounded-xl bg-gradient-to-br from-slate-50 to-brand-50/60 p-3 ring-1 ring-slate-100">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-brand-500" />
            SenseNova AI
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            回访内容由多模态大模型生成，支持图片理解
          </p>
        </div>

        {/* 用户区 */}
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-sm font-semibold text-white shadow-soft">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{user?.username || '用户'}</p>
              <p className="truncate text-[11px] text-slate-400">教师账号</p>
            </div>
            <button
              onClick={handleLogout}
              title="退出登录"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ===== 主内容 ===== */}
      <main className="ml-[248px] min-h-screen flex-1">
        <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
