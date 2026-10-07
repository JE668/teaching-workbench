import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MASTERY_LEVELS } from '../types/index';

interface FollowUpRecord {
  id: number;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  images: string[];
  content: string;
  wordCount: number;
  createdAt: string;
}

interface StudentInfo {
  id: number;
  name: string;
  grade: string;
  subject: string;
  phone?: string;
  notes?: string;
  createdAt: string;
}

interface ProfileData {
  student: StudentInfo;
  followups: FollowUpRecord[];
  stats: {
    totalFollowups: number;
    subjects: string[];
    grades: string[];
  };
}

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (id) {
      loadProfile();
    }
  }, [id]);

  const loadProfile = async () => {
    try {
      const res = await api.get('/students/' + id + '/profile');
      setData(res);
    } catch (err) {
      console.error('加载档案失败', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (followupId: number) => {
    setExpandedId(expandedId === followupId ? null : followupId);
  };

  const getMasteryLabel = (value: string) => {
    return MASTERY_LEVELS.find((m) => m.value === value)?.label || value;
  };

  const getMasteryColor = (value: string) => {
    switch (value) {
      case 'excellent': return 'bg-green-50 text-green-600 border-green-200';
      case 'good': return 'bg-blue-50 text-blue-600 border-blue-200';
      case 'average': return 'bg-yellow-50 text-yellow-600 border-yellow-200';
      case 'needs_improvement': return 'bg-red-50 text-red-600 border-red-200';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin text-2xl text-indigo-500">加载中...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">学生档案不存在</p>
        <Link to="/students" className="text-indigo-600 hover:underline mt-2 inline-block">
          返回学生列表
        </Link>
      </div>
    );
  }

  const { student, followups, stats } = data;

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/students')}
            className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm hover:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{student.name} 的档案</h1>
            <p className="text-gray-500 text-sm">
              {student.grade} · {student.subject}
              {student.phone && ' · ' + student.phone}
            </p>
          </div>
        </div>
        <Link
          to={'/followups?studentId=' + student.id}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建回访
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm text-center">
          <p className="text-3xl font-bold text-indigo-600">{stats.totalFollowups}</p>
          <p className="text-sm text-gray-500 mt-1">回访次数</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm text-center">
          <p className="text-3xl font-bold text-purple-600">{stats.subjects.length}</p>
          <p className="text-sm text-gray-500 mt-1">涉及学科</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm text-center">
          <p className="text-3xl font-bold text-green-600">
            {followups.length > 0 ? Math.round(followups.reduce((acc, f) => acc + (f.wordCount || 0), 0) / followups.length) : 0}
          </p>
          <p className="text-sm text-gray-500 mt-1">平均字数</p>
        </div>
      </div>

      {/* Student Notes */}
      {student.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-xs font-medium text-amber-700 mb-1">学生备注</p>
          <p className="text-sm text-amber-800">{student.notes}</p>
        </div>
      )}

      {/* Follow-up Timeline */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">回访记录时间线</h2>
          <p className="text-xs text-gray-400 mt-1">每次回访的图片与AI内容自动归档</p>
        </div>

        {followups.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>暂无回访记录</p>
            <Link to={'/followups?studentId=' + student.id} className="mt-2 inline-block text-indigo-600 hover:underline">
              创建第一条回访
            </Link>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[24px] top-0 bottom-0 w-0.5 bg-gray-200"></div>
            
            {followups.map((followup, index) => {
              const isExpanded = expandedId === followup.id;
              return (
                <div key={followup.id} className="relative pl-14 py-5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  {/* Timeline dot */}
                  <div className="absolute left-[18px] top-6 w-3 h-3 bg-indigo-500 rounded-full ring-4 ring-white z-10"></div>
                  
                  <div
                    className="cursor-pointer"
                    onClick={() => toggleExpand(followup.id)}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800 text-sm">
                          {followup.topic}
                        </span>
                        <span className={'px-2 py-0.5 rounded text-xs border ' + getMasteryColor(followup.mastery)}>
                          {getMasteryLabel(followup.mastery)}
                        </span>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                          {followup.subject}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {followup.createdAt?.split(' ')[0]}
                      </span>
                    </div>

                    {/* Performance */}
                    <p className="text-sm text-gray-600 mb-2">
                      <span className="text-gray-400">课堂表现：</span>{followup.performance}
                    </p>

                    {/* Images preview */}
                    {followup.images && followup.images.length > 0 && (
                      <div className="flex gap-2 mb-3">
                        {followup.images.slice(0, 4).map((img, i) => (
                          <img
                            key={i}
                            src={'/uploads/' + img}
                            alt={'图片' + (i + 1)}
                            className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:ring-2 hover:ring-indigo-400 transition-all"
                          />
                        ))}
                        {followup.images.length > 4 && (
                          <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-500">
                            +{followup.images.length - 4}
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Content preview */}
                    <div className="text-sm text-gray-700">
                      <p className="mb-1">
                        <span className="text-xs font-medium text-gray-400">AI内容：</span>
                        {isExpanded
                          ? <span className="whitespace-pre-wrap leading-relaxed">{followup.content}</span>
                          : <span className="text-gray-500">{followup.content?.substring(0, 100)}{followup.content?.length > 100 ? '...' : ''}</span>
                        }
                      </p>
                    </div>

                    {/* Expand toggle */}
                    <button
                      className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                    >
                      {isExpanded ? (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                          收起
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 15l-7-7-7 7" />
                          </svg>
                          展开全文
                        </>
                      )}
                    </button>

                    {/* Meta */}
                    <p className="text-xs text-gray-400 mt-2">
                      {followup.wordCount}字 · {followup.images?.length || 0}张图片 · {index === 0 ? '最近' : (index + 1) + '次回访'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
