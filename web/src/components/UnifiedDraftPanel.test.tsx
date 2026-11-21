import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UnifiedDraftPanel from './UnifiedDraftPanel';
import {
  buildThreeWayMerge,
  type DraftGraph,
  type DraftVersion,
  type MergeBranchResult,
  useDraftHistory,
} from '../hooks/useDraftHistory';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getToken: vi.fn(() => 'draft-test-token'),
}));

vi.mock('../api/client', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    getToken: mocks.getToken,
  },
}));

interface EditorContent {
  title: string;
  note?: string;
  shared?: string;
  branchOnly?: string;
}

const baseVersion = makeVersion({
  id: 1,
  version: 1,
  content: { title: '基础标题', shared: '共同内容' },
});
const currentVersion = makeVersion({
  id: 2,
  version: 2,
  content: { title: '当前标题', note: '主版本备注', shared: '共同内容' },
});
const branchVersion = makeVersion({
  id: 3,
  version: 3,
  label: '备选分支',
  is_branch: true,
  base_version: 1,
  fork_from: 1,
  content: {
    title: '分支标题',
    note: '主版本备注',
    shared: '共同内容',
    branchOnly: '分支新增内容',
  },
});
const graph: DraftGraph = {
  nodes: [baseVersion, currentVersion, branchVersion].map((version) => ({
    id: version.id,
    version: version.version,
    label: version.label,
    isBranch: version.is_branch,
    forkFrom: version.fork_from,
    createdAt: version.created_at,
  })),
  edges: [
    { from: 1, to: 2 },
    { from: 1, to: 3 },
  ],
};

function makeVersion(
  overrides: Pick<DraftVersion<EditorContent>, 'id' | 'version' | 'content'> &
    Partial<DraftVersion<EditorContent>>,
): DraftVersion<EditorContent> {
  return {
    entity_type: 'report',
    entity_id: 42,
    label: null,
    is_branch: false,
    base_version: null,
    fork_from: null,
    created_at: '2026-11-20 01:00:00',
    updated_at: '2026-11-20 01:00:00',
    ...overrides,
  };
}

function metadata(version: DraftVersion<EditorContent>) {
  return {
    id: version.id,
    entity_type: version.entity_type,
    entity_id: version.entity_id,
    version: version.version,
    label: version.label,
    is_branch: version.is_branch,
    base_version: version.base_version,
    fork_from: version.fork_from,
    created_at: version.created_at,
    updated_at: version.updated_at,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getToken.mockReturnValue('draft-test-token');
  mocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/current')) return { draft: currentVersion };
    if (path.endsWith('/versions')) return { versions: [baseVersion, currentVersion, branchVersion] };
    if (path.endsWith('/graph')) return { graph };
    throw new Error(`Unexpected GET ${path}`);
  });
  mocks.post.mockImplementation(async (path: string) => {
    if (path.endsWith('/rollback')) return { draft: { ...metadata(baseVersion), id: 10, version: 4 } };
    if (path.endsWith('/branch')) return { draft: { ...metadata(branchVersion), id: 11, version: 4 } };
    if (path.endsWith('/resolve-merge')) return { draft: { ...metadata(currentVersion), id: 12, version: 4 } };
    return { draft: { ...metadata(currentVersion), id: 13, version: 4 } };
  });
  fetchMock.mockResolvedValue(jsonResponse(200, { success: true, draftId: 12 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildThreeWayMerge', () => {
  it('matches the server top-level three-way algorithm and reports real conflicts', () => {
    const result = buildThreeWayMerge(
      { title: 'base', main: 'old', same: 'same', removed: 'base' },
      { title: 'current', main: 'new', same: 'same' },
      { title: 'incoming', main: 'old', same: 'changed', removed: 'branch' },
    );

    expect(result.merged).toEqual({
      title: 'current',
      main: 'new',
      same: 'changed',
      removed: undefined,
    });
    expect(result.conflicts).toEqual([
      { path: 'title', base: 'base', current: 'current', incoming: 'incoming' },
      { path: 'removed', base: 'base', current: undefined, incoming: 'branch' },
    ]);
  });
});

describe('useDraftHistory', () => {
  it('loads current, versions and graph, then saves the main draft with its content', async () => {
    const { result } = renderHook(() =>
      useDraftHistory<EditorContent>('report', 42, { title: '编辑器内容' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentDraft?.version).toBe(2);
    expect(result.current.versions).toHaveLength(3);
    expect(result.current.graph.edges).toHaveLength(2);
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual([
      '/unified-drafts/report/42/current',
      '/unified-drafts/report/42/versions',
      '/unified-drafts/report/42/graph',
    ]);

    let saved!: Awaited<ReturnType<typeof result.current.saveMain>>;
    await act(async () => {
      saved = await result.current.saveMain({ title: '新主版本' }, '手动保存');
    });
    expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42', {
      content: { title: '新主版本' },
      label: '手动保存',
    });
    expect(saved?.content).toEqual({ title: '新主版本' });
  });

  it('creates a branch from the selected real version and rolls back with that content', async () => {
    const { result } = renderHook(() => useDraftHistory<EditorContent>('report', 42));
    await waitFor(() => expect(result.current.versions).toHaveLength(3));

    let branched!: Awaited<ReturnType<typeof result.current.createBranch>>;
    await act(async () => {
      branched = await result.current.createBranch(1, '  新分支  ');
    });
    expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42/branch', {
      baseDraftId: 1,
      label: '新分支',
      content: baseVersion.content,
    });
    expect(branched?.content).toEqual(baseVersion.content);

    let rolledBack!: Awaited<ReturnType<typeof result.current.rollback>>;
    await act(async () => {
      rolledBack = await result.current.rollback(1);
    });
    expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42/rollback', { targetVersion: 1 });
    expect(rolledBack?.content).toEqual(baseVersion.content);
  });

  it('preserves 409 conflicts and submits non-conflicting fields plus every explicit choice', async () => {
    const { result } = renderHook(() => useDraftHistory<EditorContent>('report', 42));
    await waitFor(() => expect(result.current.versions).toHaveLength(3));
    const conflicts = [
      { path: 'title', base: '基础标题', current: '当前标题', incoming: '分支标题' },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { success: false, error: '合并冲突', conflicts }));

    let mergeResult: MergeBranchResult<EditorContent>;
    await act(async () => {
      mergeResult = await result.current.mergeBranch(3);
    });
    expect(mergeResult!).toEqual({ status: 'conflict', conflicts });
    expect(result.current.conflicts).toEqual(conflicts);
    expect(result.current.resolvedContent).toEqual({
      title: '当前标题',
      note: '主版本备注',
      shared: '共同内容',
      branchOnly: '分支新增内容',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/unified-drafts/report/42/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer draft-test-token',
      },
      body: JSON.stringify({ branchDraftId: 3 }),
    });

    await act(async () => {
      expect(await result.current.resolveMerge()).toBeNull();
    });
    expect(result.current.error).toContain('请为每个冲突字段');
    expect(mocks.post).not.toHaveBeenCalledWith(
      '/unified-drafts/report/42/resolve-merge',
      expect.anything(),
    );

    act(() => result.current.chooseConflict('title', 'incoming'));
    let resolved!: Awaited<ReturnType<typeof result.current.resolveMerge>>;
    await act(async () => {
      resolved = await result.current.resolveMerge();
    });
    const expectedContent = {
      title: '分支标题',
      note: '主版本备注',
      shared: '共同内容',
      branchOnly: '分支新增内容',
    };
    expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42/resolve-merge', {
      branchDraftId: 3,
      resolvedContent: expectedContent,
    });
    expect(resolved?.content).toEqual(expectedContent);
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.mergePreview).toBeNull();
  });

  it('surfaces loading errors without inventing versions', async () => {
    mocks.get.mockRejectedValue(new Error('服务端不可用'));
    const { result } = renderHook(() => useDraftHistory<EditorContent>('observation', 'new'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('服务端不可用');
    expect(result.current.versions).toEqual([]);
    expect(result.current.currentDraft).toBeNull();
  });
});

describe('UnifiedDraftPanel', () => {
  it('renders the real version tree, creates branches, rolls back and notifies the editor', async () => {
    const onRestore = vi.fn();
    render(
      <UnifiedDraftPanel<EditorContent>
        entityType="report"
        entityId={42}
        currentContent={{ title: '编辑器未保存内容' }}
        onRestore={onRestore}
        mode="panel"
      />,
    );

    expect(await screen.findByText(/当前主版本 v2/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /v3.*备选分支/ })).toBeTruthy();
    expect(screen.getByText('从 #1 · v1 分叉')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保存主版本' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42', {
        content: { title: '编辑器未保存内容' },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /^v1 主版本$/ }));
    fireEvent.click(screen.getByRole('button', { name: /基于此版本创建分支/ }));
    fireEvent.change(screen.getByLabelText('分支名称'), { target: { value: '组件分支' } });
    fireEvent.click(screen.getByRole('button', { name: '创建分支' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42/branch', {
        baseDraftId: 1,
        label: '组件分支',
        content: baseVersion.content,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /^v1 主版本$/ }));
    fireEvent.click(screen.getByRole('button', { name: /回滚到此版本/ }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(baseVersion.content));
    expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42/rollback', { targetVersion: 1 });
  });

  it('shows Base / Current / Incoming, resolves a 409 field-by-field and restores the merged result', async () => {
    const onRestore = vi.fn();
    const conflicts = [
      { path: 'title', base: '基础标题', current: '当前标题', incoming: '分支标题' },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { success: false, error: '合并冲突', conflicts }));
    render(
      <UnifiedDraftPanel<EditorContent>
        entityType="report"
        entityId={42}
        onRestore={onRestore}
        mode="panel"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /v3.*备选分支/ }));
    fireEvent.click(screen.getByRole('button', { name: '三方预览' }));
    expect(await screen.findByText('Base · v1')).toBeTruthy();
    expect(screen.getByText('Current · v2')).toBeTruthy();
    expect(screen.getByText('Incoming · 草稿 #3')).toBeTruthy();
    const preview = screen.getByLabelText('三方合并预览');
    expect(within(preview).getAllByText(/基础标题/).length).toBeGreaterThan(0);
    expect(within(preview).getAllByText(/当前标题/).length).toBeGreaterThan(0);
    expect(within(preview).getAllByText(/分支标题/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /合并到主版本/ }));
    expect(await screen.findByText('服务端返回 1 个合并冲突')).toBeTruthy();
    const submit = screen.getByRole('button', { name: '提交选择并完成合并' });
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('radio', { name: 'title 选择 Incoming' }));
    expect(submit).toHaveProperty('disabled', false);
    fireEvent.click(submit);

    const expectedContent = {
      title: '分支标题',
      note: '主版本备注',
      shared: '共同内容',
      branchOnly: '分支新增内容',
    };
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(expectedContent));
    expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42/resolve-merge', {
      branchDraftId: 3,
      resolvedContent: expectedContent,
    });
  });

  it('autosaves only changed editor content after the debounce interval', async () => {
    const { rerender } = render(
      <UnifiedDraftPanel<EditorContent>
        entityType="report"
        entityId={42}
        currentContent={{ title: '初始内容' }}
        onRestore={vi.fn()}
        autoSave
        autoSaveDelayMs={200}
        mode="panel"
      />,
    );
    expect(await screen.findByText(/当前主版本 v2/)).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();

    rerender(
      <UnifiedDraftPanel<EditorContent>
        entityType="report"
        entityId={42}
        currentContent={{ title: '自动保存的新内容' }}
        onRestore={vi.fn()}
        autoSave
        autoSaveDelayMs={200}
        mode="panel"
      />,
    );
    await waitFor(
      () => expect(mocks.post).toHaveBeenCalledWith('/unified-drafts/report/42', {
        content: { title: '自动保存的新内容' },
        label: '自动保存',
      }),
      { timeout: 1500 },
    );
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('supports a controlled modal and reports open changes', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <UnifiedDraftPanel
        entityType="followup"
        entityId="new"
        open={false}
        onOpenChange={onOpenChange}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.queryByText('保存主版本、创建分支、回滚，并以 Base / Current / Incoming 三方预览处理合并冲突。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '版本与分支' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <UnifiedDraftPanel
        entityType="followup"
        entityId="new"
        open
        onOpenChange={onOpenChange}
        onRestore={vi.fn()}
      />,
    );
    expect(await screen.findByText('保存主版本、创建分支、回滚，并以 Base / Current / Incoming 三方预览处理合并冲突。')).toBeTruthy();
  });
});
