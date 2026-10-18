import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Catalog from './Catalog';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    request: vi.fn(),
    upload: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const request = api.request as Mock;
const upload = api.upload as Mock;

const FACETS = {
  grades: ['高一'],
  subjects: ['语文', '数学'],
  terms: ['暑假'],
  types: ['专题'],
  tracks: [],
  textbooks: ['人教版'],
};

let courseSeq = 100;

function makeCourse(overrides: Record<string, unknown> = {}) {
  courseSeq += 1;
  return {
    id: courseSeq,
    import_id: 1,
    band: '高中',
    term: '暑假',
    grade: '高一',
    subject: '语文',
    track: '',
    seq: 1,
    content: '古代诗歌鉴赏',
    type: '专题',
    score: '',
    difficulty: '★★',
    impact: '★★★',
    textbook: '人教版',
    section: '',
    sheet: '高一语文',
    source_row: 5,
    mastery_star: null,
    created_at: '2026-10-18 10:00:00',
    updated_at: '2026-10-18 10:00:00',
    ...overrides,
  };
}

function makeImport(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    band: '高中',
    filename: '全年课程体系目录.xlsx',
    file_sha256: 'a'.repeat(64),
    courses_total: 3585,
    courses_imported: 3585,
    courses_duplicated: 0,
    failed_sheets: [],
    created_at: '2026-10-18 10:00:00',
    ...overrides,
  };
}

/** 统一 mock 掉页面用到的所有接口 */
function mockApi(opts: { courses?: any[]; imports?: any[] } = {}) {
  const courses = opts.courses || [];
  const imports = opts.imports || [];
  request.mockImplementation((path: string, init?: any) => {
    if (path.startsWith('/catalog/facets')) return Promise.resolve(FACETS);
    if (path.startsWith('/catalog/courses/') && init?.method === 'PATCH') {
      return Promise.resolve({ course: { mastery_star: JSON.parse(init.body).mastery_star } });
    }
    if (path.startsWith('/catalog/courses')) {
      return Promise.resolve({ courses, total: courses.length });
    }
    if (path.startsWith('/catalog/imports/') && init?.method === 'DELETE') {
      return Promise.resolve({ deleted: courses.length });
    }
    if (path.startsWith('/catalog/imports')) return Promise.resolve({ imports });
    return Promise.reject(new Error('unexpected ' + path));
  });
}

const XLSX_FILE = new File(
  ['xlsx-bytes'],
  '全年课程体系目录.xlsx',
  { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
);

/** 页头和空状态各有一个「导入目录」按钮，取页头那个（DOM 在前） */
function importButton(): HTMLElement {
  return screen.getAllByRole('button', { name: /导入目录/ })[0];
}

async function openImportDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(importButton());
  return (await screen.findByText('导入全年课程体系目录')).closest('.fixed') as HTMLElement;
}

beforeEach(() => {
  request.mockReset();
  upload.mockReset();
});

describe('课程目录页', () => {
  it('还没有导入时显示空状态', async () => {
    mockApi();
    renderWithProviders(<Catalog />);

    expect(await screen.findByText('还没有课程目录')).toBeInTheDocument();
    expect(screen.getByText('从「全年课程体系目录」Excel 批量导入，供课程总结与课程规划取数')).toBeInTheDocument();
  });

  it('有数据时按「年级学科·学期」分组展示课程', async () => {
    mockApi({
      courses: [
        makeCourse({ seq: 1, content: '古代诗歌鉴赏' }),
        makeCourse({ seq: 2, content: '记叙文写作', mastery_star: 4 }),
      ],
      imports: [makeImport()],
    });
    renderWithProviders(<Catalog />);

    expect(await screen.findByText('高一语文 · 暑假')).toBeInTheDocument();
    expect(screen.getByText('古代诗歌鉴赏')).toBeInTheDocument();
    expect(screen.getByText('记叙文写作')).toBeInTheDocument();
    expect(screen.getAllByText('人教版').length).toBe(2);
    expect(screen.getByText(/共 2 条/)).toBeInTheDocument();
  });

  it('关键词筛选生效，无结果时可一键清空', async () => {
    mockApi({
      courses: [
        makeCourse({ content: '古代诗歌鉴赏', subject: '语文' }),
        makeCourse({ content: '集合与逻辑', subject: '数学' }),
      ],
      imports: [makeImport()],
    });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    await screen.findByText('集合与逻辑');

    // 搜「古代诗歌」只剩 1 条
    await user.type(screen.getByPlaceholderText('搜索辅导内容'), '古代诗歌');
    await waitFor(() => expect(screen.queryByText('集合与逻辑')).not.toBeInTheDocument());
    expect(screen.getByText('古代诗歌鉴赏')).toBeInTheDocument();

    // 搜不存在的关键词 → 空状态 + 清空筛选
    await user.clear(screen.getByPlaceholderText('搜索辅导内容'));
    await user.type(screen.getByPlaceholderText('搜索辅导内容'), '不存在');
    expect(await screen.findByText('没有匹配的课程')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /清空筛选/ }));
    await waitFor(() => expect(screen.getByText('集合与逻辑')).toBeInTheDocument());
    expect(screen.getByText('古代诗歌鉴赏')).toBeInTheDocument();
  });

  it('点击星星可以设置掌握星级，并会请求后端保存', async () => {
    mockApi({ courses: [makeCourse({ content: '古代诗歌鉴赏', mastery_star: null })], imports: [makeImport()] });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    await screen.findByText('古代诗歌鉴赏');

    const editor = screen.getByTestId('star-editor');
    await user.click(within(editor).getAllByRole('button')[3]);

    await waitFor(() => {
      const patch = request.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toContain('/catalog/courses/');
      expect(JSON.parse(patch![1].body)).toEqual({ mastery_star: 4 });
    });
  });

  it('点击已点亮的星星可以取消星级', async () => {
    mockApi({ courses: [makeCourse({ content: '古代诗歌鉴赏', mastery_star: 3 })], imports: [makeImport()] });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    await screen.findByText('古代诗歌鉴赏');

    // 再点第 3 颗（当前值）→ 取消
    await user.click(within(screen.getByTestId('star-editor')).getAllByRole('button')[2]);

    await waitFor(() => {
      const patch = request.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(JSON.parse(patch![1].body)).toEqual({ mastery_star: null });
    });
  });

  it('预览模式只发 dryRun，不导入', async () => {
    mockApi();
    upload.mockResolvedValue({
      dryRun: true,
      filename: '全年课程体系目录.xlsx',
      band: '高中',
      coursesTotal: 12,
      failedSheets: [],
      sheets: [
        { sheet: '高一语文', grade: '高一', subject: '语文', courses: 6 },
        { sheet: '高一数学', grade: '高一', subject: '数学', courses: 6 },
      ],
    });

    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    const dialog = await openImportDialog(user);

    await user.upload(within(dialog).getByTestId('catalog-file-input'), XLSX_FILE);
    await user.click(within(dialog).getByRole('button', { name: '仅预览' }));

    expect(await within(dialog).findByText('预览结果')).toBeInTheDocument();
    expect(within(dialog).getByText('12 条课程')).toBeInTheDocument();
    expect(within(dialog).getByText('全部 sheet 解析成功')).toBeInTheDocument();
    expect(within(dialog).getAllByText('OK').length).toBe(2);

    const fd = upload.mock.calls[0][1] as FormData;
    expect(fd.get('band')).toBe('高中');
    expect(fd.get('dryRun')).toBe('1');
    expect(fd.get('file')).toBeInstanceOf(File);
  });

  it('正式导入成功后刷新列表并出现导入历史', async () => {
    mockApi();
    upload.mockResolvedValue({
      importId: 1,
      filename: '全年课程体系目录.xlsx',
      band: '高中',
      sha256: 'b'.repeat(64),
      coursesTotal: 12,
      coursesImported: 12,
      coursesDuplicated: 0,
      failedSheets: [],
      sheets: [{ sheet: '高一语文', grade: '高一', subject: '语文', courses: 12 }],
    });
    // 重新加载后（导入完成会调 reload）返回导入的数据
    request.mockImplementation((path: string, init?: any) => {
      if (path.startsWith('/catalog/facets')) return Promise.resolve(FACETS);
      if (path.startsWith('/catalog/courses')) {
        const loaded = upload.mock.calls.length > 0;
        return Promise.resolve({
          courses: loaded ? [makeCourse({ content: '古代诗歌鉴赏' })] : [],
          total: loaded ? 1 : 0,
        });
      }
      if (path.startsWith('/catalog/imports')) {
        return Promise.resolve({ imports: upload.mock.calls.length > 0 ? [makeImport()] : [] });
      }
      return Promise.reject(new Error('unexpected ' + path + JSON.stringify(init)));
    });

    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    const dialog = await openImportDialog(user);
    await user.upload(within(dialog).getByTestId('catalog-file-input'), XLSX_FILE);
    await user.click(within(dialog).getByRole('button', { name: '导入' }));

    expect(await within(dialog).findByText('导入结果')).toBeInTheDocument();
    expect(within(dialog).getByText('新增 12')).toBeInTheDocument();

    const fd = upload.mock.calls[0][1] as FormData;
    expect(fd.get('dryRun')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(await screen.findByText('古代诗歌鉴赏')).toBeInTheDocument();
    expect(screen.getByText('全年课程体系目录.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/解析 3585 条/)).toBeInTheDocument();
  });

  it('没有选文件时导入按钮不可点', async () => {
    mockApi();
    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    const dialog = await openImportDialog(user);

    expect(within(dialog).getByRole('button', { name: '仅预览' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '导入' })).toBeDisabled();
  });

  it('导入历史支持删除，并带确认弹窗', async () => {
    mockApi({ courses: [makeCourse()], imports: [makeImport()] });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    await user.click(await screen.findByTestId('delete-import-1'));

    expect(screen.getByText('删除这次导入？')).toBeInTheDocument();
    expect(screen.getByText(/将删除「全年课程体系目录.xlsx」导入的 3585 条课程/)).toBeInTheDocument();

    // 行内也有一个「删除」按钮，确认弹窗里的是确认项，按顺序取最后一个
    await user.click(screen.getAllByRole('button', { name: '删除' })[1]);

    await waitFor(() => {
      const del = request.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del?.[0]).toBe('/catalog/imports/1');
    });
  });
});
