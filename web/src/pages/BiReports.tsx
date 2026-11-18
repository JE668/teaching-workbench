import { useEffect, useState } from 'react';
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

export default function BiReports() {
  const [fileTypes, setFileTypes] = useState<FileType[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [uploading, setUploading] = useState(false);
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

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get('file') as File;
    if (!file || file.size === 0) {
      toast.error('请选择文件');
      return;
    }

    setUploading(true);
    try {
      const res = await api.upload(`/bi/upload/${selectedType}`, formData);
      toast.success(res.message);
      form.reset();
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
          上传每月导出的 xlsx 报表。同一文件类型可多次上传，每次生成一个新批次，互不影响。
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">上传新报表</h2>
        <form onSubmit={handleUpload} className="mt-4 space-y-4">
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

          <div>
            <label htmlFor="file" className="block text-sm font-medium text-slate-700">
              选择 xlsx 文件
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".xlsx,.xls"
              className="mt-1 block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>

          <button
            type="submit"
            disabled={uploading}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {uploading ? '上传中…' : '上传并解析'}
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
