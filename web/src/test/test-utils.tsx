import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';

interface Options {
  /** 初始路由 */
  route?: string;
  /** 需要匹配的路由模板（用于带 useParams 的页面，如 '/students/:id'） */
  path?: string;
}

/**
 * 渲染页面并注入所需上下文（Router + Toast）。
 * 页面里用到 useToast / Link / useNavigate / useParams，缺任何一个都会报错。
 */
export function renderWithProviders(ui: React.ReactElement, options: Options = {}) {
  const { route = '/', path } = options;

  return render(
    <ToastProvider>
      {/* 提前启用 v7 行为，消除控制台里的 future flag 警告 */}
      <MemoryRouter
        initialEntries={[route]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {path ? (
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        ) : (
          ui
        )}
      </MemoryRouter>
    </ToastProvider>
  );
}

/** 构造一条学生数据 */
export function makeStudent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: '李小明',
    grade: '小学五年级',
    subject: '数学',
    phone: '13900139000',
    notes: '计算能力较弱',
    createdAt: '2026-10-08 10:00:00',
    updatedAt: '2026-10-08 10:00:00',
    ...overrides,
  };
}

/** 构造一条回访数据（内容长度落在 150-500 区间内） */
export function makeFollowUp(overrides: Record<string, unknown> = {}) {
  const content =
    '【课堂内容】本节课重点讲解异分母分数加减法的通分原理与步骤，通过数轴与图形直观演示，帮助学生理解分数单位统一的数学本质，并结合生活情境设计练习。' +
    '【学生收获】李小明本节课专注度较高，能够主动举手回答问题，对通分方法的理解比较到位，独立完成基础题型时准确率良好，计算速度还有提升空间。' +
    '【课后任务】完成练习册第12页第1到8题，重点巩固通分步骤；每天用5分钟做10道口算，提升计算速度与准确率。';

  return {
    id: 1,
    studentId: 1,
    studentName: '李小明',
    grade: '小学五年级',
    subject: '数学',
    topic: '分数加减法运算',
    performance: '专注度较高，能主动回答问题',
    mastery: 'good',
    images: [],
    content,
    wordCount: 175,
    createdAt: '2026-10-08 10:00:00',
    updatedAt: '2026-10-08 10:00:00',
    ...overrides,
  };
}
