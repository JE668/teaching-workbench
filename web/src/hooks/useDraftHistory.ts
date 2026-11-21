import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

export type DraftEntityType = 'followup' | 'report' | 'observation';
/** null、'new' 和空字符串都对应后端的 entity_id = null。 */
export type DraftEntityId = number | string | null;
export type DraftContent = Record<string, unknown>;

export interface UnifiedDraft<TContent extends object = DraftContent> {
  id: number;
  entity_type: DraftEntityType;
  entity_id: number | null;
  version: number;
  /** POST 响应不返回 content；hook 会用已发送/已加载的真实内容补齐。 */
  content?: TContent;
  label: string | null;
  is_branch: boolean | number;
  base_version?: number | null;
  fork_from: number | null;
  created_at: string;
  updated_at: string;
}

export interface DraftVersion<TContent extends object = DraftContent>
  extends UnifiedDraft<TContent> {
  content: TContent;
  is_branch: boolean;
  base_version: number | null;
}

export interface DraftGraph {
  nodes: Array<{
    id: number;
    version: number;
    label: string | null;
    isBranch: boolean;
    forkFrom: number | null;
    createdAt: string;
  }>;
  edges: Array<{ from: number; to: number }>;
}

export interface DraftSnapshot<TContent extends object = DraftContent> {
  current: UnifiedDraft<TContent> | null;
  versions: Array<DraftVersion<TContent>>;
  graph: DraftGraph;
}

export interface MergeConflict {
  path: string;
  base: unknown;
  current: unknown;
  incoming: unknown;
}

export type ConflictChoice = 'base' | 'current' | 'incoming';

export interface ThreeWayMergePreview<TContent extends object = DraftContent> {
  branchDraftId: number;
  baseDraftId: number | null;
  baseVersion: number | null;
  base: TContent;
  current: TContent;
  incoming: TContent;
  merged: TContent;
}

export type MergeBranchResult<TContent extends object = DraftContent> =
  | { status: 'merged'; draftId: number; content: TContent }
  | { status: 'conflict'; conflicts: MergeConflict[] }
  | { status: 'error'; error: string };

export type DraftPendingAction = 'save' | 'branch' | 'rollback' | 'merge' | 'resolve' | null;

interface CurrentResponse<TContent extends object> {
  draft: UnifiedDraft<TContent> | null;
}
interface VersionsResponse<TContent extends object> {
  versions: Array<DraftVersion<TContent>>;
}
interface GraphResponse {
  graph: DraftGraph;
}
interface DraftResponse<TContent extends object> {
  draft: UnifiedDraft<TContent>;
}
interface MergeSuccessResponse {
  success: true;
  draftId: number;
}
interface MergeConflictResponse {
  success: false;
  error?: string;
  conflicts?: MergeConflict[];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function entityPath(entityType: DraftEntityType, entityId: DraftEntityId): string {
  const id = entityId === null || entityId === '' || entityId === 'new' ? 'new' : String(entityId);
  return `/unified-drafts/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 与服务端 mergeDrafts 的顶层字段算法保持一致。
 * 预览只使用服务端返回的真实 base/current/incoming，最终合并仍以服务端结果为准。
 */
export function buildThreeWayMerge<TContent extends object>(
  base: TContent,
  current: TContent,
  incoming: TContent,
): { merged: TContent; conflicts: MergeConflict[] } {
  const baseRecord = (base ?? {}) as DraftContent;
  const currentRecord = (current ?? {}) as DraftContent;
  const incomingRecord = (incoming ?? {}) as DraftContent;
  const keys = new Set([...Object.keys(baseRecord), ...Object.keys(currentRecord), ...Object.keys(incomingRecord)]);
  const values = new Map<string, unknown>();
  const conflicts: MergeConflict[] = [];

  for (const key of keys) {
    const baseValue = baseRecord[key];
    const currentValue = currentRecord[key];
    const incomingValue = incomingRecord[key];

    if (sameJson(baseValue, currentValue) && !sameJson(baseValue, incomingValue)) {
      values.set(key, incomingValue);
    } else if (!sameJson(baseValue, currentValue) && sameJson(baseValue, incomingValue)) {
      values.set(key, currentValue);
    } else if (sameJson(currentValue, incomingValue) && !sameJson(baseValue, currentValue)) {
      values.set(key, currentValue);
    } else if (
      !sameJson(baseValue, currentValue) &&
      !sameJson(baseValue, incomingValue) &&
      !sameJson(currentValue, incomingValue)
    ) {
      conflicts.push({ path: key, base: baseValue, current: currentValue, incoming: incomingValue });
      values.set(key, currentValue);
    } else {
      values.set(key, currentValue ?? incomingValue ?? baseValue);
    }
  }

  return { merged: Object.fromEntries(values) as TContent, conflicts };
}

function makePreview<TContent extends object>(
  snapshot: DraftSnapshot<TContent>,
  branchDraftId: number,
): ThreeWayMergePreview<TContent> {
  const branch = snapshot.versions.find((version) => version.id === branchDraftId);
  if (!branch) throw new Error('找不到要合并的分支版本，请刷新后重试');
  if (!snapshot.current?.content) throw new Error('当前主版本尚未加载，无法合并');

  const baseDraft =
    snapshot.versions.find((version) => version.id === branch.fork_from) ??
    snapshot.versions.find((version) => version.version === branch.base_version) ??
    null;
  const base = (baseDraft?.content ?? {}) as TContent;
  const { merged } = buildThreeWayMerge(base, snapshot.current.content, branch.content);

  return {
    branchDraftId,
    baseDraftId: baseDraft?.id ?? branch.fork_from ?? null,
    baseVersion: baseDraft?.version ?? branch.base_version ?? null,
    base,
    current: snapshot.current.content,
    incoming: branch.content,
    merged,
  };
}

function contentWithChoices<TContent extends object>(
  preview: ThreeWayMergePreview<TContent>,
  conflicts: MergeConflict[],
  resolutions: Record<string, ConflictChoice>,
): TContent {
  const values = new Map(Object.entries(preview.merged));
  for (const conflict of conflicts) {
    const choice = resolutions[conflict.path] ?? 'current';
    values.set(conflict.path, conflict[choice]);
  }
  return Object.fromEntries(values) as TContent;
}

/** 仅 merge 使用裸 fetch：api.request 会把 409 的 conflicts 正文丢掉。 */
async function postMerge(path: string, branchDraftId: number): Promise<MergeSuccessResponse | MergeConflictResponse> {
  const token = api.getToken();
  let response: Response;
  try {
    response = await fetch(`/api${path}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ branchDraftId }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('网络连接失败，请检查网络后重试');
  }

  const payload = (await response.json().catch(() => ({}))) as (MergeSuccessResponse | MergeConflictResponse) & {
    error?: string;
  };
  if (response.status === 409) return payload as MergeConflictResponse;
  if (!response.ok) {
    throw new Error(payload.error || `合并失败（HTTP ${response.status}）`);
  }
  return payload as MergeSuccessResponse;
}

export interface UseDraftHistoryResult<TContent extends object = DraftContent> {
  currentDraft: UnifiedDraft<TContent> | null;
  versions: Array<DraftVersion<TContent>>;
  graph: DraftGraph;
  loading: boolean;
  pendingAction: DraftPendingAction;
  error: string | null;
  mergePreview: ThreeWayMergePreview<TContent> | null;
  conflicts: MergeConflict[];
  resolutions: Record<string, ConflictChoice>;
  resolvedContent: TContent | null;
  load: () => Promise<DraftSnapshot<TContent> | null>;
  clearError: () => void;
  saveMain: (content?: TContent, label?: string) => Promise<UnifiedDraft<TContent> | null>;
  createBranch: (
    baseDraftId: number,
    label: string,
    content?: TContent,
  ) => Promise<UnifiedDraft<TContent> | null>;
  rollback: (targetVersion: number) => Promise<UnifiedDraft<TContent> | null>;
  previewMerge: (branchDraftId: number) => Promise<ThreeWayMergePreview<TContent> | null>;
  mergeBranch: (branchDraftId: number) => Promise<MergeBranchResult<TContent>>;
  chooseConflict: (path: string, choice: ConflictChoice) => void;
  resolveMerge: () => Promise<UnifiedDraft<TContent> | null>;
  clearMerge: () => void;
}

export function useDraftHistory<TContent extends object = DraftContent>(
  entityType: DraftEntityType,
  entityId: DraftEntityId,
  currentContent?: TContent,
): UseDraftHistoryResult<TContent> {
  const path = useMemo(() => entityPath(entityType, entityId), [entityType, entityId]);
  const [currentDraft, setCurrentDraft] = useState<UnifiedDraft<TContent> | null>(null);
  const [versions, setVersions] = useState<Array<DraftVersion<TContent>>>([]);
  const [graph, setGraph] = useState<DraftGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<DraftPendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergePreview, setMergePreview] = useState<ThreeWayMergePreview<TContent> | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, ConflictChoice>>({});
  const currentContentRef = useRef(currentContent);
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  currentContentRef.current = currentContent;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadSequence.current += 1;
    };
  }, []);

  const clearMerge = useCallback(() => {
    setMergePreview(null);
    setConflicts([]);
    setResolutions({});
  }, []);

  const load = useCallback(async (): Promise<DraftSnapshot<TContent> | null> => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [currentResponse, versionsResponse, graphResponse] = await Promise.all([
        api.get(`${path}/current`) as Promise<CurrentResponse<TContent>>,
        api.get(`${path}/versions`) as Promise<VersionsResponse<TContent>>,
        api.get(`${path}/graph`) as Promise<GraphResponse>,
      ]);
      const snapshot: DraftSnapshot<TContent> = {
        current: currentResponse.draft ?? null,
        versions: versionsResponse.versions ?? [],
        graph: graphResponse.graph ?? { nodes: [], edges: [] },
      };
      if (mounted.current && sequence === loadSequence.current) {
        setCurrentDraft(snapshot.current);
        setVersions(snapshot.versions);
        setGraph(snapshot.graph);
        setError(null);
      }
      return snapshot;
    } catch (requestError) {
      if (mounted.current && sequence === loadSequence.current) {
        setError(errorMessage(requestError, '加载草稿版本失败'));
      }
      return null;
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setCurrentDraft(null);
    setVersions([]);
    setGraph({ nodes: [], edges: [] });
    setError(null);
    clearMerge();
    void load();
  }, [load, clearMerge]);

  const saveMain = useCallback(
    async (content = currentContentRef.current, label?: string): Promise<UnifiedDraft<TContent> | null> => {
      if (!content || typeof content !== 'object') {
        setError('没有可保存的草稿内容');
        return null;
      }
      setPendingAction('save');
      setError(null);
      try {
        const response = (await api.post(path, { content, ...(label !== undefined ? { label } : {}) })) as DraftResponse<TContent>;
        const draft = { ...response.draft, content };
        setCurrentDraft(draft);
        await load();
        return draft;
      } catch (requestError) {
        setError(errorMessage(requestError, '保存主版本失败'));
        return null;
      } finally {
        if (mounted.current) setPendingAction(null);
      }
    },
    [path, load],
  );

  const createBranch = useCallback(
    async (baseDraftId: number, label: string, content?: TContent): Promise<UnifiedDraft<TContent> | null> => {
      const cleanLabel = label.trim();
      if (!cleanLabel) {
        setError('请输入分支名称');
        return null;
      }
      const branchContent =
        content ?? versions.find((version) => version.id === baseDraftId)?.content ?? currentContentRef.current;
      if (!branchContent || typeof branchContent !== 'object') {
        setError('没有可用于创建分支的内容');
        return null;
      }
      setPendingAction('branch');
      setError(null);
      clearMerge();
      try {
        const response = (await api.post(`${path}/branch`, {
          baseDraftId,
          label: cleanLabel,
          content: branchContent,
        })) as DraftResponse<TContent>;
        const draft = { ...response.draft, content: branchContent };
        await load();
        return draft;
      } catch (requestError) {
        setError(errorMessage(requestError, '创建分支失败'));
        return null;
      } finally {
        if (mounted.current) setPendingAction(null);
      }
    },
    [path, versions, load, clearMerge],
  );

  const rollback = useCallback(
    async (targetVersion: number): Promise<UnifiedDraft<TContent> | null> => {
      setPendingAction('rollback');
      setError(null);
      clearMerge();
      try {
        const response = (await api.post(`${path}/rollback`, { targetVersion })) as DraftResponse<TContent>;
        const targetContent = versions.find((version) => version.version === targetVersion)?.content;
        const draft = { ...response.draft, ...(targetContent ? { content: targetContent } : {}) };
        await load();
        return draft;
      } catch (requestError) {
        setError(errorMessage(requestError, '回滚失败'));
        return null;
      } finally {
        if (mounted.current) setPendingAction(null);
      }
    },
    [path, versions, load, clearMerge],
  );

  const previewMerge = useCallback(
    async (branchDraftId: number): Promise<ThreeWayMergePreview<TContent> | null> => {
      setError(null);
      setConflicts([]);
      setResolutions({});
      const snapshot = await load();
      if (!snapshot) return null;
      try {
        const preview = makePreview(snapshot, branchDraftId);
        setMergePreview(preview);
        return preview;
      } catch (requestError) {
        setMergePreview(null);
        setError(errorMessage(requestError, '生成三方预览失败'));
        return null;
      }
    },
    [load],
  );

  const mergeBranch = useCallback(
    async (branchDraftId: number): Promise<MergeBranchResult<TContent>> => {
      setPendingAction('merge');
      setError(null);
      setConflicts([]);
      setResolutions({});
      try {
        const snapshot = await load();
        if (!snapshot) return { status: 'error', error: '加载最新版本失败，未发起合并' };
        const preview = makePreview(snapshot, branchDraftId);
        setMergePreview(preview);
        const response = await postMerge(path, branchDraftId);
        if (response.success === false) {
          const serverConflicts = response.conflicts ?? [];
          setConflicts(serverConflicts);
          return { status: 'conflict', conflicts: serverConflicts };
        }
        clearMerge();
        await load();
        return { status: 'merged', draftId: response.draftId, content: preview.merged };
      } catch (requestError) {
        const message = errorMessage(requestError, '合并失败');
        setError(message);
        return { status: 'error', error: message };
      } finally {
        if (mounted.current) setPendingAction(null);
      }
    },
    [path, load, clearMerge],
  );

  const chooseConflict = useCallback((pathName: string, choice: ConflictChoice) => {
    setResolutions((previous) => ({ ...previous, [pathName]: choice }));
  }, []);

  const resolvedContent = useMemo(
    () => (mergePreview ? contentWithChoices(mergePreview, conflicts, resolutions) : null),
    [mergePreview, conflicts, resolutions],
  );

  const resolveMerge = useCallback(async (): Promise<UnifiedDraft<TContent> | null> => {
    if (!mergePreview || !resolvedContent || conflicts.length === 0) {
      setError('当前没有待解决的合并冲突');
      return null;
    }
    const missing = conflicts.some((conflict) => !resolutions[conflict.path]);
    if (missing) {
      setError('请为每个冲突字段选择 Base、Current 或 Incoming');
      return null;
    }
    setPendingAction('resolve');
    setError(null);
    try {
      const response = (await api.post(`${path}/resolve-merge`, {
        branchDraftId: mergePreview.branchDraftId,
        resolvedContent,
      })) as DraftResponse<TContent>;
      const draft = { ...response.draft, content: resolvedContent };
      clearMerge();
      await load();
      return draft;
    } catch (requestError) {
      setError(errorMessage(requestError, '解决冲突合并失败'));
      return null;
    } finally {
      if (mounted.current) setPendingAction(null);
    }
  }, [path, mergePreview, resolvedContent, conflicts, resolutions, load, clearMerge]);

  return {
    currentDraft,
    versions,
    graph,
    loading,
    pendingAction,
    error,
    mergePreview,
    conflicts,
    resolutions,
    resolvedContent,
    load,
    clearError: useCallback(() => setError(null), []),
    saveMain,
    createBranch,
    rollback,
    previewMerge,
    mergeBranch,
    chooseConflict,
    resolveMerge,
    clearMerge,
  };
}
