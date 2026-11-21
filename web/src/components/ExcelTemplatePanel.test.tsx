import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExcelTemplatePanel } from './ExcelTemplatePanel';
import { api } from '../api/client';
import { saveBlob } from '../lib/utils';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getToken: vi.fn(),
  },
}));

vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/utils')>();
  return { ...actual, saveBlob: vi.fn() };
});

const get = api.get as Mock;
const post = api.post as Mock;
const put = api.put as Mock;
const getToken = api.getToken as Mock;
const saveBlobMock = saveBlob as Mock;

const TEMPLATE = {
  id: 7,
  name: '星火月报模板',
  sheetName: '月报',
  fieldMappings: {
    A1: 'report.student_name',
    B3: 'report.subject',
  },
  createdAt: '2026-11-01 10:00:00',
  updatedAt: '2026-11-01 10:00:00',
};

const XLSX_FILE = new File(
  ['excel-template'],
  '季度月报.xlsx',
  { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
);

const INSPECTION = {
  sheetNames: ['Sheet1', '秋季'],
  sheetName: 'Sheet1',
  rowCount: 5,
  columnCount: 3,
  cells: [
    { address: 'A1', text: '学生姓名' },
    { address: 'C5', text: '学科' },
  ],
  truncated: false,
  maxRows: 30,
  maxColumns: 12,
};

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('找不到模板文件输入框');
  return input;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  getToken.mockReset();
  saveBlobMock.mockReset();
  getToken.mockReturnValue('excel-test-token');
  get.mockResolvedValue({ templates: [TEMPLATE] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Excel 月报模板面板', () => {
  it('上传 xlsx 后自动带出名称，保存时提交 base64、映射和工作表并刷新列表', async () => {
    post.mockImplementation((path: string) => {
      if (path === '/reports/excel-templates/inspect') {
        return Promise.resolve(INSPECTION);
      }
      if (path === '/reports/excel-templates') {
        return Promise.resolve({ template: { ...TEMPLATE, id: 8, name: '秋季月报' } });
      }
      return Promise.reject(new Error('未 mock 的 POST：' + path));
    });
    const user = userEvent.setup();
    const { container } = renderWithProviders(<ExcelTemplatePanel reportId={42} />);
    await screen.findByText('星火月报模板');

    await user.upload(fileInput(container), XLSX_FILE);
    expect(await screen.findByText('季度月报.xlsx')).toBeInTheDocument();
    expect(screen.getByLabelText('模板名称')).toHaveValue('季度月报');

    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '  秋季月报  ' } });
    fireEvent.change(screen.getByLabelText('工作表名'), { target: { value: '  秋季  ' } });
    fireEvent.change(screen.getByLabelText('单元格映射（JSON 对象，键为单元格地址，值为字段路径）'), {
      target: { value: '{"A1":"report.student_name","C5":"report.subject"}' },
    });
    await user.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/reports/excel-templates', {
        name: '秋季月报',
        fileBase64: 'ZXhjZWwtdGVtcGxhdGU=',
        fieldMappings: {
          A1: 'report.student_name',
          C5: 'report.subject',
        },
        sheetName: '秋季',
      });
    });
    expect(await screen.findByText('模板已保存')).toBeInTheDocument();
    expect(screen.getByLabelText('模板名称')).toHaveValue('');
    expect(
      screen.getByLabelText('单元格映射（JSON 对象，键为单元格地址，值为字段路径）')
    ).toHaveValue('');
    expect(screen.queryByText('季度月报.xlsx')).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenNthCalledWith(2, '/reports/excel-templates');
  });

  it('映射 JSON 不合法时给出可见校验错误且不发送创建请求', async () => {
    post.mockImplementation((path: string) => {
      if (path === '/reports/excel-templates/inspect') {
        return Promise.resolve(INSPECTION);
      }
      return Promise.reject(new Error('未 mock 的 POST：' + path));
    });
    const user = userEvent.setup();
    const { container } = renderWithProviders(<ExcelTemplatePanel reportId={42} />);
    await screen.findByText('星火月报模板');

    await user.upload(fileInput(container), XLSX_FILE);
    await screen.findByText('季度月报.xlsx');
    fireEvent.change(screen.getByLabelText('单元格映射（JSON 对象，键为单元格地址，值为字段路径）'), {
      target: { value: '{"A1":' },
    });
    expect(await screen.findByText(/映射 JSON 不合法：/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存模板' }));
    expect(await screen.findByText('请输入合法的单元格映射 JSON')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith('/reports/excel-templates', expect.anything());
  });

  it('预览指定模板并展示后端解析出的单元格映射', async () => {
    post.mockResolvedValue({
      mappings: {
        A1: { type: 'field', path: 'report.student_name' },
        A3: { type: 'loop', path: 'report_items[kind=summary]->content' },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<ExcelTemplatePanel reportId={42} />);
    await screen.findByText('星火月报模板');

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(await screen.findByText('映射解析结果')).toBeInTheDocument();
    expect(screen.getByText('A1 → field · report.student_name')).toBeInTheDocument();
    expect(screen.getByText('A3 → loop · report_items[kind=summary]->content')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/reports/excel-templates/7/preview', {});
    expect(screen.getByRole('button', { name: '预览' })).toBeEnabled();
  });

  it('按当前 reportId 和模板 id 通过 POST fetch 导出，并保存后端返回的文件', async () => {
    const blob = new Blob(['xlsx']);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
      headers: new Headers({ 'content-disposition': "attachment; filename*=UTF-8''report.xlsx" }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ExcelTemplatePanel reportId={42} />);
    await screen.findByText('星火月报模板');

    await user.click(screen.getByRole('button', { name: '套用导出' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/reports/42/excel-templates/7/generate', {
        method: 'POST',
        headers: { Authorization: 'Bearer excel-test-token' },
      });
    });
    expect(getToken).toHaveBeenCalled();
    expect(saveBlobMock).toHaveBeenCalledWith(blob, 'report.xlsx');
    expect(await screen.findByText('已按模板导出 Excel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '套用导出' })).toBeEnabled();
  });
});
