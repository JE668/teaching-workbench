import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Student, GRADES, SUBJECTS } from '../types/index';

export default function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    grade: '小学一年级',
    subject: '数学',
    phone: '',
    notes: '',
  });

  useEffect(() => {
    loadStudents();
  }, []);

  useEffect(() => {
    if (searchKeyword) {
      searchStudents(searchKeyword);
    } else {
      loadStudents();
    }
  }, [searchKeyword]);

  const loadStudents = async () => {
    try {
      const res = await api.get('/students');
      setStudents(res.students || []);
    } catch (err) {
      console.error('加载学生失败', err);
    } finally {
      setLoading(false);
    }
  };

  const searchStudents = async (keyword: string) => {
    try {
      const res = await api.get('/students/search?keyword=' + encodeURIComponent(keyword));
      setStudents(res.students || []);
    } catch (err) {
      console.error('搜索学生失败', err);
    }
  };

  const openCreateModal = () => {
    setEditingStudent(null);
    setFormData({ name: '', grade: '小学一年级', subject: '数学', phone: '', notes: '' });
    setShowModal(true);
  };

  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setFormData({
      name: student.name,
      grade: student.grade,
      subject: student.subject,
      phone: student.phone || '',
      notes: student.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.grade || !formData.subject) {
      alert('请填写必填项');
      return;
    }

    setSaving(true);
    try {
      if (editingStudent) {
        const res = await api.put('/students/' + editingStudent.id, formData);
        setStudents((prev) => prev.map((s) => s.id === res.student.id ? res.student : s));
      } else {
        const res = await api.post('/students', formData);
        setStudents((prev) => [res.student, ...prev]);
      }
      setShowModal(false);
    } catch (err: any) {
      alert(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该学生吗？')) return;
    try {
      await api.delete('/students/' + id);
      setStudents((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin text-2xl text-indigo-500">加载中...</div></div>;
  }

  return (
    <div className="fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">学生管理</h1>
          <p className="text-gray-500 text-sm mt-1">共 {students.length} 名学生</p>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          添加学生
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <input
            type="text"
            placeholder="搜索学生姓名、学科、年级..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {students.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z" />
            </svg>
            <p>暂无学生数据</p>
            <button onClick={openCreateModal} className="mt-2 text-indigo-600 hover:underline">
              点击添加第一位学生
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">姓名</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">年级</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">学科</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">联系电话</th>
                  <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">备注</th>
                  <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-800">{student.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{student.grade}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">{student.subject}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{student.phone || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[200px] truncate">{student.notes || '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openEditModal(student)}
                        className="text-indigo-600 hover:text-indigo-800 text-sm mr-3"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(student.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg mx-4 shadow-xl fade-in">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">
                {editingStudent ? '编辑学生' : '添加学生'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入学生姓名"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    年级 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.grade}
                    onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {GRADES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    学科 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">联系电话</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入联系电话"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={3}
                  placeholder="其他备注信息"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
