import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'react-router-dom';
import Catalog from './Catalog';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    request: vi.fn(),
    upload: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
    streamPostRaw: vi.fn(),
    downloadFile: vi.fn(),
  },
}));

const request = api.request as Mock;
const upload = api.upload as Mock;
const streamPostRaw = api.streamPostRaw as Mock;
const downloadFile = api.downloadFile as Mock;

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
function mockApi(
  opts: {
    courses?: any[];
    imports?: any[];
    usage?: Record<string, any>;
    /** 按 student_id 返回不同 usage：用来测「换个学生只重拉 usage」 */
    usageByStudent?: Record<string, Record<string, any>>;
    students?: { id: number; name: string }[];
  } = {}
) {
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
    if (path.startsWith('/catalog/usage')) {
      const sid = new URLSearchParams(path.split('?')[1] || '').get('student_id') || '';
      const usage = sid && opts.usageByStudent ? opts.usageByStudent[sid] || {} : opts.usage || {};
      return Promise.resolve({ usage });
    }
    if (path.startsWith('/students')) return Promise.resolve({ students: opts.students || [] });
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

/** 把当前 useSearchParams 渲成文本，用来断言筛选条件真的进了地址栏 */
function UrlProbe() {
  const [sp] = useSearchParams();
  return <div data-testid="url">{sp.toString()}</div>;
}

beforeEach(() => {
  request.mockReset();
  streamPostRaw.mockReset();
  upload.mockReset();
  downloadFile.mockReset();
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
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('人教版').length).toBe(2);
    expect(screen.getByText(/共 2 条/)).toBeInTheDocument();
  });

  it('教材版本可以搜，也可以按教材版本筛选', async () => {
    mockApi({
      courses: [
        makeCourse({ seq: 1, content: '古代诗歌鉴赏', textbook: '部编版' }),
        makeCourse({ seq: 2, content: '记叙文写作', textbook: '人教版' }),
      ],
      imports: [makeImport()],
    });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />);
    await screen.findByText('记叙文写作');

    // 教材版本进了搜索范围：搜「部编」只留 1 条（之前搜不到）
    await user.type(screen.getByPlaceholderText(/搜索辅导内容/), '部编');
    await waitFor(() => expect(screen.queryByText('记叙文写作')).not.toBeInTheDocument());
    expect(screen.getByText('古代诗歌鉴赏')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/搜索辅导内容/));

    // 按教材版本下拉筛选
    await user.selectOptions(screen.getByRole('combobox', { name: '按教材版本筛选' }), '人教版');
    await waitFor(() => expect(screen.queryByText('古代诗歌鉴赏')).not.toBeInTheDocument());
    expect(screen.getByText('记叙文写作')).toBeInTheDocument();
  });

  it('筛选条件写进地址栏，刷新不丢', async () => {
    mockApi({
      courses: [
        makeCourse({ seq: 1, content: '古代诗歌鉴赏', subject: '语文' }),
        makeCourse({ seq: 2, content: '集合与逻辑', subject: '数学' }),
      ],
      imports: [makeImport()],
    });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <UrlProbe />
        <Catalog />
      </>,
      { path: '/catalog', route: '/catalog?grade=高一&subject=数学' }
    );
    // 地址栏来的条件生效：只留数学那条（URLSearchParams 里中文是编码后的，解码断言）
    expect(new URLSearchParams(screen.getByTestId('url').textContent).get('subject')).toBe('数学');
    expect(await screen.findByText('集合与逻辑')).toBeInTheDocument();
    expect(screen.queryByText('古代诗歌鉴赏')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/搜索辅导内容/), '集合');
    await waitFor(() => expect(screen.getByText('集合与逻辑')).toBeInTheDocument());
    // 搜索词也同步写进地址栏
    expect(new URLSearchParams(screen.getByTestId('url').textContent).get('q')).toBe('集合');

    await user.click(screen.getByRole('button', { name: /清空筛选/ }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(''));
    expect(screen.getByText('古代诗歌鉴赏')).toBeInTheDocument();
  });

  it('分组超过一页时分页展示，可展开与收起', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      makeCourse({ seq: i + 1, content: '第 ' + (i + 1) + ' 课' })
    );
    mockApi({ courses: many, imports: [makeImport()] });
    renderWithProviders(<Catalog />);

    const table = await screen.findByRole('table');
    expect(table.querySelectorAll('tbody tr').length).toBe(12);
    expect(screen.getByRole('button', { name: /还有 3 条/ })).toBeInTheDocument();
    expect(screen.queryByText('第 13 课')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /还有 3 条/ }));
    expect(table.querySelectorAll('tbody tr').length).toBe(15);
    expect(screen.getByText('第 13 课')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(table.querySelectorAll('tbody tr').length).toBe(12);
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
    await user.type(screen.getByPlaceholderText(/搜索辅导内容/), '古代诗歌');
    await waitFor(() => expect(screen.queryByText('集合与逻辑')).not.toBeInTheDocument());
    expect(screen.getByText('古代诗歌鉴赏')).toBeInTheDocument();

    // 搜不存在的关键词 → 空状态 + 清空筛选
    await user.clear(screen.getByPlaceholderText(/搜索辅导内容/));
    await user.type(screen.getByPlaceholderText(/搜索辅导内容/), '不存在');
    expect(await screen.findByText('没有匹配的课程')).toBeInTheDocument();
    // 筛选卡里的「清空筛选」和空状态里的都出现，点空状态那个
    const clearButtons = screen.getAllByRole('button', { name: /清空筛选/ });
    expect(clearButtons.length).toBe(2);
    await user.click(clearButtons[clearButtons.length - 1]);
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

  it('内置目录打系统内置标记且不能删，用户导入的显示导入人', async () => {
    mockApi({
      courses: [makeCourse()],
      imports: [
        { ...makeImport({ id: 2, is_builtin: true, importer: '__catalog__', filename: '2026-2027个性化小初全年课程体系目录.xlsx' }), courses_total: 1896, courses_imported: 1896 },
        { ...makeImport({ id: 3, importer: '王老师' }) },
      ],
    });
    renderWithProviders(<Catalog />);

    await screen.findByText('2026-2027个性化小初全年课程体系目录.xlsx');
    expect(screen.getByText('系统内置')).toBeInTheDocument();
    expect(screen.getByText('王老师')).toBeInTheDocument();
    expect(screen.getByText('随镜像发版，不能删除')).toBeInTheDocument();
    // 内置那条没有删除按钮，只有用户自己导入的那条有
    expect(screen.getByTestId('delete-import-3')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-import-2')).toBeNull();
  });
});

describe('掌握星级 · AI 批量定档', () => {
  const user = userEvent.setup();

  it('显示待定档数量并露出 AI 定档按钮', async () => {
    mockApi({
      courses: [
        makeCourse({ subject: '物理', course_type: '专题', mastery_star: null }),
        makeCourse({ subject: '数学', course_type: '专题', mastery_star: 4 }),
      ],
      imports: [makeImport()],
    });
    renderWithProviders(<Catalog />);

    await screen.findByText(/共 2 条/);

    expect(screen.getByText(/待定档/).querySelector('span')?.textContent).toBe('1');
    expect(screen.getByText('AI 定档')).toBeInTheDocument();
  });

  it('当前筛选范围内全部已定档时不出现 AI 定档按钮', async () => {
    mockApi({
      courses: [makeCourse({ subject: '物理', course_type: '专题', mastery_star: 4 })],
      imports: [makeImport()],
    });
    renderWithProviders(<Catalog />);

    await screen.findByText(/共 1 条/);

    expect(screen.getByText(/待定档/).querySelector('span')?.textContent).toBe('0');
    expect(screen.queryByText('AI 定档')).not.toBeInTheDocument();
  });

  it('点 AI 定档按当前筛选范围发请求，回传进度，完成后刷新列表并提示', async () => {
    mockApi({
      courses: [
        makeCourse({ subject: '物理', course_type: '专题', mastery_star: null }),
        makeCourse({ subject: '数学', course_type: '专题', mastery_star: 4 }),
      ],
      imports: [makeImport()],
    });
    renderWithProviders(<Catalog />);
    await screen.findByText(/共 2 条/);

    // 让请求挂起，直到断言完「进行中」的界面再回传事件
    let finish: (() => void) | undefined;
    streamPostRaw.mockImplementation((_path: string, _body: any, handlers: any) => {
      handlers.onEvent?.('start', { total: 1, batches: 1 });
      handlers.onEvent?.('progress', { batch: 1, totalBatches: 1, updated: 1, total: 1 });
      return new Promise<void>((resolve) => {
        finish = () => {
          handlers.onEvent?.('done', { total: 1, batches: 1, updated: 1 });
          resolve();
        };
      });
    });

    await user.click(screen.getByText('AI 定档'));

    expect(streamPostRaw).toHaveBeenCalledTimes(1);
    const [path, body, handlers, signal] = streamPostRaw.mock.calls[0];
    expect(path).toBe('/catalog/courses/suggest-stars');
    expect(body).toEqual({ grade: '', subject: '', term: '', track: '', type: '' });
    expect(typeof handlers.onEvent).toBe('function');
    expect(signal).toBeInstanceOf(AbortSignal);

    // 进行中：按钮转圈、进度面板与取消按钮出现
    expect(screen.getByText('AI 定档中')).toBeInTheDocument();
    expect(screen.getByText(/已定 1 门/)).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();

    await act(async () => {
      finish?.();
    });

    // 完成后提示成功、按钮复位、进度面板收起
    expect(await screen.findByText(/AI 已定档 1 门/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 定档' })).not.toBeDisabled();
    expect(screen.queryByText('AI 定档中')).not.toBeInTheDocument();
    expect(screen.queryByText('取消')).not.toBeInTheDocument();
  });

  it('点取消会中断 AI 定档，且不弹成功提示', async () => {
    mockApi({
      courses: [makeCourse({ subject: '物理', course_type: '专题', mastery_star: null })],
      imports: [makeImport()],
    });
    renderWithProviders(<Catalog />);
    await screen.findByText(/共 1 条/);

    streamPostRaw.mockImplementation((_p: string, _b: any, handlers: any, signal?: AbortSignal) => {
      handlers.onEvent?.('start', { total: 1, batches: 1 });
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });

    await user.click(screen.getByText('AI 定档'));
    expect(screen.getByText('AI 定档中')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();

    await user.click(screen.getByText('取消'));

    await waitFor(() => {
      expect(screen.queryByText('AI 定档中')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'AI 定档' })).not.toBeDisabled();
    });
    expect(screen.queryByText('取消')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 已定档/)).not.toBeInTheDocument();
  });

  it('AI 回传 error 事件时只报错，不弹成功提示', async () => {
    mockApi({
      courses: [makeCourse({ subject: '物理', course_type: '专题', mastery_star: null })],
      imports: [makeImport()],
    });
    renderWithProviders(<Catalog />);
    await screen.findByText(/共 1 条/);

    let finish: (() => void) | undefined;
    streamPostRaw.mockImplementation((_p: string, _b: any, handlers: any) => {
      handlers.onEvent?.('start', { total: 1, batches: 1 });
      return new Promise<void>((resolve) => {
        finish = () => {
          handlers.onEvent?.('error', { error: '模型返回了无法解析的结果' });
          resolve();
        };
      });
    });

    await user.click(screen.getByText('AI 定档'));
    await act(async () => {
      finish?.();
    });

    expect(await screen.findByText('模型返回了无法解析的结果')).toBeInTheDocument();
    expect(screen.queryByText(/AI 已定档/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 定档' })).not.toBeDisabled();
  });
});

describe('目录 ↔ 报告打通', () => {
  it('这门课在月度报告里用过，目录里显示已上/计划，点开看是哪些学生', async () => {
    const user = userEvent.setup();
    const course = makeCourse({ id: 7, content: '声现象' });
    mockApi({
      courses: [course],
      imports: [makeImport()],
      usage: {
        '7': {
          course_id: 7,
          taught: 2,
          planned: 1,
          entries: [
            { report_id: 11, student_id: 1, student_name: '李小明', year_month: '2026-09', kind: 'summary' },
            { report_id: 12, student_id: 2, student_name: '王小红', year_month: '2026-09', kind: 'summary' },
            { report_id: 13, student_id: 1, student_name: '李小明', year_month: '2026-10', kind: 'plan' },
          ],
        },
      },
    });
    renderWithProviders(<Catalog />);
    await screen.findByText('声现象');

    const chip = await screen.findByRole('button', { name: /已上2 · 计划1/ });
    expect(chip).toBeInTheDocument();

    await user.click(chip);
    expect(await screen.findByText('「声现象」上过哪些课')).toBeInTheDocument();
    expect(screen.getByText('已上 2 次 · 计划 1 次')).toBeInTheDocument();
    // 李小明出现两次（9 月已上 + 10 月计划）
    expect(screen.getAllByText('李小明').length).toBe(2);
    expect(screen.getByText('王小红')).toBeInTheDocument();
    expect(screen.getAllByText('已上').length).toBe(2);
    expect(screen.getAllByText('计划').length).toBe(1);
  });

  it('老师旁听过的课显示听课数，明细里标出（听课）', async () => {
    const user = userEvent.setup();
    mockApi({
      courses: [makeCourse({ id: 8, content: '光的反射' })],
      imports: [makeImport()],
      usage: {
        '8': {
          course_id: 8,
          taught: 1,
          planned: 0,
          observed: 2,
          entries: [
            { report_id: 21, student_id: 1, student_name: '李小明', year_month: '2026-09', kind: 'summary', source: 'report' },
            { report_id: 31, student_id: null, student_name: '听课同学', year_month: '2026-10', kind: 'summary', source: 'observation' },
            { report_id: 32, student_id: null, student_name: '', year_month: '2026-10', kind: 'summary', source: 'observation' },
          ],
        },
      },
    });
    renderWithProviders(<Catalog />);
    await screen.findByText('光的反射');

    // 听课数跟已上/计划分开列，计划为 0 时不占位
    const chip = await screen.findByRole('button', { name: /已上1 · 听课2/ });
    expect(chip).toBeInTheDocument();

    await user.click(chip);
    expect(await screen.findByText('「光的反射」上过哪些课')).toBeInTheDocument();
    expect(screen.getByText('已上 1 次 · 听课 2 次')).toBeInTheDocument();
    // 两条旁听都标出（听课），没记学生姓名的回退成「未填姓名」
    expect(screen.getAllByText('（听课）').length).toBe(2);
    expect(screen.getByText('未填姓名')).toBeInTheDocument();
    expect(screen.getAllByText('听课').length).toBe(2);
  });

  it('没有学生上过课时不显示标签', async () => {
    mockApi({ courses: [makeCourse({ content: '声现象' })], imports: [makeImport()], usage: {} });
    renderWithProviders(<Catalog />);
    await screen.findByText('声现象');
    expect(screen.queryByRole('button', { name: /已上|计划/ })).not.toBeInTheDocument();
  });

  it('usage 接口挂了也不影响目录浏览', async () => {
    mockApi({ courses: [makeCourse({ content: '声现象' })], imports: [makeImport()] });
    // 只让 usage 这一个接口失败，其它照常
    const real = request.getMockImplementation()!;
    request.mockImplementation((path: string, init?: any) =>
      path.startsWith('/catalog/usage') ? Promise.reject(new Error('boom')) : real(path, init)
    );
    renderWithProviders(<Catalog />);
    await screen.findByText('声现象');
    expect(screen.queryByRole('button', { name: /已上|计划/ })).not.toBeInTheDocument();
  });
});

describe('按学生看进度', () => {
  const STUDENTS = [
    { id: 11, name: '李小明' },
    { id: 12, name: '王小红' },
  ];

  it('选中学生后行内显示上过哪几个月，汇总行给出已上/计划/未上', async () => {
    const user = userEvent.setup();
    mockApi({
      courses: [
        makeCourse({ id: 1, content: '声现象' }),
        makeCourse({ id: 2, content: '光的反射' }),
        makeCourse({ id: 3, content: '平面镜成像' }),
        makeCourse({ id: 4, content: '凸透镜成像' }),
      ],
      imports: [makeImport()],
      students: STUDENTS,
      usage: {
        '1': {
          course_id: 1,
          taught: 2,
          planned: 0,
          entries: [
            { report_id: 1, student_id: 11, student_name: '李小明', year_month: '2026-09', kind: 'summary' },
            { report_id: 2, student_id: 11, student_name: '李小明', year_month: '2026-10', kind: 'summary' },
          ],
        },
        '2': {
          course_id: 2,
          taught: 1,
          planned: 0,
          entries: [
            { report_id: 3, student_id: 11, student_name: '李小明', year_month: '2026-10', kind: 'summary' },
          ],
        },
        '3': {
          course_id: 3,
          taught: 0,
          planned: 1,
          entries: [
            { report_id: 4, student_id: 11, student_name: '李小明', year_month: '2026-11', kind: 'plan' },
          ],
        },
      },
    });
    renderWithProviders(<Catalog />);

    // 默认是聚合模式：显示「已上2 · 计划0」之类的标签
    await screen.findByRole('button', { name: /已上2/ });
    expect(screen.queryByText('未上')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('按学生查看课程进度'), '11');

    // 切到进度模式：四行分别是 已上×2 / 计划 / 未上
    expect(await screen.findByText('已上 2026-09、2026-10')).toBeInTheDocument();
    expect(screen.getByText('已上 2026-10')).toBeInTheDocument();
    expect(screen.getByText('计划 2026-11')).toBeInTheDocument();
    expect(screen.getByText('未上')).toBeInTheDocument();
    // 汇总行：按「门」数，不是按月份数
    expect(screen.getByText('已上 2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('计划 1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('未上 1', { exact: true })).toBeInTheDocument();
    // 聚合标签在进度模式下不再显示
    expect(screen.queryByRole('button', { name: /已上2/ })).not.toBeInTheDocument();
  });

  it('换一个学生只重拉 usage，不动目录', async () => {
    const user = userEvent.setup();
    mockApi({
      courses: [makeCourse({ id: 1, content: '声现象' })],
      imports: [makeImport()],
      students: STUDENTS,
      usageByStudent: {
        '11': {
          '1': {
            course_id: 1,
            taught: 1,
            planned: 0,
            entries: [
              { report_id: 1, student_id: 11, student_name: '李小明', year_month: '2026-09', kind: 'summary' },
            ],
          },
        },
        '12': {},
      },
    });
    renderWithProviders(<Catalog />);
    await screen.findByText('声现象');

    await user.selectOptions(screen.getByLabelText('按学生查看课程进度'), '11');
    expect(await screen.findByText('已上 2026-09')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('按学生查看课程进度'), '12');
    expect(await screen.findByText('未上')).toBeInTheDocument();
    expect(screen.queryByText('已上 2026-09')).not.toBeInTheDocument();

    // 地址栏带上学生，刷新不丢
    renderWithProviders(<Catalog />, { path: '/catalog', route: '/catalog?student=11' });
    expect(await screen.findByText('已上 2026-09')).toBeInTheDocument();
  });

  it('清空筛选不会把选中的学生清掉', async () => {
    const user = userEvent.setup();
    mockApi({
      courses: [makeCourse({ id: 1, content: '声现象', subject: '物理' })],
      imports: [makeImport()],
      students: STUDENTS,
      usageByStudent: {
        '11': {
          '1': {
            course_id: 1,
            taught: 1,
            planned: 0,
            entries: [
              { report_id: 1, student_id: 11, student_name: '李小明', year_month: '2026-09', kind: 'summary' },
            ],
          },
        },
      },
    });
    renderWithProviders(<Catalog />, { path: '/catalog', route: '/catalog?subject=物理&student=11' });

    await screen.findByText('声现象');
    expect(await screen.findByText('已上 2026-09')).toBeInTheDocument();

    const clear = screen.getAllByRole('button', { name: /清空筛选/ });
    await user.click(clear[clear.length - 1]);

    // 学生还在，进度还在
    expect(await screen.findByText('已上 2026-09')).toBeInTheDocument();
    expect(screen.getByText('全部学科')).toBeInTheDocument();
  });

  it('没有学生时不显示「看谁进度」这一栏', async () => {
    mockApi({ courses: [makeCourse({ content: '声现象' })], imports: [makeImport()] });
    renderWithProviders(<Catalog />);
    await screen.findByText('声现象');
    expect(screen.queryByLabelText('按学生查看课程进度')).not.toBeInTheDocument();
  });
});


describe('目录导出与打印', () => {
  it('导出按钮把当前筛选条件带给后端，下载后提示条数', async () => {
    const user = userEvent.setup();
    mockApi({
      courses: [makeCourse({ content: '古代诗歌鉴赏' }), makeCourse({ content: '记叙文写作', seq: 2 })],
      imports: [makeImport()],
    });
    downloadFile.mockResolvedValue({
      blob: new Blob(['xlsx-bytes']),
      filename: '课程目录 高一语文 暑假 共2课.xlsx',
    });
    renderWithProviders(<Catalog />);

    const btn = await screen.findByRole('button', { name: /导出 Excel/ });
    await user.click(btn);

    expect(downloadFile).toHaveBeenCalledWith('/catalog/xlsx');
    expect(await screen.findByText('已导出 2 门课')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 Excel' })).toBeEnabled();
  });

  it('筛选条件在地址栏里，导出请求跟着带上', async () => {
    const user = userEvent.setup();
    mockApi({ courses: [makeCourse({})], imports: [makeImport()] });
    downloadFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'f.xlsx' });
    // 初始路由就带筛选条件，模拟「先筛选再导出」
    renderWithProviders(<Catalog />, { route: '/?grade=高一&term=暑假' });
    await screen.findByText('古代诗歌鉴赏');

    await user.click(await screen.findByRole('button', { name: /导出 Excel/ }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/catalog/xlsx?grade=%E9%AB%98%E4%B8%80&term=%E6%9A%91%E5%81%87'
    );
  });

  it('没有任何课程时导出按钮不可点', async () => {
    mockApi({ courses: [], imports: [makeImport()] });
    renderWithProviders(<Catalog />);
    await screen.findByText('没有匹配的课程');
    expect(screen.getByRole('button', { name: /导出 Excel/ })).toBeDisabled();
  });

  it('导出失败给出错误提示，按钮恢复可点', async () => {
    const user = userEvent.setup();
    mockApi({ courses: [makeCourse({})], imports: [makeImport()] });
    downloadFile.mockRejectedValue(new Error('网络中断'));
    renderWithProviders(<Catalog />);

    await user.click(await screen.findByRole('button', { name: /导出 Excel/ }));
    expect(await screen.findByText('网络中断')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 Excel' })).toBeEnabled();
  });
});
