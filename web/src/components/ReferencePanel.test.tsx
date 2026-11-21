import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ReferencePanel } from './ReferencePanel';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), request: vi.fn() } }));
const get = api.get as Mock;
const post = api.post as Mock;

const baseReference = {
  id: 8,
  source_type: 'report',
  source_id: 3,
  target_type: 'observation',
  target_id: 12,
  ref_role: 'derives_from',
  created_at: '2026-11-01 08:00:00',
  target: { id: 12, title: '分数复习听评课', created_at: '2026-11-01 08:00:00' },
};

function installReferenceMock(pendingEvents: unknown[] = []) {
  get.mockImplementation(async (path: string) => {
    if (path === '/content/references/outgoing/report/3') {
      return { references: [{ ...baseReference, pendingEvents }] };
    }
    if (path === '/content/references/incoming/report/3') return { references: [] };
    throw new Error('unexpected GET ' + path);
  });
}

describe('ReferencePanel', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows source changes and syncs the selected observation field into the report', async () => {
    let pending: unknown[] = [
      { id: 2, entity_type: 'observation', entity_id: 12, changed_fields: '["updated"]', version: 2, notified: false, created_at: '2026-11-02 09:00:00' },
      { id: 1, entity_type: 'observation', entity_id: 12, changed_fields: '["created"]', version: 1, notified: false, created_at: '2026-11-01 08:00:00' },
    ];
    get.mockImplementation(async (path: string) => {
      if (path === '/content/references/outgoing/report/3') return { references: [{ ...baseReference, pendingEvents: pending }] };
      if (path === '/content/references/incoming/report/3') return { references: [] };
      throw new Error('unexpected GET ' + path);
    });
    post.mockImplementation(async () => {
      pending = [];
      return { referenceId: 8, reportId: 3, targetField: 'plan_intro', content: '最新课堂笔记', syncedEventId: 2 };
    });
    const onSync = vi.fn();
    renderWithProviders(<ReferencePanel entityType="report" entityId={3} onSync={onSync} />);

    expect(await screen.findByText('来源有 2 次更新')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('同步来源字段'), { target: { value: 'class_notes' } });
    fireEvent.change(screen.getByLabelText('同步目标区块'), { target: { value: 'plan_intro' } });
    fireEvent.click(screen.getByRole('button', { name: /同步最新内容/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/content/references/8/sync', { targetField: 'plan_intro', sourceField: 'class_notes' }));
    expect(onSync).toHaveBeenCalledWith(expect.objectContaining({ reportId: 3, content: '最新课堂笔记' }));
    expect(await screen.findByRole('button', { name: /同步内容/ })).toBeInTheDocument();
  });

  it('searches real recent observations and creates a reference from the selected result', async () => {
    installReferenceMock();
    get.mockImplementation(async (path: string) => {
      if (path === '/content/references/outgoing/report/3') return { references: [] };
      if (path === '/content/references/incoming/report/3') return { references: [] };
      if (path === '/observations?page=1&pageSize=50') {
        return { observations: [{ id: 12, topic: '分数复习听评课', created_at: '2026-11-01 08:00:00' }] };
      }
      throw new Error('unexpected GET ' + path);
    });
    post.mockResolvedValue({ success: true, refId: 9 });
    renderWithProviders(<ReferencePanel entityType="report" entityId={3} />);

    fireEvent.click(await screen.findByRole('button', { name: /添加引用/ }));
    const result = await screen.findByRole('button', { name: /分数复习听评课/ });
    fireEvent.click(result);
    expect(screen.getByPlaceholderText('选择上方记录或输入明确 ID')).toHaveValue(12);
    fireEvent.click(screen.getByRole('button', { name: '创建引用' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/content/references', {
      sourceType: 'report', sourceId: 3, targetType: 'observation', targetId: 12, refRole: 'cites',
    }));
  });
});
