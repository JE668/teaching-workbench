import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { FollowUp, MASTERY_LEVELS } from '../types/index';

export default function FollowUpList() {
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ subject: '', grade: '' });
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUp | null>(null);

  useEffect(() => {
    loadFollowups();
  }, []);

  const loadFollowups = async () => {
    setLoading(true);
    try {
      let url = '/followups';
      const params: string[] = [];
      if (filter.subject) params.push('subject=' + encodeURIComponent(filter.subject));
      if (filter.grade) params.push('grade=' + encodeURIComponent(filter.grade));
      if (params.length > 0) url += '?' + params.join('&');

      const res = await api.get(url);
      setFollowups(res.followups || []);
    } catch (err) {
      console.error('加载回访失败', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该回访记录吗？')) return;
    try {
      await api.delete('/followups/' + id);
      setFollowups((prev) => prev.filter((f) => f.id !== id));
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  const getMasteryLabel = (value: string) => {
    return MASTERY_LEVELS.find((m) => m.value === value)?.label || value;
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin text-2xl text-indigo-500">加载中...</div></div>;
  }

  return (
    <div className="fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">回访历史</h1>
          <p className="text-gray-500 text-sm mt-1">共 {followups.length} 条回访记录</p>
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

      <div className="bg-white rounded-xl shadow-sm">
        <div className="p-4 border-b border-gray-100 flex items-center gap-4">
          <select
            value={filter.subject}
            onChange={(e) => { setFilter({ ...filter, subject: e.target.value }); loadFollowups(); }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">全部学科</option>
            <option value="语文">语文</option>
            <option value="数学">数学</option>
            <option value="英语">英语</option>
            <option value="物理">物理</option>
            <option value="化学">化学</option>
            <option value="生物">生物</option>
          </select>
          <select
            value={filter.grade}
            onChange={(e) => { setFilter({ ...filter, grade: e.target.value }); loadFollowups(); }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">全部年级</option>
            <option value="小学一年级">小学一年级</option>
            <option value="小学二年级">小学二年级</option>
            <option value="小学三年级">小学三年级</option>
            <option value="小学四年级">小学四年级</option>
            <option value="小学五年级">小学五年级</option>
            <option value="小学六年级">小学六年级</option>
            <option value="初一">初一</option>
            <option value="初二">初二</option>
            <option value="初三">初三</option>
            <option value="高一">高一</option>
            <option value="高二">高二</option>
            <option value="高三">高三</option>
          </select>
        </div>

        {followups.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>暂无回访记录</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {followups.map((followup) => (
              <div key={followup.id} className="p-5 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800">{followup.studentName}</h3>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{followup.subject}</span>
                      <span className="text-xs text-gray-500">{followup.grade}</span>
                      <span
                        className={'px-2 py-0.5 rounded text-xs ' +
                          (followup.mastery === 'excellent' ? 'bg-green-50 text-green-600' :
                           followup.mastery === 'good' ? 'bg-blue-50 text-blue-600' :
                           followup.mastery === 'average' ? 'bg-yellow-50 text-yellow-600' :
                           'bg-red-50 text-red-600')}
                      >
                        {getMasteryLabel(followup.mastery)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{followup.topic}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{followup.createdAt}</p>
                    <p className="text-xs text-gray-400">{followup.wordCount} 字</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => setSelectedFollowUp(followup)}
                    className="text-indigo-600 hover:text-indigo-800 text-sm"
                  >
                    查看详情
                  </button>
                  <button
                    onClick={() => handleDelete(followup.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedFollowUp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 shadow-xl fade-in max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">回访详情</h2>
              <button
                onClick={() => setSelectedFollowUp(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                x
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1">学生姓名</p>
                  <p className="font-medium text-gray-800">{selectedFollowUp.studentName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">课程主题</p>
                  <p className="font-medium text-gray-800">{selectedFollowUp.topic}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">年级</p>
                  <p className="font-medium text-gray-800">{selectedFollowUp.grade}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">学科</p>
                  <p className="font-medium text-gray-800">{selectedFollowUp.subject}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">掌握程度</p>
                  <p className="font-medium text-gray-800">{getMasteryLabel(selectedFollowUp.mastery)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">字数</p>
                  <p className="font-medium text-gray-800">{selectedFollowUp.wordCount} 字</p>
                </div>
              </div>

              {selectedFollowUp.performance && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">课堂表现</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selectedFollowUp.performance}</p>
                </div>
              )}

              <div>
                <p className="text-xs text-gray-400 mb-1">回访内容</p>
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-100">
                  {selectedFollowUp.content}
                </div>
              </div>

              {selectedFollowUp.images && selectedFollowUp.images.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">课堂图片</p>
                  <div className="grid grid-cols-4 gap-2">
                    {selectedFollowUp.images.map((img, i) => (
                      <img
                        key={i}
                        src={'/uploads/' + img}
                        alt={'图片 ' + (i + 1)}
                        className="w-full h-20 object-cover rounded-lg border border-gray-200"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-gray-400">
                创建时间: {selectedFollowUp.createdAt} | 更新时间: {selectedFollowUp.updatedAt}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
