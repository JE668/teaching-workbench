import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';

interface FileType {
  file_type: string;
  display_name: string;
  enabled: number;
  description: string | null;
}

interface Batch {
  id: number;
  file_type: string;
  file_name: string;
  uploaded_at: string;
  row_count: number | null;
  error_count: number;
  status: string;
}

// 文件名 → file_type 自动匹配规则。**按顺序匹配**（续生率/续科率都含"续"，必须先匹配长的）。
const FILENAME_PATTERNS: { pattern: RegExp; fileType: string; label: string }[] = [
  { pattern: /个人业绩/,          fileType: 'personal_perf',      label: '个人业绩统计' },
  { pattern: /在册学生|在读学生/, fileType: 'student_snapshot',   label: '在册学生明细' },
  { pattern: /在册科次/,          fileType: 'subject_snapshot',   label: '在册科次明细' },
  { pattern: /续结比/,            fileType: 'renew_close_ratio',  label: '科组科次续结比' },
  { pattern: /续生率/,            fileType: 'xusheng_detail',     label: '续生率-学生明细' },
  { pattern: /续科率/,            fileType: 'xuke_detail',        label: '续科率-科次明细' },
  { pattern: /预排/,              fileType: 'scheduled_course',   label: '预排课程状态统计' },
  { pattern: /定金券/,            fileType: 'voucher',            label: '定金券使用报表' },
];

/**
 * 从文件名推断报表类型。未匹配返回 null。
 */
function guessFileType(fileName: string): { fileType: string; label: string } | null {
  for (const { pattern, fileType, label } of FILENAME_PATTERNS) {
    if (pattern.test(fileName)) return { fileType, label };
  }
  return null;
}

export default function BiReports() {
  const [fileTypes, setFileTypes] = useState<FileType[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    loadFileTypes();
    loadBatches();
  }, []);

  async function loadFileTypes() {
    try {
      const res = await api.get('/bi/file-types');
      setFileTypes(res.fileTypes);
      const firstEnabled = res.fileTypes.find((f: FileType) => f.enabled === 1);
      if (firstEnabled) setSelectedType(firstEnabled.file_type);
    } catch (err) {
      toast.error('加载文件类型失败');
    }
  }

  async function loadBatches() {
    try {
      const res = await api.get('/bi/batches');
      setBatches(res.batches);
    } catch (err) {
      toast.error('加载批次列表失败');
    }
  }

  /**
   * 处理文件选择（含拖拽和点击选择两种路径）。
   * 自动根据文件名匹配报表类型，未匹配时提示用户手动选。
   */
  function acceptFile(file: File | null | undefined) {
    if (!file || file.size === 0) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast.error('只支持 xlsx / xls 文件');
      return;
    }
    setSelectedFile(file);
    const guess = guessFileType(file.name);
    if (guess) {
      // 自动切换报表类型；toast 提示用户发生了自动匹配
      setSelectedType(guess.fileType);
      toast.info(`已根据文件名识别为「${guess.label}」`);
    } else {
      toast.info('未识别文件类型，请手动选择报表类型');
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    // dataTransfer.files 是 FileList，只取第一个
    const dropped = e.dataTransfer.files?.[0];
    acceptFile(dropped);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    acceptFile(f);
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('请选择文件');
      return;
    }
    if (!selectedType) {
      toast.error('请选择报表类型');
      return;
    }
    if (replaceMode && !confirm(`覆盖模式：将删除「${fileTypes.find(f => f.file_type === selectedType)?.display_name || selectedType}」所有历史批次后再导入。确定吗？`)) {
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('mode', replaceMode ? 'replace' : 'append');

    try {
      const res = await api.upload(`/bi/upload/${selectedType}`, formData);
      toast.success(res.message);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadBatches();
    } catch (err: any) {
      toast.error(err?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(batchId: number) {
    if (!confirm(`确定删除批次 #${batchId} 吗？关联的所有数据行会一并删除。`)) return;
    try {
      await api.delete(`/bi/batches/${batchId}`);
      toast.success('批次已删除');
      loadBatches();
    } catch (err: any) {
      toast.error(err?.message || '删除失败');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">报表上传</h1>
        <p className="mt-1 text-sm text-slate-600">
          上传每月导出的 xlsx 报表。支持拖拽上传，会根据文件名自动匹配报表类型。
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">上传新报表</h2>
        <form onSubmit={handleUpload} className="mt-4 space-y-4">
          {/* 拖拽上传区 */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="拖拽 xlsx 文件到此处上传，或点击选择文件"
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 ${
              dragActive
                ? 'border-brand-500 bg-brand-50'
                : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40'
            }`}
          >
            <svg className="h-10 w-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16.5V9.75m0 0l-3 3m3-3l3 3M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M3 16.5V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25v11.25" />
            </svg>
            <p className="text-sm font-medium text-slate-700">
              拖拽 xlsx 到此处，或点击选择文件
            </p>
            <p className="text-xs text-slate-500">
              会根据文件名自动匹配报表类型
            </p>
            {selectedFile && (
              <p className="mt-2 text-sm text-brand-700 font-medium">
                已选择：{selectedFile.name}（{(selectedFile.size / 1024).toFixed(1)} KB）
              </p>
            )}
            <input
              ref={fileInputRef}
              id="file"
              name="file"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          <div>
            <label htmlFor="fileType" className="block text-sm font-medium text-slate-700">
              报表类型
            </label>
            <select
              id="fileType"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-brand-500 focus:ring-brand-500"
            >
              {fileTypes.filter((f) => f.enabled === 1).map((f) => (
                <option key={f.file_type} value={f.file_type}>
                  {f.display_name}
                </option>
              ))}
            </select>
            {fileTypes.filter((f) => f.file_type === selectedType).map((f) => (
              <p key={f.file_type} className="mt-2 text-xs text-slate-500">{f.description}</p>
            ))}
          </div>

          <div className="flex items-start gap-2">
            <input
              id="replaceMode"
              type="checkbox"
              checked={replaceMode}
              onChange={(e) => setReplaceMode(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="replaceMode" className="text-sm text-slate-700">
              覆盖模式
              <span className="block text-xs text-slate-500">
                勾选后上传会先删除该报表类型的所有历史批次。适合每月定期更新同一份报表。
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {uploading ? '上传中…' : replaceMode ? '覆盖并解析' : '上传并解析'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">最近上传的批次</h2>
        {batches.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">暂无上传记录</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">批次</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">类型</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">文件名</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">行数</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">状态</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 text-sm text-slate-900">#{b.id}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {fileTypes.find((f) => f.file_type === b.file_type)?.display_name || b.file_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{b.file_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{b.uploaded_at}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {b.row_count ?? '-'}{b.error_count > 0 && (
                        <span className="ml-1 text-red-600">({b.error_count} 错误)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        b.status === 'committed' ? 'bg-green-100 text-green-800' :
                        b.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {b.status === 'committed' ? '已入库' : b.status === 'failed' ? '失败' : '处理中'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="text-sm text-red-600 hover:text-red-900"
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
      </section>
    </div>
  );
}
