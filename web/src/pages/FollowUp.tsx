import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { Student, GRADES, SUBJECTS, MASTERY_LEVELS } from '../types/index';

export default function FollowUp() {
  // 学生列表
  const [students, setStudents] = useState<Student[]>([]);

  // 表单数据
  const [formData, setFormData] = useState({
    studentId: null as number | null,
    studentName: '',
    grade: '小学三年级',
    subject: '数学',
    topic: '',
    performance: '',
    mastery: 'good',
  });

  // 图片
  const [images, setImages] = useState<string[]>([]); // 图片URL路径
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // AI生成
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [contentEditable, setContentEditable] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [wordCount, setWordCount] = useState(0);

  // 保存
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStudents();
  }, []);

  useEffect(() => {
    if (formData.studentId) {
      const student = students.find((s) => s.id === formData.studentId);
      if (student) {
        setFormData((prev) => ({
          ...prev,
          studentName: student.name,
          grade: student.grade,
          subject: student.subject,
        }));
      }
    }
  }, [formData.studentId, students]);

  const loadStudents = async () => {
    try {
      const res = await api.get('/students');
      setStudents(res.students || []);
    } catch (err) {
      console.error('加载学生失败', err);
    }
  };

  const handleImagePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadImage(file);
        }
      }
    }
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer?.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) {
          uploadImage(files[i]);
        }
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) {
          uploadImage(files[i]);
        }
      }
    }
    // Reset input
    e.target.value = '';
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('images', file);

      const res = await api.upload('/upload', formData);
      if (res.paths) {
        setImages((prev) => [...prev, ...res.paths]);
      }
    } catch (err: any) {
      alert('图片上传失败: ' + (err.message || '未知错误'));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const generateContent = async () => {
    if (!formData.studentName || !formData.topic || !formData.performance) {
      alert('请填写学生姓名、课程主题和课堂表现');
      return;
    }

    setGenerating(true);
    setSaved(false);

    try {
      const res = await api.post('/followups/generate', {
        studentName: formData.studentName,
        grade: formData.grade,
        subject: formData.subject,
        topic: formData.topic,
        performance: formData.performance,
        mastery: formData.mastery,
        images: images,
      });

      setGeneratedContent(res.content);
      setWordCount(res.wordCount);
      setEditContent(res.content);
    } catch (err: any) {
      alert('AI生成失败: ' + (err.message || '请检查SenseNova API Key是否配置'));
    } finally {
      setGenerating(false);
    }
  };

  const saveFollowUp = async () => {
    if (!generatedContent) {
      alert('请先生成回访内容');
      return;
    }

    const finalContent = contentEditable ? editContent : generatedContent;

    setSaving(true);
    try {
      const res = await api.post('/followups', {
        studentId: formData.studentId,
        studentName: formData.studentName,
        grade: formData.grade,
        subject: formData.subject,
        topic: formData.topic,
        performance: formData.performance,
        mastery: formData.mastery,
        images: images,
        content: finalContent,
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      alert('保存失败: ' + (err.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const calculateWordCount = (text: string) => {
    return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
  };

  const handleEditContent = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setEditContent(newContent);
    setWordCount(calculateWordCount(newContent));
    setContentEditable(true);
  };

  const masteryLabel = MASTERY_LEVELS.find((m) => m.value === formData.mastery)?.label || formData.mastery;

  const isWordCountValid = wordCount >= 150 && wordCount <= 500;

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">课后回访</h1>
          <p className="text-gray-500 text-sm mt-1">填写课堂信息，AI辅助生成回访内容</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Form */}
        <div className="space-y-4">
          {/* Student Selection */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
              课堂信息
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  选择学生 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.studentId || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({ ...prev, studentId: val ? parseInt(val) : null }));
                  }}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- 选择已有学生 --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.grade} {s.subject})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  学生姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.studentName}
                  onChange={(e) => setFormData({ ...formData, studentName: e.target.value, studentId: null })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入学生姓名"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">年级</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">学科</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  课程主题 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.topic}
                  onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="如：分数加减法运算"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  课堂表现 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.performance}
                  onChange={(e) => setFormData({ ...formData, performance: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  rows={4}
                  placeholder="如：本节课专注度较高，能主动回答问题，但计算速度还需提高..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  掌握程度 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {MASTERY_LEVELS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setFormData({ ...formData, mastery: m.value })}
                      className={'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ' +
                        (formData.mastery === m.value
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Image Upload */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
              课堂图片
            </h3>

            <div
              onPaste={handleImagePaste}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleImageDrop}
              className={
                'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ' +
                (dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50')
              }
              onClick={() => imageInputRef.current?.click()}
            >
              {uploading ? (
                <div className="flex items-center justify-center gap-2 text-gray-500">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>上传中...</span>
                </div>
              ) : (
                <>
                  <svg className="w-8 h-8 mx-auto mb-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm text-gray-600">点击上传或粘贴图片（Ctrl+V）</p>
                  <p className="text-xs text-gray-400 mt-1">支持 JPG、PNG、WebP 格式，单张最大10MB</p>
                </>
              )}
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {images.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={'/uploads/' + img}
                      alt={'图片 ' + (i + 1)}
                      className="w-full h-20 object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: AI Generation */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
              AI 生成回访
            </h3>

            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-gray-500">掌握程度：</span>
              <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded text-xs font-medium">{masteryLabel}</span>
            </div>

            <button
              onClick={generateContent}
              disabled={generating || !formData.studentName || !formData.topic || !formData.performance}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium py-3 rounded-lg transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  AI 正在生成...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  生成课后回访内容
                </>
              )}
            </button>

            <p className="text-xs text-gray-400 text-center mt-2">
              内容由 SenseNova AI 生成，生成后可编辑修改
            </p>
          </div>

          {generatedContent && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">回访内容</h3>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      'px-2 py-1 rounded text-xs font-medium ' +
                      (isWordCountValid ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600')
                    }
                  >
                    {wordCount} 字 {isWordCountValid ? '' : '(150-500)'}
                  </span>
                  <button
                    onClick={() => setContentEditable(!contentEditable)}
                    className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 transition-colors"
                  >
                    {contentEditable ? '完成编辑' : '编辑内容'}
                  </button>
                </div>
              </div>

              {contentEditable ? (
                <textarea
                  value={editContent}
                  onChange={handleEditContent}
                  className="w-full border border-gray-300 rounded-lg p-4 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  rows={16}
                />
              ) : (
                <div className="prose prose-sm max-w-none bg-gray-50 rounded-lg p-5 text-sm leading-relaxed whitespace-pre-wrap border border-gray-100">
                  {generatedContent}
                </div>
              )}

              <button
                onClick={saveFollowUp}
                disabled={saving || !isWordCountValid}
                className={
                  'w-full mt-4 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ' +
                  (saved
                    ? 'bg-green-500 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed')
                }
              >
                {saving ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    保存中...
                  </>
                ) : saved ? (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    已保存
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H12M12 12h8M12 17h7M12 2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v2" />
                    </svg>
                    保存回访记录
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
