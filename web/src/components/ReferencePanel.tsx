import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BellRing, Link2, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from './ui/Toast';
import {
  ContentReference,
  EntitySummary,
  EntityType,
  RefRole,
  ChangeEvent,
  ENTITY_TYPE_LABELS,
  REF_ROLE_LABELS,
} from '../types';

interface ReferencePanelProps {
  entityType: EntityType;
  entityId: number;
  currentEntityLabel?: string;
  title?: string;
  className?: string;
  onSync?: (result: ReferenceSyncResult) => void;
}

export interface ReferenceSyncResult {
  referenceId: number;
  reportId: number;
  targetField: 'summary_intro' | 'plan_intro';
  content: string;
  syncedEventId: number;
}

export function ReferencePanel({
  entityType,
  entityId,
  title = '关联引用',
  className = '',
  onSync,
}: ReferencePanelProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [outgoing, setOutgoing] = useState<ContentReference[]>([]);
  const [incoming, setIncoming] = useState<ContentReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'outgoing' | 'incoming'>('outgoing');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{ targetType: EntityType; targetId: string; refRole: RefRole }>({
    targetType: 'observation',
    targetId: '',
    refRole: 'cites',
  });
  const [searchResults, setSearchResults] = useState<EntitySummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [syncingRefId, setSyncingRefId] = useState<number | null>(null);
  const searchSeq = useRef(0);

  const loadReferences = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const [outRes, inRes] = await Promise.all([
        api.get(`/content/references/outgoing/${entityType}/${entityId}`),
        api.get(`/content/references/incoming/${entityType}/${entityId}`),
      ]);
      setOutgoing(outRes.references || []);
      setIncoming(inRes.references || []);
    } catch (err: any) {
      toast('加载引用失败：' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, toast]);

  useEffect(() => {
    loadReferences();
  }, [loadReferences]);

  const handleCreate = async () => {
    if (!createForm.targetType || !createForm.targetId) return;
    try {
      await api.post('/content/references', {
        sourceType: entityType,
        sourceId: entityId,
        targetType: createForm.targetType,
        targetId: parseInt(createForm.targetId, 10),
        refRole: createForm.refRole,
      });
      toast('引用创建成功', 'success');
      setShowCreate(false);
      setCreateForm({ targetType: 'observation', targetId: '', refRole: 'cites' });
      setSearchResults([]);
      loadReferences();
    } catch (err: any) {
      toast('创建引用失败：' + err.message, 'error');
    }
  };

  const handleDelete = async (ref: ContentReference) => {
    if (!window.confirm('确定删除此引用关系吗？不会删除关联内容。')) return;
    try {
      await api.request('/content/references', {
        method: 'DELETE',
        body: JSON.stringify({
          sourceType: ref.source_type,
          sourceId: ref.source_id,
          targetType: ref.target_type,
          targetId: ref.target_id,
          refRole: ref.ref_role,
        }),
      });
      toast('引用已删除', 'success');
      loadReferences();
    } catch (err: any) {
      toast('删除引用失败：' + err.message, 'error');
    }
  };

  const handleNavigate = (type: EntityType, id: number) => {
    const routes: Partial<Record<EntityType, string>> = {
      observation: `/observations/${id}`,
      followup: `/followups/${id}`,
      report: `/reports/${id}`,
    };
    const route = routes[type];
    if (route) navigate(route);
  };

  /** 搜索后端最近记录；无搜索接口的类型仍可用明确 ID 创建，不返回模拟结果。 */
  const handleSearchEntities = useCallback(async (type: EntityType, query: string) => {
    const seq = ++searchSeq.current;
    if (!['observation', 'followup', 'report'].includes(type)) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const endpoint = type === 'observation'
        ? '/observations?page=1&pageSize=50'
        : type === 'followup'
          ? '/followups?page=1&pageSize=50'
          : '/reports?limit=50';
      const res = await api.get(endpoint);
      const rows: Array<Record<string, any>> = res.observations || res.followups || res.reports || [];
      const normalized = rows.map((row): EntitySummary => {
        const id = Number(row.id);
        const title = type === 'report'
          ? [row.year_month || row.yearMonth, row.student_name || row.studentName, row.subject].filter(Boolean).join(' · ') || `月报 #${id}`
          : row.topic || [row.student_name || row.studentName, row.subject].filter(Boolean).join(' · ') || `${ENTITY_TYPE_LABELS[type]} #${id}`;
        return { id, title, created_at: row.created_at || row.createdAt || '' };
      });
      const keyword = query.trim().toLowerCase();
      const filtered = keyword
        ? normalized.filter((item) => item.title.toLowerCase().includes(keyword) || String(item.id) === keyword)
        : normalized;
      if (seq === searchSeq.current) setSearchResults(filtered.slice(0, 20));
    } catch (err: any) {
      if (seq === searchSeq.current) {
        setSearchResults([]);
        toast('搜索关联内容失败：' + err.message, 'error');
      }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [toast]);

  const handleSync = async (
    ref: ContentReference,
    targetField: 'summary_intro' | 'plan_intro',
    sourceField: 'report' | 'class_notes'
  ) => {
    const targetLabel = targetField === 'summary_intro' ? '月度总结' : '课程规划';
    if (!window.confirm(`将用关联观察记录覆盖当前${targetLabel}，确定继续吗？`)) return;
    setSyncingRefId(ref.id);
    try {
      const result: ReferenceSyncResult = await api.post(`/content/references/${ref.id}/sync`, {
        targetField,
        sourceField,
      });
      onSync?.(result);
      toast(`已同步到${targetLabel}`, 'success');
      await loadReferences();
    } catch (err: any) {
      toast('同步引用内容失败：' + err.message, 'error');
    } finally {
      setSyncingRefId(null);
    }
  };

  const pendingCount = outgoing.reduce((sum, ref) => sum + (ref.pendingEvents?.length || 0), 0);
  const references = activeTab === 'outgoing' ? outgoing : incoming;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 ${className}`}>
      <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-gray-500" />
          <h3 className="font-medium text-gray-900 dark:text-gray-100">{title}</h3>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <BellRing className="h-3 w-3" /> {pendingCount} 条来源更新
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700"
        >
          <Plus className="w-4 h-4" /> 添加引用
        </button>
      </div>

      <div className="flex border-b dark:border-gray-700">
        <button
          onClick={() => setActiveTab('outgoing')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'outgoing'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          引用了 ({outgoing.length})
        </button>
        <button
          onClick={() => setActiveTab('incoming')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'incoming'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          被引用于 ({incoming.length})
        </button>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" /></div>
        ) : references.length === 0 ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-4">
            {activeTab === 'outgoing' ? '还没有引用其他内容' : '还没有被其他内容引用'}
          </p>
        ) : (
          <div className="space-y-3">
            {references.map((ref) => (
              <ReferenceItem
                key={ref.id}
                reference={ref}
                isOutgoing={activeTab === 'outgoing'}
                onNavigate={handleNavigate}
                onDelete={handleDelete}
                onSync={handleSync}
                syncing={syncingRefId === ref.id}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateReferenceModal
          form={createForm}
          onFormChange={setCreateForm}
          onClose={() => { setShowCreate(false); setSearchResults([]); }}
          onSubmit={handleCreate}
          searchResults={searchResults}
          searching={searching}
          onSearch={handleSearchEntities}
        />
      )}
    </div>
  );
}

interface ReferenceItemProps {
  reference: ContentReference;
  isOutgoing: boolean;
  onNavigate: (type: EntityType, id: number) => void;
  onDelete: (ref: ContentReference) => void;
  onSync: (ref: ContentReference, targetField: 'summary_intro' | 'plan_intro', sourceField: 'report' | 'class_notes') => void;
  syncing: boolean;
}

function ReferenceItem({ reference: ref, isOutgoing, onNavigate, onDelete, onSync, syncing }: ReferenceItemProps) {
  const [targetField, setTargetField] = useState<'summary_intro' | 'plan_intro'>('summary_intro');
  const [sourceField, setSourceField] = useState<'report' | 'class_notes'>('report');
  const target = isOutgoing ? ref.target : ref.source;
  const entityType = isOutgoing ? ref.target_type : ref.source_type;
  const entityId = isOutgoing ? ref.target_id : ref.source_id;
  const canSync = isOutgoing && ref.source_type === 'report' && ref.target_type === 'observation';
  const pendingEvents = ref.pendingEvents || [];

  return (
    <div className="rounded-lg border bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded flex items-center justify-center text-white text-xs font-medium"
          style={{ backgroundColor: entityType === 'observation' ? '#3b82f6' : entityType === 'followup' ? '#10b981' : entityType === 'report' ? '#f59e0b' : '#8b5cf6' }}
        >
          {ENTITY_TYPE_LABELS[entityType]?.charAt(0) || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">{REF_ROLE_LABELS[ref.ref_role]}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{isOutgoing ? '引用了' : '被引用于'}</span>
            {pendingEvents.length > 0 && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">来源有 {pendingEvents.length} 次更新</span>}
          </div>
          <button onClick={() => onNavigate(entityType, entityId)} className="mt-1 flex max-w-full items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
            <span className="truncate">{target?.title || `${ENTITY_TYPE_LABELS[entityType]} #${entityId}`}</span><ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0" />
          </button>
          {pendingEvents[0] && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              最近更新：{formatChangedFields(pendingEvents[0])} · {new Date(pendingEvents[0].created_at).toLocaleString('zh-CN')}
            </p>
          )}
        </div>
        <button onClick={() => onDelete(ref)} className="flex-shrink-0 text-gray-400 hover:text-red-500 p-1" title="删除引用"><Trash2 className="h-4 w-4" /></button>
      </div>
      {canSync && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-600">
          <select aria-label="同步来源字段" value={sourceField} onChange={(event) => setSourceField(event.target.value as 'report' | 'class_notes')} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-500 dark:bg-gray-800">
            <option value="report">评课报告</option><option value="class_notes">课堂笔记</option>
          </select>
          <span className="text-xs text-gray-400">同步到</span>
          <select aria-label="同步目标区块" value={targetField} onChange={(event) => setTargetField(event.target.value as 'summary_intro' | 'plan_intro')} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-500 dark:bg-gray-800">
            <option value="summary_intro">月度总结</option><option value="plan_intro">课程规划</option>
          </select>
          <button disabled={syncing} onClick={() => onSync(ref, targetField, sourceField)} className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />{syncing ? '同步中…' : pendingEvents.length ? '同步最新内容' : '同步内容'}
          </button>
        </div>
      )}
    </div>
  );
}

function formatChangedFields(event: ChangeEvent): string {
  try {
    const fields = JSON.parse(event.changed_fields);
    return Array.isArray(fields) ? fields.join('、') : '内容更新';
  } catch {
    return '内容更新';
  }
}

interface CreateReferenceModalProps {
  form: { targetType: EntityType; targetId: string; refRole: RefRole };
  onFormChange: (form: { targetType: EntityType; targetId: string; refRole: RefRole }) => void;
  onClose: () => void;
  onSubmit: () => void;
  searchResults: EntitySummary[];
  searching: boolean;
  onSearch: (type: EntityType, query: string) => void;
}

function CreateReferenceModal({ form, onFormChange, onClose, onSubmit, searchResults, searching, onSearch }: CreateReferenceModalProps) {
  const [query, setQuery] = useState('');
  const allowedTargetTypes: EntityType[] = ['observation', 'followup', 'report', 'student_profile', 'knowledge_chunk', 'parent_view'];
  const searchable = ['observation', 'followup', 'report'].includes(form.targetType);

  useEffect(() => {
    setQuery('');
    onSearch(form.targetType, '');
  }, [form.targetType, onSearch]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-label="添加引用">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h3 className="text-lg font-semibold">添加引用</h3>
          <button onClick={onClose} aria-label="关闭添加引用" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">目标类型</label>
            <select value={form.targetType} onChange={(event) => onFormChange({ ...form, targetType: event.target.value as EntityType, targetId: '' })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
              {allowedTargetTypes.map((type) => <option key={type} value={type}>{ENTITY_TYPE_LABELS[type]}</option>)}
            </select>
          </div>
          {searchable && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">搜索最近记录</label>
              <div className="flex gap-2">
                <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(form.targetType, query); }} placeholder="输入标题、学生或 ID" className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700" />
                <button onClick={() => onSearch(form.targetType, query)} disabled={searching} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-600"><Search className="h-4 w-4" />搜索</button>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {searching ? <p className="py-2 text-center text-xs text-gray-400">搜索中…</p> : searchResults.length ? searchResults.map((item) => (
                  <button key={item.id} onClick={() => onFormChange({ ...form, targetId: String(item.id) })} className={`w-full rounded border px-3 py-2 text-left text-xs hover:border-blue-500 ${String(item.id) === form.targetId ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
                    <span className="mr-2 text-gray-400">#${item.id}</span>{item.title}
                  </button>
                )) : <p className="py-2 text-center text-xs text-gray-400">暂无匹配记录，可输入明确 ID</p>}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">目标 ID</label>
            <input type="number" min="1" value={form.targetId} onChange={(event) => onFormChange({ ...form, targetId: event.target.value })} placeholder="选择上方记录或输入明确 ID" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">引用关系</label>
            <select value={form.refRole} onChange={(event) => onFormChange({ ...form, refRole: event.target.value as RefRole })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700">
              <option value="cites">引用</option><option value="derives_from">衍生自</option><option value="supplements">补充</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm dark:bg-gray-700">取消</button>
            <button onClick={onSubmit} disabled={!form.targetType || !form.targetId} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">创建引用</button>
          </div>
        </div>
      </div>
    </div>
  );
}
