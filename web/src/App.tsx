import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import { onAppUpdated } from './lib/serviceWorker';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import StudentProfile from './pages/StudentProfile';
import FollowUp from './pages/FollowUp';
import FollowUpList from './pages/FollowUpList';
import Observations from './pages/Observations';
import ObservationEdit from './pages/ObservationEdit';
import ObservationStats from './pages/ObservationStats';
import ObservationReplyBoard from './pages/ObservationReplyBoard';
import Settings from './pages/Settings';

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

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
