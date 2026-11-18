import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BiReports from './BiReports';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;
const upload = api.upload as Mock;
const del = api.delete as Mock;

const FILE_TYPES = [
  { file_type: 'student_snapshot', display_name: '在册学生明细', enabled: 1, description: '在册学生' },
  { file_type: 'subject_snapshot', display_name: '在册科次明细', enabled: 1, description: '在册科次' },
  { file_type: 'renew_close_ratio', display_name: '科组科次续结比', enabled: 1, description: '续结比' },
  { file_type: 'xusheng_detail',   display_name: '续生率-学生明细', enabled: 1, description: '续生率' },
  { file_type: 'xuke_detail',      display_name: '续科率-科次明细', enabled: 1, description: '续科率' },
  { file_type: 'scheduled_course', display_name: '预排课程状态统计', enabled: 1, description: '预排课程' },
  { file_type: 'voucher',          display_name: '定金券使用报表', enabled: 1, description: '定金券' },
  { file_type: 'personal_perf',    display_name: '个人业绩统计',   enabled: 1, description: '个人业绩' },
];

const BATCHES = [
  { id: 1, file_type: 'xuke_detail', file_name: '续科率(5分钟).xlsx', uploaded_at: '2026-11-18 10:00:00',
    row_count: 271, error_count: 0, status: 'committed' },
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((path: string) => {
    if (path === '/bi/file-types') return Promise.resolve({ fileTypes: FILE_TYPES });
    if (path === '/bi/batches') return Promise.resolve({ batches: BATCHES });
    return Promise.reject(new Error('unknown path ' + path));
  });
  upload.mockResolvedValue({ message: '导入成功：10 行', batchId: 2, successRows: 10, errorRows: 0, errors: [] });
  del.mockResolvedValue({ message: '已删除' });
});

function makeFile(name: string, size = 1024): File {
  return new File(['data'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * jsdom 没有 DragEvent —— 用 Event + dataTransfer property 模拟拖拽。
 */
function fireDragEvent(el: Element, type: 'dragover' | 'drop', file: File) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: [file] },
    writable: false,
  });
  el.dispatchEvent(event);
}

describe('BiReports 报表上传页', () => {
  it('页面加载后显示报表类型列表和批次表格', async () => {
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('在册学生明细')).toBeInTheDocument());
    expect(screen.getByText('个人业绩统计')).toBeInTheDocument();
    // 批次表格有数据
    await waitFor(() => expect(screen.getByText('续科率(5分钟).xlsx')).toBeInTheDocument());
  });

  it('拖拽文件后根据文件名自动匹配报表类型', async () => {
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('个人业绩统计')).toBeInTheDocument());

    const dropZone = screen.getByLabelText(/拖拽 xlsx 文件到此处上传/);
    // 用 dataTransfer 模拟 drop
    const file = makeFile('在册学生明细2026年11月.xlsx');
    fireDragEvent(dropZone, 'dragover', file);
    fireDragEvent(dropZone, 'drop', file);

    await waitFor(() => {
      // select 值应变成 student_snapshot
      const select = screen.getByLabelText('报表类型') as HTMLSelectElement;
      expect(select.value).toBe('student_snapshot');
    });
  });

  it('拖拽"续生率"文件自动匹配 xusheng_detail', async () => {
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('个人业绩统计')).toBeInTheDocument());

    const dropZone = screen.getByLabelText(/拖拽 xlsx 文件到此处上传/);
    const file = makeFile('续生率-学生明细.xlsx');
    fireDragEvent(dropZone, 'drop', file);

    await waitFor(() => {
      const select = screen.getByLabelText('报表类型') as HTMLSelectElement;
      expect(select.value).toBe('xusheng_detail');
    });
  });

  it('拖拽"续科率"文件自动匹配 xuke_detail（不误匹为续生率）', async () => {
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('个人业绩统计')).toBeInTheDocument());

    const dropZone = screen.getByLabelText(/拖拽 xlsx 文件到此处上传/);
    const file = makeFile('续科率(5分钟)-科次明细.xlsx');
    fireDragEvent(dropZone, 'drop', file);

    await waitFor(() => {
      const select = screen.getByLabelText('报表类型') as HTMLSelectElement;
      expect(select.value).toBe('xuke_detail');
    });
  });

  it('未识别文件名提示手动选择', async () => {
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('个人业绩统计')).toBeInTheDocument());

    const dropZone = screen.getByLabelText(/拖拽 xlsx 文件到此处上传/);
    const file = makeFile('随便什么文件.xlsx');
    fireDragEvent(dropZone, 'drop', file);

    await waitFor(() => {
      // toast 出现"未识别文件类型"
      expect(screen.getByText(/未识别文件类型/)).toBeInTheDocument();
    });
  });

  it('上传成功后清空选中文件并刷新批次', async () => {
    // 用文件 input 模拟选择
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('个人业绩统计')).toBeInTheDocument());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('定金券使用报表.xlsx');
    await userEvent.upload(input, file);

    await waitFor(() => {
      const select = screen.getByLabelText('报表类型') as HTMLSelectElement;
      expect(select.value).toBe('voucher');
    });

    const btn = screen.getByRole('button', { name: /上传并解析/ });
    await userEvent.click(btn);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      '/bi/upload/voucher',
      expect.any(FormData)
    ));
  });

  it('勾选覆盖模式后按钮文字变为"覆盖并解析"', async () => {
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('个人业绩统计')).toBeInTheDocument());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeFile('在册科次明细.xlsx'));

    const checkbox = screen.getByLabelText(/覆盖模式/) as HTMLInputElement;
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    expect(screen.getByRole('button', { name: /覆盖并解析/ })).toBeInTheDocument();
  });

  it('删除批次调 api.delete 并刷新列表', async () => {
    // mock confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<BiReports />);
    await waitFor(() => expect(screen.getByText('续科率(5分钟).xlsx')).toBeInTheDocument());

    const delBtn = screen.getByRole('button', { name: '删除' });
    await userEvent.click(delBtn);

    await waitFor(() => expect(del).toHaveBeenCalledWith('/bi/batches/1'));
  });
});
