import { describe, expect, it } from 'vitest';
import { serializeCsv } from './exportCsv';

describe('续费当前结果 CSV 导出', () => {
  const columns = [
    { label: '教师', value: (row: { name: string; note: string; delta: number | null }) => row.name },
    { label: '备注', value: (row: { name: string; note: string; delta: number | null }) => row.note },
    { label: '差额', value: (row: { name: string; note: string; delta: number | null }) => row.delta },
  ];

  it('保留真实零和负数，缺失值为空并正确转义', () => {
    const csv = serializeCsv(columns, [
      { name: '张老师,理科', note: '他说"你好"', delta: 0 },
      { name: '李老师', note: '下一行\n继续', delta: -2 },
      { name: '王老师', note: '', delta: null },
    ]);
    expect(csv).toContain('"张老师,理科","他说""你好""",0');
    expect(csv).toContain('李老师,"下一行\n继续",-2');
    expect(csv).toContain('王老师,,');
  });

  it('文本公式前缀只作为文本导出', () => {
    const csv = serializeCsv(columns, [{ name: '=1+1', note: '@SUM(A1:A2)', delta: -1 }]);
    expect(csv).toContain("'=1+1,'@SUM(A1:A2),-1");
  });
});
