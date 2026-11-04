import React, { Suspense, lazy, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import { onAppUpdated } from './lib/serviceWorker';
import Layout from './components/Layout';
import { CommandPalette } from './components/ui/CommandPalette';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import {
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  Copy,
  FilePlus2,
  GraduationCap,
  ListTodo,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  Users,
  Sparkles,
  Loader2,
  X,
  Eye,
  SettingsIcon,
  FileSpreadsheet,
  FileImage,
  CalendarDays,
  MessageSquareText,
  History,
  Save,
  ClipboardList,
  BookOpen,
  BarChart3,
} from 'lucide-react';

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
const AiMetrics = lazy(() => import('./pages/AiMetrics'));

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
          <Route path="ai-metrics" element={<AiMetrics />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/** 应用级快捷键与命令面板提供者 */
function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const toast = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 页面级动作（需要根据当前路由动态注册）
  const navigate = useNavigate();

  const shortcuts = useKeyboardShortcuts([
    {
      key: 'mod+k',
      description: '打开命令面板',
      group: '全局',
      onTrigger: () => setPaletteOpen(true),
    },
    {
      key: 'mod+s',
      description: '保存当前页面（视页面而定）',
      group: '全局',
      disableInInput: true,
      onTrigger: () => {
        // 触发当前页面的保存逻辑 - 通过自定义事件
        window.dispatchEvent(new CustomEvent('app:save'));
      },
    },
    {
      key: 'mod+enter',
      description: 'AI 生成/重新生成',
      group: '全局',
      disableInInput: true,
      onTrigger: () => {
        window.dispatchEvent(new CustomEvent('app:generate'));
      },
    },
    {
      key: 'g s',
      description: '跳转到学生列表',
      group: '导航',
      onTrigger: () => navigate('/students'),
    },
    {
      key: 'g r',
      description: '跳转到报告列表',
      group: '导航',
      onTrigger: () => navigate('/reports'),
    },
    {
      key: 'g f',
      description: '跳转到回访页',
      group: '导航',
      onTrigger: () => navigate('/followups'),
    },
    {
      key: 'g o',
      description: '跳转到听评课',
      group: '导航',
      onTrigger: () => navigate('/observations'),
    },
    {
      key: 'g c',
      description: '跳转到课程目录',
      group: '导航',
      onTrigger: () => navigate('/catalog'),
    },
    {
      key: 'g p',
      description: '跳转到设置',
      group: '导航',
      onTrigger: () => navigate('/settings'),
    },
  ]);

  // 命令面板条目
  const paletteItems = useMemo(() => [
    // 导航组
    { id: 'nav-students', label: '学生档案', description: '查看/管理所有学生', shortcut: 'G S', group: '导航', icon: <Users className="h-4 w-4" />, onSelect: () => navigate('/students'), keywords: ['学生', '档案', '名单'] },
    { id: 'nav-reports', label: '月度报告', description: '总结与规划列表', shortcut: 'G R', group: '导航', icon: <BookOpenCheck className="h-4 w-4" />, onSelect: () => navigate('/reports'), keywords: ['报告', '总结', '规划', '月度'] },
    { id: 'nav-followups', label: '课后回访', description: '撰写/生成回访', shortcut: 'G F', group: '导航', icon: <ClipboardList className="h-4 w-4" />, onSelect: () => navigate('/followups'), keywords: ['回访', '反馈', '家长'] },
    { id: 'nav-observations', label: '听评课', description: '课堂观察与评课', shortcut: 'G O', group: '导航', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate('/observations'), keywords: ['听课', '评课', '观察'] },
    { id: 'nav-catalog', label: '课程目录', description: '管理课程规划目录', shortcut: 'G C', group: '导航', icon: <BookOpen className="h-4 w-4" />, onSelect: () => navigate('/catalog'), keywords: ['目录', '课程', '规划'] },
    { id: 'nav-ai-metrics', label: 'AI 指标看板', description: '查看 AI 调用成本/性能/错误', shortcut: 'G M', group: '导航', icon: <BarChart3 className="h-4 w-4" />, onSelect: () => navigate('/ai-metrics'), keywords: ['AI', '指标', '成本', '性能', '错误'] },
    { id: 'nav-settings', label: '设置', description: 'AI 模型、偏好、密码', shortcut: 'G P', group: '导航', icon: <SettingsIcon className="h-4 w-4" />, onSelect: () => navigate('/settings'), keywords: ['设置', '配置', 'AI', '模型'] },

    // 动作组
    { id: 'action-new-report', label: '新建月度报告', description: '创建新的月份总结/规划', group: '动作', icon: <Plus className="h-4 w-4" />, onSelect: () => {
      // 触发报告页的新建模态框
      window.dispatchEvent(new CustomEvent('app:new-report'));
    }, keywords: ['新建', '创建', '报告', '月份'] },
    { id: 'action-new-followup', label: '新建回访', description: '开始写新的课后回访', group: '动作', icon: <MessageSquareText className="h-4 w-4" />, onSelect: () => {
      navigate('/followups');
    }, keywords: ['新建', '回访', '反馈'] },

    // 当前页面相关动作（根据路由动态显示）
    ...(location.pathname.startsWith('/reports') && !location.pathname.match(/\/reports\/\d+/) ? [
      { id: 'report-new', label: '新建月份报告', description: '为学生创建新的月份报告', group: '当前页', shortcut: 'N', icon: <FilePlus2 className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:new-report')), keywords: ['新建', '报告'] },
    ] : []),

    ...(location.pathname.match(/\/reports\/\d+/) ? [
      { id: 'report-ai-summary', label: 'AI 生成总结', description: '根据课程明细生成本月总结', group: '当前页', shortcut: '⌘Enter', icon: <Sparkles className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:ai-summary')), keywords: ['AI', '总结', '生成'] },
      { id: 'report-ai-plan', label: 'AI 生成规划', description: '根据上月总结生成本月规划', group: '当前页', shortcut: '⌘Shift+Enter', icon: <Sparkles className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:ai-plan')), keywords: ['AI', '规划', '生成'] },
      { id: 'report-import-last', label: '从上月导入', description: '把上月规划导入本月总结', group: '当前页', icon: <CalendarDays className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:import-last-month')), keywords: ['导入', '上月', '规划'] },
      { id: 'report-export-excel', label: '导出 Excel', description: '导出标准格式 Excel', group: '当前页', shortcut: '⌘E', icon: <FileSpreadsheet className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:export-excel')), keywords: ['导出', 'Excel', '下载'] },
      { id: 'report-export-card', label: '导出图片卡片', description: '生成分享卡片图片', group: '当前页', icon: <FileImage className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:export-card')), keywords: ['导出', '图片', '卡片', '分享'] },
    ] : []),

    ...(location.pathname === '/followups' ? [
      { id: 'followup-generate', label: 'AI 生成回访', description: '根据填写信息生成回访文案', group: '当前页', shortcut: '⌘Enter', icon: <Sparkles className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:generate')), keywords: ['生成', 'AI', '回访'] },
      { id: 'followup-save', label: '保存并归档', description: '保存回访到学生档案', group: '当前页', shortcut: '⌘S', icon: <Save className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:save')), keywords: ['保存', '归档'] },
      { id: 'followup-copy', label: '复制内容', description: '复制生成的回访文案', group: '当前页', shortcut: '⌘C', icon: <Copy className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:copy')), keywords: ['复制', '文案'] },
      { id: 'followup-apply-last', label: '带入上次内容', description: '把上次回访的主题/表现带入', group: '当前页', icon: <History className="h-4 w-4" />, onSelect: () => window.dispatchEvent(new CustomEvent('app:apply-last')), keywords: ['带入', '上次', '历史'] },
    ] : []),
  ], [location.pathname, navigate]);

  return (
    <>
      {children}
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <GlobalNotices />
          <ShortcutsProvider>
            <AppRoutes />
          </ShortcutsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
