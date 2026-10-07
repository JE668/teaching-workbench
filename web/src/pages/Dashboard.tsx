import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Student, FollowUp } from '../types/index';

export default function Dashboard() {
  const [students, setStudents] = useState<Student[]>([]);
  const [recentFollowups, setRecentFollowups] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [studentsRes, followupsRes] = await Promise.all([
        api.get('/students'),
        api.get('/followups'),
      ]);
      setStudents(studentsRes.students || []);
      setRecentFollowups((followupsRes.followups || []).slice(0, 5));
    } catch (err) {
      console.error('加载数据失败', err);
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    {
      label: '学生总数',
      value: students.length,
      color: 'bg-blue-500',
      icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z',
    },
    {
      label: '回访总数',
      value: recentFollowups.length >= 5 ? '5+' : recentFollowups.length,
      color: 'bg-green-500',
      icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    },
    {
      label: '覆盖学科',
      value: new Set(students.map((s) => s.subject)).size,
      color: 'bg-purple-500',
      icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    },
  ];

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin text-2xl text-indigo-500">加载中...</div></div>;
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">工作台</h1>
          <p className="text-gray-500 text-sm mt-1">欢迎回来，这是您的教学工作概览</p>
        </div>
        <Link
          to="/followups"
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建回访
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className={'w-12 h-12 rounded-xl flex items-center justify-center ' + stat.color}>
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{stat.value}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Recent Followups */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">近期回访</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentFollowups.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">暂无回访记录</div>
            ) : (
              recentFollowups.map((f) => (
                <div key={f.id} className="p-4 hover:bg-gray-50 cursor-pointer transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-800">{f.studentName}</span>
                    <span className="text-xs text-gray-400">{f.createdAt?.split(' ')[0]}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{f.subject}</span>
                    <span>{f.grade}</span>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{f.mastery}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Student Overview */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">学生概览</h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {students.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">暂无学生数据</div>
            ) : (
              students.slice(0, 8).map((s) => (
                <div key={s.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <span className="text-xs text-gray-400">{s.createdAt?.split(' ')[0]}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                    <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">{s.subject}</span>
                    <span>{s.grade}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
