import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  GitBranch,
  GitFork,
  GitMerge,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react';
import {
  type ConflictChoice,
  type DraftContent,
  type DraftEntityId,
  type DraftEntityType,
  type DraftVersion,
  useDraftHistory,
} from '../hooks/useDraftHistory';
import Badge from './ui/Badge';
import Button from './ui/Button';
import EmptyState from './ui/EmptyState';
import Modal from './ui/Modal';
import { ListSkeleton } from './ui/Skeleton';
import { cn } from '../lib/utils';

export interface UnifiedDraftPanelProps<TContent extends object = DraftContent> {
  entityType: DraftEntityType;
  entityId: DraftEntityId;
  currentContent?: TContent;
  /** 内容停止变化后自动追加一个主版本；首次加载不重复保存。 */
  autoSave?: boolean;
  autoSaveDelayMs?: number;
  /** 回滚或合并成功后，把服务端对应版本的真实内容交还编辑器。 */
  onRestore: (content: TContent) => void;
  mode?: 'modal' | 'panel';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  triggerLabel?: string;
  disabled?: boolean;
  className?: string;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '（未设置）';
  if (typeof value === 'string') return value || '（空字符串）';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatTime(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function VersionContent({ title, value, tone }: { title: string; value: unknown; tone: string }) {
  return (
    <section className={cn('min-w-0 rounded-xl border p-3', tone)} aria-label={title}>
      <h4 className="mb-2 text-xs font-semibold">{title}</h4>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
        {formatValue(value)}
      </pre>
    </section>
  );
}

const choiceLabels: Array<{ value: ConflictChoice; label: string; hint: string }> = [
  { value: 'base', label: 'Base', hint: '分叉时的基础版本' },
  { value: 'current', label: 'Current', hint: '当前主版本' },
  { value: 'incoming', label: 'Incoming', hint: '待合并分支' },
];

export function UnifiedDraftPanel<TContent extends object = DraftContent>({
  entityType,
  entityId,
  currentContent,
  autoSave = false,
  autoSaveDelayMs = 1200,
  onRestore,
  mode = 'modal',
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  showTrigger = true,
  triggerLabel = '版本与分支',
  disabled = false,
  className,
}: UnifiedDraftPanelProps<TContent>) {
  const history = useDraftHistory(entityType, entityId, currentContent);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [branchLabel, setBranchLabel] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const actualOpen = mode === 'panel' || (controlledOpen ?? internalOpen);
  const busy = history.pendingAction !== null;
  const serializedCurrentContent = useMemo(() => {
    if (!currentContent) return null;
    try {
      return JSON.stringify(currentContent) ?? null;
    } catch {
      return null;
    }
  }, [currentContent]);
  const latestContentRef = useRef(currentContent);
  const autoSaveBaselineRef = useRef<string | null>(serializedCurrentContent);
  latestContentRef.current = currentContent;

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    setSelectedVersionId(null);
    setBranchFormOpen(false);
    setBranchLabel('');
    setNotice(null);
    autoSaveBaselineRef.current = serializedCurrentContent;
  }, [entityType, entityId]);

  // 手动保存、回滚或合并后，服务端当前版本已经和编辑器一致，不再重复自动快照。
  useEffect(() => {
    const currentVersion = history.versions.find(
      (version) => version.id === history.currentDraft?.id && !version.is_branch,
    );
    if (!currentVersion || !serializedCurrentContent) return;
    try {
      if (JSON.stringify(currentVersion.content) === serializedCurrentContent) {
        autoSaveBaselineRef.current = serializedCurrentContent;
      }
    } catch {
      // 无法序列化时保留编辑器现有内容，不触发额外写入。
    }
  }, [history.currentDraft?.id, history.versions, serializedCurrentContent]);

  useEffect(() => {
    if (!autoSave || disabled || !serializedCurrentContent || history.pendingAction) return;
    if (autoSaveBaselineRef.current === null) {
      autoSaveBaselineRef.current = serializedCurrentContent;
      return;
    }
    if (autoSaveBaselineRef.current === serializedCurrentContent) return;
    const contentSnapshot = latestContentRef.current;
    if (!contentSnapshot) return;
    // 先推进基线，避免保存过程中 React 状态刷新造成重复快照；失败会由面板显示错误。
    autoSaveBaselineRef.current = serializedCurrentContent;
    const timer = window.setTimeout(() => {
      void history.saveMain(contentSnapshot, '自动保存');
    }, Math.max(200, autoSaveDelayMs));
    return () => window.clearTimeout(timer);
  }, [autoSave, autoSaveDelayMs, disabled, history.pendingAction, history.saveMain, serializedCurrentContent]);

  useEffect(() => {
    if (selectedVersionId !== null && !history.versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(null);
      setBranchFormOpen(false);
    }
  }, [history.versions, selectedVersionId]);

  const selectedVersion: DraftVersion<TContent> | null = useMemo(
    () => history.versions.find((version) => version.id === selectedVersionId) ?? null,
    [history.versions, selectedVersionId],
  );

  const parentByDraftId = useMemo(() => {
    const parents = new Map<number, number>();
    for (const edge of history.graph.edges) parents.set(edge.to, edge.from);
    return parents;
  }, [history.graph.edges]);

  const runAction = async (action: () => Promise<boolean>, successMessage?: string) => {
    setNotice(null);
    const succeeded = await action();
    if (succeeded && successMessage) setNotice(successMessage);
  };

  const selectVersion = (version: DraftVersion<TContent>) => {
    setSelectedVersionId(version.id);
    setBranchFormOpen(false);
    setNotice(null);
    if (history.mergePreview?.branchDraftId !== version.id) history.clearMerge();
  };

  const save = () => {
    autoSaveBaselineRef.current = serializedCurrentContent;
    void runAction(async () => Boolean(await history.saveMain(currentContent)), '主版本已保存，版本历史已刷新');
  };

  const createBranch = () =>
    runAction(
      async () => {
        if (!selectedVersion) return false;
        const draft = await history.createBranch(selectedVersion.id, branchLabel, selectedVersion.content);
        if (draft) {
          setBranchLabel('');
          setBranchFormOpen(false);
          return true;
        }
        return false;
      },
      '分支已创建',
    );

  const rollback = () =>
    runAction(
      async () => {
        if (!selectedVersion) return false;
        const draft = await history.rollback(selectedVersion.version);
        if (!draft) return false;
        onRestore(selectedVersion.content);
        return true;
      },
      `已回滚到 v${selectedVersion?.version}，内容已交给编辑器`,
    );

  const merge = () =>
    runAction(
      async () => {
        if (!selectedVersion) return false;
        const result = await history.mergeBranch(selectedVersion.id);
        if (result.status === 'merged') {
          onRestore(result.content);
          setNotice('分支已合并到主版本，内容已交给编辑器');
          return true;
        }
        return false;
      },
    );

  const resolve = () =>
    runAction(
      async () => {
        const draft = await history.resolveMerge();
        if (!draft?.content) return false;
        onRestore(draft.content);
        return true;
      },
      '冲突已解决并合并，内容已交给编辑器',
    );

  const allConflictsResolved =
    history.conflicts.length > 0 && history.conflicts.every((conflict) => Boolean(history.resolutions[conflict.path]));

  const body = (
    <div className={cn('space-y-4', className)} aria-label="草稿版本与分支">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <History className="h-4 w-4 text-brand-600" />
          <span>
            {history.currentDraft
              ? `当前主版本 v${history.currentDraft.version} · 共 ${history.versions.length} 个节点`
              : '尚未保存主版本'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={cn('h-4 w-4', history.loading && 'animate-spin')} />}
            disabled={busy || history.loading}
            onClick={() => void runAction(async () => Boolean(await history.load()))}
          >
            刷新
          </Button>
          {currentContent && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon={<Save className="h-4 w-4" />}
              loading={history.pendingAction === 'save'}
              disabled={busy || disabled}
              onClick={() => void save()}
            >
              保存主版本
            </Button>
          )}
        </div>
      </div>

      {history.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{history.error}</span>
          <button type="button" className="text-xs underline" onClick={history.clearError}>关闭</button>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
          <Check className="h-4 w-4" />
          {notice}
        </div>
      )}

      {history.loading && history.versions.length === 0 ? (
        <ListSkeleton rows={3} />
      ) : history.versions.length === 0 ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title="还没有版本记录"
          description={currentContent ? '保存当前内容后，即可创建分支、回滚和合并。' : '这个实体还没有已保存的草稿版本。'}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.85fr)_minmax(0,1.4fr)]">
          <section className="min-w-0" aria-label="版本树">
            <div className="mb-2 flex items-center gap-2">
              <GitFork className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">版本树</h3>
            </div>
            <ol className="max-h-[30rem] space-y-1 overflow-y-auto pr-1">
              {[...history.versions].reverse().map((version) => {
                const isBranch = Boolean(version.is_branch);
                const parentId = version.fork_from ?? parentByDraftId.get(version.id);
                const parent = history.versions.find((candidate) => candidate.id === parentId);
                const isCurrent = history.currentDraft?.id === version.id && !isBranch;
                return (
                  <li key={version.id} className={cn(isBranch && 'ml-5 border-l border-violet-200 pl-3')}>
                    <button
                      type="button"
                      aria-label={`v${version.version} ${isBranch ? version.label || '未命名分支' : '主版本'}`}
                      aria-pressed={selectedVersionId === version.id}
                      onClick={() => selectVersion(version)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                        selectedVersionId === version.id
                          ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        {isBranch ? <GitBranch className="h-3.5 w-3.5 text-violet-600" /> : <History className="h-3.5 w-3.5 text-slate-500" />}
                        <span className="font-medium text-slate-800">v{version.version}</span>
                        <Badge tone={isBranch ? 'violet' : 'neutral'}>{isBranch ? version.label || '未命名分支' : '主版本'}</Badge>
                        {isCurrent && <Badge tone="success">当前</Badge>}
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {version.label && !isBranch ? `${version.label} · ` : ''}{formatTime(version.updated_at)}
                      </span>
                      {parent && (
                        <span className="mt-1 block text-xs text-violet-600">
                          {isBranch ? '从' : '基于'} #{parent.id} · v{parent.version}{isBranch ? ' 分叉' : ''}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4" aria-label="版本详情">
            {!selectedVersion ? (
              <div className="flex h-full min-h-40 items-center justify-center text-center text-sm text-slate-500">
                选择左侧版本以查看真实内容，或创建分支、回滚、合并。
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-800">
                      v{selectedVersion.version} · {selectedVersion.label || (selectedVersion.is_branch ? '分支' : '主版本')}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">草稿 #{selectedVersion.id} · {formatTime(selectedVersion.updated_at)}</p>
                  </div>
                  <Badge tone={selectedVersion.is_branch ? 'violet' : 'brand'}>
                    {selectedVersion.is_branch ? 'Incoming 分支' : '主版本节点'}
                  </Badge>
                </div>
                <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white p-3 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-700">
                  {formatValue(selectedVersion.content)}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setBranchFormOpen((value) => !value)}>
                    <GitFork className="mr-1 h-4 w-4" />基于此版本创建分支
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={history.pendingAction === 'rollback'}
                    disabled={busy}
                    onClick={() => void rollback()}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />回滚到此版本
                  </Button>
                  {Boolean(selectedVersion.is_branch) && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy || history.loading}
                        onClick={() => void history.previewMerge(selectedVersion.id)}
                      >
                        三方预览
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        loading={history.pendingAction === 'merge'}
                        disabled={busy}
                        onClick={() => void merge()}
                      >
                        <GitMerge className="mr-1 h-4 w-4" />合并到主版本
                      </Button>
                    </>
                  )}
                </div>
                {branchFormOpen && (
                  <form
                    className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 sm:flex-row sm:items-end"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createBranch();
                    }}
                  >
                    <label className="flex-1 text-xs font-medium text-violet-800">
                      分支名称
                      <input
                        value={branchLabel}
                        onChange={(event) => setBranchLabel(event.target.value)}
                        maxLength={80}
                        required
                        autoFocus
                        placeholder="例如：家长沟通备选稿"
                        className="mt-1 h-9 w-full rounded-lg border border-violet-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                      />
                    </label>
                    <Button type="submit" size="sm" loading={history.pendingAction === 'branch'} disabled={busy || !branchLabel.trim()}>
                      创建分支
                    </Button>
                  </form>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {history.mergePreview && (
        <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/40 p-4" aria-label="三方合并预览">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <GitMerge className="h-4 w-4 text-sky-600" />三方合并预览
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              以下均来自已加载的服务端版本；Base 为分叉点，Current 为当前主版本，Incoming 为选中分支。自动合并结果以服务端响应为准。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <VersionContent
              title={`Base · ${history.mergePreview.baseVersion === null ? '空基础' : `v${history.mergePreview.baseVersion}`}`}
              value={history.mergePreview.base}
              tone="border-slate-200 bg-white text-slate-700"
            />
            <VersionContent
              title={`Current · v${history.currentDraft?.version ?? '—'}`}
              value={history.mergePreview.current}
              tone="border-sky-200 bg-sky-50 text-sky-900"
            />
            <VersionContent
              title={`Incoming · 草稿 #${history.mergePreview.branchDraftId}`}
              value={history.mergePreview.incoming}
              tone="border-violet-200 bg-violet-50 text-violet-900"
            />
          </div>
          <VersionContent
            title={history.conflicts.length ? '合并结果预览（冲突待选择）' : '自动合并结果预览'}
            value={history.resolvedContent}
            tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          />
        </section>
      )}

      {history.conflicts.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50/60 p-4" aria-label="合并冲突列表">
          <div>
            <h3 className="text-sm font-semibold text-amber-900">服务端返回 {history.conflicts.length} 个合并冲突</h3>
            <p className="mt-1 text-xs text-amber-800">逐字段明确选择一项；未选择的字段不会提交。</p>
          </div>
          {history.conflicts.map((conflict, index) => (
            <fieldset key={conflict.path} className="rounded-xl border border-amber-200 bg-white p-3">
              <legend className="px-1 font-mono text-xs font-semibold text-slate-800">冲突字段：{conflict.path}</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {choiceLabels.map((choice) => (
                  <label
                    key={choice.value}
                    className={cn(
                      'cursor-pointer rounded-xl border p-3 transition-colors',
                      history.resolutions[conflict.path] === choice.value
                        ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                        : 'border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <input
                        type="radio"
                        name={`conflict-${index}`}
                        value={choice.value}
                        checked={history.resolutions[conflict.path] === choice.value}
                        onChange={() => history.chooseConflict(conflict.path, choice.value)}
                        aria-label={`${conflict.path} 选择 ${choice.label}`}
                      />
                      {choice.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{choice.hint}</span>
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700">
                      {formatValue(conflict[choice.value])}
                    </pre>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-amber-800">
              {allConflictsResolved ? '所有冲突均已选择，可以提交。' : '请为每个字段选择 Base、Current 或 Incoming。'}
            </span>
            <Button type="button" size="sm" loading={history.pendingAction === 'resolve'} disabled={busy || !allConflictsResolved} onClick={() => void resolve()}>
              提交选择并完成合并
            </Button>
          </div>
        </section>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />正在处理版本操作，请勿重复提交…
        </div>
      )}
    </div>
  );

  if (mode === 'panel') return body;

  return (
    <>
      {showTrigger && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<History className="h-4 w-4" />}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </Button>
      )}
      <Modal
        open={actualOpen}
        onClose={() => { if (!busy) setOpen(false); }}
        title="草稿版本与分支"
        description="保存主版本、创建分支、回滚，并以 Base / Current / Incoming 三方预览处理合并冲突。"
        size="xl"
      >
        {body}
      </Modal>
    </>
  );
}

export default UnifiedDraftPanel;
