import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ObservationEdit from './ObservationEdit';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    downloadFile: vi.fn(),
    streamPost: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;
const put = api.put as Mock;
const post = api.post as Mock;
const patch = api.patch as Mock;
const downloadFile = api.downloadFile as Mock;
const streamPost = api.streamPost as Mock;

const RECORD = {
  id: 1,
  teacherId: 1,
  teacherName: '王老师',
  topic: '分数加减法',
  lessonType: 'new',
  observedAt: '2026-10-17',
  grade: '小学五年级',
  subject: '数学',
  level: '中等',
  studentName: '李小明',
  classNotes: '老师用通分法讲解，学生反应良好。',
  overallGrade: null,
  status: 'draft',
  teacherReply: '',
  report: null,
  reportAt: null,
  createdAt: '2026-10-17 09:00:00',
  updatedAt: '2026-10-17 09:00:00',
};

const REPORT = '【综合评价与建议】\n四、总体评价等级：优秀';

function renderEdit() {
  return renderWithProviders(<ObservationEdit />, { route: '/observations/1', path: '/observations/:id' });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) =>
    path === '/teachers' ? { teachers: [] } : { observation: RECORD }
  );
  put.mockResolvedValue({ observation: { ...RECORD } });
  streamPost.mockImplementation(async (_path: string, _body: any, handlers: any) => {
    handlers.onDone?.({ report: REPORT, suggestedGrade: 'excellent', overallGrade: 'excellent' });
  });
});

describe('生成前选定总体评价等级', () => {
  it('报告还没生成时，等级选择器就已可见、四个等级齐备', async () => {
    renderEdit();
    await screen.findByText(/还没有评课报告/);

    for (const g of ['优秀', '良好', '合格', '有待提高']) {
      expect(screen.getByRole('button', { name: new RegExp(g) })).toBeInTheDocument();
    }
    // 说明文案要让老师明白：选等级影响的是 AI 写的内容，不只是最后一行结论
    expect(screen.getByText(/AI 会按这个等级写评课内容和优化建议/)).toBeInTheDocument();
  });

  it('选中的等级以 aria-pressed 暴露，再点一次取消', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByText(/还没有评课报告/);

    const btn = screen.getByRole('button', { name: /有待提高/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    await user.click(btn);
    expect(screen.getByRole('button', { name: /有待提高/, pressed: true })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /有待提高/, pressed: true }));
    expect(screen.getByRole('button', { name: /有待提高/, pressed: false })).toBeInTheDocument();
  });

  it('点「AI 生成评课」时，选定等级随请求下发给后端', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByText(/还没有评课报告/);

    await user.click(screen.getByRole('button', { name: /有待提高/ }));
    await user.click(screen.getByRole('button', { name: /AI 生成评课/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalledTimes(1));
    const [path, body] = streamPost.mock.calls[0];
    expect(path).toBe('/observations/1/report/stream');
    expect(body).toEqual({ overallGrade: 'needs_work' });
  });

  it('没选等级时不下发等级，回退让 AI 自行判断', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByText(/还没有评课报告/);

    await user.click(screen.getByRole('button', { name: /AI 生成评课/ }));
    await waitFor(() => expect(streamPost).toHaveBeenCalledTimes(1));
    expect(streamPost.mock.calls[0][1]).toEqual({});
  });

  it('选定等级时不会在报告区块里再重复放一组等级按钮', async () => {
    renderEdit();
    await screen.findByText(/还没有评课报告/);
    // 全页只有这一组等级按钮
    const gradeButtons = screen.getAllByRole('button').filter((b) =>
      ['优秀', '良好', '合格', '有待提高'].some((g) => b.textContent?.includes(g))
    );
    expect(gradeButtons).toHaveLength(4);
  });
});

describe('评课报告可编辑', () => {
  const savedRecord = { ...RECORD, report: REPORT, reportAt: '2026-10-17 09:30:00' };

  beforeEach(() => {
    get.mockImplementation(async (path: string) =>
      path === '/teachers' ? { teachers: [] } : { observation: savedRecord }
    );
    patch.mockResolvedValue({ report: REPORT + '（改过）' });
    downloadFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'test.docx' });
  });

  it('生成后的报告是可编辑文本框，改字后才出现「保存报告修改」', async () => {
    const user = userEvent.setup();
    renderEdit();

    const box = await screen.findByDisplayValue(/综合评价与建议/, {}, { timeout: 4000 });
    expect(box).toBeEnabled();
    expect(screen.queryByRole('button', { name: /保存报告修改/ })).not.toBeInTheDocument();

    await user.type(box, '（改过）');
    expect(await screen.findByRole('button', { name: /保存报告修改/ })).toBeInTheDocument();
  });

  it('点「保存报告修改」提交 PATCH，成功后按钮消失', async () => {
    const user = userEvent.setup();
    renderEdit();

    const box = await screen.findByDisplayValue(/综合评价与建议/, {}, { timeout: 4000 });
    await user.type(box, '（改过）');
    await user.click(await screen.findByRole('button', { name: /保存报告修改/ }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe('/observations/1/report');
    expect(patch.mock.calls[0][1].report).toContain('（改过）');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /保存报告修改/ })).not.toBeInTheDocument()
    );
  });

  it('下载 Word 前先把未保存的手工改动落库，导出的才是改后版本', async () => {
    const user = userEvent.setup();
    renderEdit();

    const box = await screen.findByDisplayValue(/综合评价与建议/, {}, { timeout: 4000 });
    await user.type(box, '（改过）');
    await user.click(screen.getByRole('button', { name: /下载 Word/ }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(downloadFile.mock.calls[0][0]).toBe('/observations/1/docx');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][1].report).toContain('（改过）');
  });
});

describe('新建记录生成报告：不重复建记录', () => {
  function renderNew() {
    return renderWithProviders(
      <Routes>
        <Route path="/observations/new" element={<ObservationEdit />} />
        <Route path="/observations/:id" element={<ObservationEdit />} />
      </Routes>,
      { route: '/observations/new' }
    );
  }

  beforeEach(() => {
    post.mockResolvedValue({ observation: { ...RECORD, id: 7 } });
    put.mockResolvedValue({ observation: { ...RECORD, id: 7 } });
  });

  it('点生成后自动跳到真实记录地址；再点保存走更新，不再新建', async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByLabelText(/课题/), '分数加减法');
    await user.click(screen.getByRole('button', { name: /AI 生成评课/ }));
    await waitFor(() => expect(streamPost).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    // 流式地址就是刚建好的那条记录
    expect(streamPost.mock.calls[0][0]).toBe('/observations/7/report/stream');

    await user.click(await screen.findByRole('button', { name: /保存修改/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe('/observations/7');
  });

  it('生成完再点重新生成，也只更新同一条记录', async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByLabelText(/课题/), '分数加减法');
    await user.click(screen.getByRole('button', { name: /AI 生成评课/ }));
    await waitFor(() => expect(streamPost).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole('button', { name: /重新生成/ }));
    await waitFor(() => expect(streamPost).toHaveBeenCalledTimes(2));

    expect(post).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(streamPost.mock.calls[1][0]).toBe('/observations/7/report/stream');
  });
});
