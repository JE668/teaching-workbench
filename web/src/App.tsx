import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import { onAppUpdated } from './lib/serviceWorker';
import Layout from './components/Layout';

// 路由级按需加载：各页面独立分包，进入哪个页面才下载哪个。
// 首屏不再为「回访 + 听评课 + 看板」等用不到的代码付流量成本。
// 注：组件测试直接渲染页面（不经由这里），不受懒加载影响。
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Students = lazy(() => import('./pages/Students'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const FollowUp = lazy(() => import('./pages/FollowUp'));
const FollowUpList = lazy(() => import('./pages/FollowUpList'));
const Observations = lazy(() => import('./pages/Observations'));
const ObservationEdit = lazy(() => import('./pages/ObservationEdit'));
const ObservationStats = lazy(() => import('./pages/ObservationStats'));
const ObservationReplyBoard = lazy(() => import('./pages/ObservationReplyBoard'));
const Settings = lazy(() => import('./pages/Settings'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Reports = lazy(() => import('./pages/Reports'));
const ReportEdit = lazy(() => import('./pages/ReportEdit'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * 全局提示：检测到新版本已激活时提醒一次。
 * 不自动刷新 —— 编辑页有手动保存的输入，自动 reload 会丢掉未保存的内容。
 */
function GlobalNotices() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(
    () => onAppUpdated(() => toastRef.current.info('有新版本已就绪，刷新一下即可生效')),
    []
  );
  return null;
}

/** 路由分包加载中的占位：整屏居中，避免白屏误以为页面挂了 */
function LoadingFallback() {
  return (
    <div
      role="status"
      aria-label="页面加载中"
      className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" />
      <p className="text-sm text-slate-400">加载中…</p>
    </div>
  );
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="students" element={<Students />} />
          <Route path="students/:id" element={<StudentProfile />} />
          <Route path="followups" element={<FollowUp />} />
          <Route path="followups/history" element={<FollowUpList />} />
          <Route path="observations" element={<Observations />} />
          <Route path="observations/new" element={<ObservationEdit />} />
          <Route path="observations/stats" element={<ObservationStats />} />
          <Route path="observations/reply-board" element={<ObservationReplyBoard />} />
          <Route path="observations/:id" element={<ObservationEdit />} />
          <Route path="settings" element={<Settings />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/:id" element={<ReportEdit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <GlobalNotices />
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
