import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileSpreadsheet, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Card, CardBody, CardHeader } from './ui/Card';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { Input } from './ui/Field';
import { ListSkeleton } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { api } from '../api/client';
import { saveBlob } from '../lib/utils';

export type FieldMapping = Record<string, string>;

export interface ExcelTemplateMeta {
  id: number;
  name: string;
  sheetName: string;
  fieldMappings: FieldMapping;
  createdAt: string;
  updatedAt: string;
}

interface PreviewMapping {
  type: string;
  path: string;
  details?: Record<string, unknown>;
}

interface TemplateInspection {
  sheetNames: string[];
  sheetName: string;
  rowCount: number;
  columnCount: number;
  cells: { address: string; text: string }[];
  truncated: boolean;
  maxRows: number;
  maxColumns: number;
}

interface ExcelTemplatePanelProps {
  reportId?: number;
}

const COMMON_FIELD_PATHS = [
  { value: 'report.student_name', label: '学生姓名' },
  { value: 'report.year_month', label: '报告月份' },
  { value: 'report.term', label: '学期' },
  { value: 'report.grade', label: '年级' },
  { value: 'report.subject', label: '科目' },
  { value: 'report.summary_intro', label: '总结说明' },
  { value: 'report.plan_intro', label: '计划说明' },
  { value: 'student.phone', label: '学生电话' },
  { value: 'student.notes', label: '学生备注' },
  { value: 'loop:report_items[kind=summary]->content', label: '总结条目（循环）' },
  { value: 'loop:report_items[kind=plan]->content', label: '计划条目（循环）' },
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function columnName(column: number): string {
  let value = column;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

/** 模板生成仅接受 POST；API 客户端的通用下载方法默认 GET，因此这里显式下载 Blob。 */
async function postDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = typeof api.getToken === 'function' ? api.getToken() : null;
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
  } catch {
    throw new Error('网络连接失败，请检查网络后重试');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error || '导出 Excel 失败');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = '月报.xlsx';
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      filename = encoded;
    }
  } else if (plain) {
    filename = plain;
  }
  return { blob: await response.blob(), filename };
}

export function ExcelTemplatePanel({ reportId }: ExcelTemplatePanelProps) {
  const { success, error } = useToast();
  const [templates, setTemplates] = useState<ExcelTemplateMeta[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingBusyId, setEditingBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Record<string, PreviewMapping> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inspectSequence = useRef(0);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [fileBase64, setFileBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [mappingDraft, setMappingDraft] = useState('');
  const [inspection, setInspection] = useState<TemplateInspection | null>(null);
  const [selectedCell, setSelectedCell] = useState('');
  const [fieldPath, setFieldPath] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/excel-templates');
      setTemplates(res.templates ?? []);
    } catch (err) {
      error(err instanceof Error ? err.message : '读取模板列表失败');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    void load();
  }, [load]);

  const mappingParsed = useMemo(() => {
    if (!mappingDraft.trim()) return null;
    try {
      const value = JSON.parse(mappingDraft) as unknown;
      if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || Object.values(value).some((item) => typeof item !== 'string')
      ) {
        return { ok: false as const, message: '映射必须是 JSON 对象，且每个字段路径都必须是字符串' };
      }
      return { ok: true as const, value: value as FieldMapping };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : 'JSON 格式不正确' };
    }
  }, [mappingDraft]);

  const visualMappings: FieldMapping = mappingParsed?.ok ? mappingParsed.value : {};
  const inspectedCells = useMemo(
    () => new Map((inspection?.cells ?? []).map((cell) => [cell.address, cell.text])),
    [inspection],
  );
  const previewRows = Math.min(30, Math.max(1, inspection?.maxRows ?? 30));
  const previewColumns = Math.min(12, Math.max(1, inspection?.maxColumns ?? 12));

  async function inspectWorkbook(base64: string, requestedSheet?: string) {
    const sequence = ++inspectSequence.current;
    setInspecting(true);
    setInspection(null);
    setSelectedCell('');
    setFieldPath('');
    try {
      const result = await api.post('/reports/excel-templates/inspect', {
        fileBase64: base64,
        ...(requestedSheet ? { sheetName: requestedSheet } : {}),
      }) as TemplateInspection;
      if (sequence !== inspectSequence.current) return;
      if (!Array.isArray(result.sheetNames) || !Array.isArray(result.cells) || !result.sheetName) {
        throw new Error('模板检查接口返回格式不正确');
      }
      setInspection(result);
      setSheetName(result.sheetName);
    } catch (err) {
      if (sequence === inspectSequence.current) {
        error(err instanceof Error ? err.message : '读取 Excel 工作表失败');
      }
    } finally {
      if (sequence === inspectSequence.current) setInspecting(false);
    }
  }

  function resetEditor() {
    inspectSequence.current += 1;
    setEditingId(null);
    setName('');
    setSheetName('Sheet1');
    setFileName('');
    setFileBase64('');
    setMappingDraft('');
    setInspection(null);
    setInspecting(false);
    setSelectedCell('');
    setFieldPath('');
    setPreview(null);
  }

  async function handlePickFile(file: File) {
    setUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      setFileBase64(base64);
      setFileName(file.name);
      if (!name) setName(file.name.replace(/\.xlsx?$/i, ''));
      await inspectWorkbook(base64);
    } catch (err) {
      error(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setUploading(false);
    }
  }

  function handleSelectCell(address: string) {
    setSelectedCell(address);
    setFieldPath(visualMappings[address] ?? '');
  }

  function handleWriteMapping() {
    if (!selectedCell) {
      error('请先选择要映射的单元格');
      return;
    }
    if (!fieldPath.trim()) {
      error('请选择或输入字段路径');
      return;
    }
    if (mappingParsed && !mappingParsed.ok) {
      error('请输入合法的单元格映射 JSON');
      return;
    }
    setMappingDraft(JSON.stringify({ ...visualMappings, [selectedCell]: fieldPath.trim() }, null, 2));
  }

  function handleRemoveMapping() {
    if (!selectedCell || !visualMappings[selectedCell]) {
      error('请先选择已映射的单元格');
      return;
    }
    const next = { ...visualMappings };
    delete next[selectedCell];
    setMappingDraft(JSON.stringify(next, null, 2));
    setFieldPath('');
  }

  async function handleSave() {
    if (!mappingParsed || mappingParsed.ok !== true) {
      error('请输入合法的单元格映射 JSON');
      return;
    }
    if (!name.trim() || !fileBase64) {
      error('请填写模板名称并选择 xlsx 文件');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        fileBase64,
        fieldMappings: mappingParsed.value,
        sheetName: sheetName.trim() || 'Sheet1',
      };
      if (editingId) {
        await api.put('/reports/excel-templates/' + editingId, payload);
      } else {
        await api.post('/reports/excel-templates', payload);
      }
      success(editingId ? '模板已更新' : '模板已保存');
      resetEditor();
      await load();
    } catch (err) {
      error(err instanceof Error ? err.message : '保存模板失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(id: number) {
    setEditingBusyId(id);
    try {
      const res = await api.get('/reports/excel-templates/' + id);
      const template = res.template as ExcelTemplateMeta & { fileBase64?: string };
      if (!template?.fileBase64) throw new Error('模板文件内容为空，无法编辑');
      setEditingId(id);
      setName(template.name);
      setSheetName(template.sheetName);
      setFileBase64(template.fileBase64);
      setFileName(template.name + '.xlsx');
      setMappingDraft(JSON.stringify(template.fieldMappings ?? {}, null, 2));
      setPreview(null);
      await inspectWorkbook(template.fileBase64, template.sheetName);
    } catch (err) {
      error(err instanceof Error ? err.message : '读取模板详情失败');
    } finally {
      setEditingBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      await api.delete('/reports/excel-templates/' + id);
      success('模板已删除');
      if (editingId === id) resetEditor();
      await load();
    } catch (err) {
      error(err instanceof Error ? err.message : '删除模板失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePreview(id: number) {
    setBusyId(id);
    try {
      const res = await api.post('/reports/excel-templates/' + id + '/preview', {});
      setPreview(res.mappings ?? {});
    } catch (err) {
      error(err instanceof Error ? err.message : '预览模板失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleGenerate(templateId: number) {
    if (!reportId) {
      error('请先保存这份月报再套用模板');
      return;
    }
    setBusyId(templateId);
    try {
      const { blob, filename } = await postDownload(
        '/reports/' + reportId + '/excel-templates/' + templateId + '/generate',
      );
      saveBlob(blob, filename);
      success('已按模板导出 Excel');
    } catch (err) {
      error(err instanceof Error ? err.message : '导出 Excel 失败');
    } finally {
      setBusyId(null);
    }
  }

  if (loading && templates === null) {
    return (
      <Card>
        <CardHeader title="Excel 模板" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} />
        <CardBody><ListSkeleton rows={3} /></CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Excel 模板"
        description="上传月报模板文件，把单元格映射到字段，即可按模板导出"
        icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
      />
      <CardBody>
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">{editingId ? '编辑模板' : '新增模板'}</p>
              {editingId ? (
                <Button variant="ghost" size="sm" onClick={resetEditor}>取消编辑</Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="模板名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 星火月报模板"
              />
              <Input
                label="工作表名"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Sheet1"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePickFile(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                loading={uploading}
                icon={<Upload className="h-4 w-4" />}
                onClick={() => fileRef.current?.click()}
              >
                选择 xlsx 文件
              </Button>
              {fileName ? <Badge tone="success">{fileName}</Badge> : null}
              {inspecting ? <span className="text-xs text-slate-500">正在读取工作表…</span> : null}
            </div>

            {inspection ? (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs font-medium text-slate-600">
                    <span className="mb-1 block">切换已读取工作表</span>
                    <select
                      aria-label="切换已读取工作表"
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                      value={inspection.sheetName}
                      disabled={inspecting}
                      onChange={(e) => {
                        setSheetName(e.target.value);
                        void inspectWorkbook(fileBase64, e.target.value);
                      }}
                    >
                      {inspection.sheetNames.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <Badge tone={inspection.truncated ? 'warning' : 'neutral'}>
                    {inspection.truncated ? '已截断' : '未截断'}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    原表 {inspection.rowCount} 行 × {inspection.columnCount} 列；预览上限 {previewRows} 行 × {previewColumns} 列
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  点击单元格后选择字段路径；空白单元格也可映射。网格可横向滚动，仅显示预览范围内的内容。
                </p>
                <div className="max-h-[32rem] max-w-full overflow-auto rounded-lg border border-slate-200">
                  <table className="border-collapse font-mono text-xs" aria-label="Excel 单元格预览网格">
                    <thead className="sticky top-0 z-10 bg-slate-100">
                      <tr>
                        <th className="sticky left-0 z-20 border border-slate-200 bg-slate-100 px-2 py-1 text-slate-400">行 / 列</th>
                        {Array.from({ length: previewColumns }, (_, index) => (
                          <th key={index} scope="col" className="min-w-32 border border-slate-200 px-2 py-1 text-center text-slate-600">
                            {columnName(index + 1)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: previewRows }, (_, rowIndex) => (
                        <tr key={rowIndex}>
                          <th scope="row" className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-2 py-1 text-center text-slate-600">
                            {rowIndex + 1}
                          </th>
                          {Array.from({ length: previewColumns }, (_, columnIndex) => {
                            const address = columnName(columnIndex + 1) + String(rowIndex + 1);
                            const text = inspectedCells.get(address) ?? '';
                            const mappedPath = visualMappings[address];
                            const selected = selectedCell === address;
                            return (
                              <td key={address} className="border border-slate-200 p-0">
                                <button
                                  type="button"
                                  aria-label={'选择单元格 ' + address + (text ? '：' + text : '')}
                                  aria-pressed={selected}
                                  title={mappedPath ? address + ' → ' + mappedPath : text || address}
                                  onClick={() => handleSelectCell(address)}
                                  className={
                                    'block h-16 w-full min-w-32 max-w-40 px-2 py-1 text-left align-top outline-none transition-colors '
                                    + (selected ? 'bg-brand-100 ring-2 ring-inset ring-brand-500 ' : 'hover:bg-brand-50 ')
                                    + (mappedPath ? 'bg-emerald-50' : '')
                                  }
                                >
                                  <span className="mb-0.5 block text-[10px] font-semibold text-slate-400">{address}</span>
                                  <span className="block truncate text-slate-800">{text || '—'}</span>
                                  {mappedPath ? <span className="mt-0.5 block truncate text-[10px] text-emerald-700">{mappedPath}</span> : null}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 rounded-lg bg-slate-50 p-3 lg:grid-cols-[10rem_1fr_1fr]">
                  <div className="text-sm">
                    <span className="block text-xs text-slate-500">当前单元格</span>
                    <strong className="font-mono text-slate-900">{selectedCell || '尚未选择'}</strong>
                  </div>
                  <label className="text-xs font-medium text-slate-600">
                    <span className="mb-1 block">常见字段路径</span>
                    <select
                      aria-label="常见字段路径"
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
                      value={COMMON_FIELD_PATHS.some((item) => item.value === fieldPath) ? fieldPath : ''}
                      onChange={(e) => setFieldPath(e.target.value)}
                    >
                      <option value="">请选择常见字段</option>
                      {COMMON_FIELD_PATHS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}（{item.value}）</option>
                      ))}
                    </select>
                  </label>
                  <Input
                    label="自定义字段路径"
                    value={fieldPath}
                    onChange={(e) => setFieldPath(e.target.value)}
                    placeholder="report.student_name 或 loop:/if: 语法"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleWriteMapping} disabled={!selectedCell || !fieldPath.trim()}>
                    写入映射
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleRemoveMapping} disabled={!selectedCell || !visualMappings[selectedCell]}>
                    移除映射
                  </Button>
                </div>
              </div>
            ) : null}

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                单元格映射（JSON 对象，键为单元格地址，值为字段路径）
              </span>
              <textarea
                value={mappingDraft}
                onChange={(e) => setMappingDraft(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-brand-400"
              />
            </label>
            {mappingParsed && !mappingParsed.ok ? (
              <p className="mt-1 text-xs text-rose-600">映射 JSON 不合法：{mappingParsed.message}</p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">高级 JSON 可直接编辑，保留 loop: 循环与 if: 条件语法；网格写入会同步到这里。</p>
            <p className="mt-2 rounded-lg bg-slate-50 p-2 font-mono text-xs leading-5 text-slate-500">
              &#123;"A1":"report.student_name","A3":"loop:report_items[kind=summary]-&gt;content"&#125;
            </p>

            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                loading={saving}
                disabled={!fileBase64 || !name.trim() || !mappingDraft.trim()}
                icon={<Plus className="h-4 w-4" />}
                onClick={() => void handleSave()}
              >
                {editingId ? '保存修改' : '保存模板'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {(templates ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">还没有模板，上传一个 xlsx 文件就能按组里的格式导出。</p>
            ) : (
              (templates ?? []).map((tpl) => (
                <div key={tpl.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3">
                  <span className="text-sm font-medium text-slate-900">{tpl.name}</span>
                  <Badge tone="neutral">{tpl.sheetName}</Badge>
                  <span className="text-xs text-slate-400">{Object.keys(tpl.fieldMappings ?? {}).length} 个映射</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      loading={editingBusyId === tpl.id}
                      icon={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() => void handleEdit(tpl.id)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === tpl.id}
                      icon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => void handlePreview(tpl.id)}
                    >
                      预览
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!reportId}
                      icon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => void handleGenerate(tpl.id)}
                    >
                      套用导出
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
                      onClick={() => void handleDelete(tpl.id)}
                    >
                      删除
                    </Button>
                  </span>
                </div>
              ))
            )}
          </div>

          {preview ? (
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-medium text-slate-500">映射解析结果</p>
              <div className="space-y-1 font-mono text-xs text-slate-600">
                {Object.entries(preview).map(([cell, item]) => (
                  <p key={cell}>{cell} → {item.type} · {item.path}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

export default ExcelTemplatePanel;
