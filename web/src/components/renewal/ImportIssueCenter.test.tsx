import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportIssueCenter, { type ImportErrorRow } from './ImportIssueCenter';
import { downloadCsv } from '../../lib/exportCsv';

vi.mock('../../lib/exportCsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/exportCsv')>();
  return { ...actual, downloadCsv: vi.fn() };
});

const downloadMock = vi.mocked(downloadCsv);
const formulaMessage = '公式缺少缓存结果，相关字段按空值导入';

function makeRows(): ImportErrorRow[] {
  const formulaRows: ImportErrorRow[] = Array.from({ length: 158 }, (_, index) => ({
    sheetName: `教师${(index % 12) + 1}`,
    rowNumber: index + 5,
    columnNumber: (index % 26) + 1,
    errorType: 'formula_cache_missing',
    severity: 'warning',
    errorMessage: formulaMessage,
    fieldName: 'student_grid',
    details: {},
  }));
  return [
    ...formulaRows,
    {
      sheetName: '教师汇总', rowNumber: 8, columnNumber: 4,
      errorType: 'summary_detail_mismatch', severity: 'warning',
      errorMessage: '学段汇总与学生网格不一致', fieldName: 'base_count',
      details: { summaryCount: 306, detailCount: 305 },
    },
    {
      sheetName: '教师汇总', rowNumber: 9, columnNumber: 4,
      errorType: 'summary_detail_mismatch', severity: 'warning',
      errorMessage: '学段汇总与学生网格不一致', fieldName: 'base_count',
      details: { summaryCount: 120, detailCount: 119 },
    },
    {
      sheetName: '教师汇总', rowNumber: 10, columnNumber: 81,
      errorType: 'grid_truncated', severity: 'warning',
      errorMessage: '学生网格超出支持范围', fieldName: 'student_grid', details: {},
    },
  ];
}

function renderCenter(rows = makeRows()) {
  return render(
    <ImportIssueCenter
      reportId={9}
      loading={false}
      rows={rows}
      error=""
      onRetry={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => downloadMock.mockReset());

describe('导入问题分组中心', () => {
  it('161 条问题按类型收敛，缓存警告默认折叠，汇总差异优先展开', async () => {
    renderCenter();
    expect(screen.getByText('导入问题与警告 · 批次 #9')).toBeInTheDocument();
    expect(screen.getByText('公式缓存缺失')).toBeInTheDocument();
    expect(screen.getByText('158 条')).toBeInTheDocument();
    expect(screen.queryByText(formulaMessage)).not.toBeInTheDocument();
    expect(screen.getAllByText('汇总值：306 · 明细值：305')).toHaveLength(1);
    expect(screen.getByText('学生网格超出支持范围')).toBeInTheDocument();

    const user = userEvent.setup();
    const formulaSummary = screen.getByText('公式缓存缺失').closest('summary');
    expect(formulaSummary).not.toBeNull();
    await user.click(formulaSummary!);
    expect(screen.getAllByText(formulaMessage)).toHaveLength(20);
    expect(screen.getAllByText(/全量重算/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '展开全部 158 个位置' }));
    expect(screen.getAllByText(formulaMessage)).toHaveLength(158);
  });

  it('下载包含全部已记录行和定位详情，而非仅当前展开行', async () => {
    const rows = makeRows();
    renderCenter(rows);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '下载已记录问题清单' }));
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [filename, columns, exportedRows] = downloadMock.mock.calls[0];
    expect(filename).toBe('续费导入问题-批次-9.csv');
    expect(exportedRows).toHaveLength(161);
    expect(exportedRows).toBe(rows);
    expect(columns.map((column) => column.label)).toEqual([
      'Sheet', '行号', '列号', '单元格', '字段', '类型', '级别', '差异详情', '原因', '处理建议',
    ]);
    const mismatch = rows[158];
    expect(columns.find((column) => column.label === '差异详情')?.value(mismatch)).toBe('汇总值：306 · 明细值：305');
    expect(columns.find((column) => column.label === '单元格')?.value(mismatch)).toBe('D8');
  });
});
