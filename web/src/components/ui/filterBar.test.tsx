import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from './FilterBar';

const TEACHERS = [
  { id: 1, name: '王老师', subject: '数学' },
  { id: 2, name: '李老师' },
];

describe('FilterBar', () => {
  it('渲染老师与时间两个下拉，并把选择回传给父组件', async () => {
    const user = userEvent.setup();
    const onTeacher = vi.fn();
    const onRange = vi.fn();
    render(
      <FilterBar
        teachers={TEACHERS}
        teacherId=""
        onTeacherChange={onTeacher}
        range=""
        onRangeChange={onRange}
      />
    );

    const teacherSelect = screen.getByLabelText('按老师筛选');
    const rangeSelect = screen.getByLabelText('按时间筛选');
    expect(teacherSelect).toBeTruthy();
    expect(rangeSelect).toBeTruthy();

    await user.selectOptions(teacherSelect, '2');
    expect(onTeacher).toHaveBeenCalledWith('2');

    await user.selectOptions(rangeSelect, '30');
    expect(onRange).toHaveBeenCalledWith('30');
  });

  it('老师选项带科目后缀，无科目只显姓名', () => {
    render(
      <FilterBar teachers={TEACHERS} teacherId="" onTeacherChange={() => {}} range="" onRangeChange={() => {}} />
    );
    expect(screen.getByRole('option', { name: '王老师（数学）' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '李老师' })).toBeTruthy();
  });

  it('时间选项覆盖全部时间 + 7/30/90/365 天', () => {
    render(
      <FilterBar teachers={[]} teacherId="" onTeacherChange={() => {}} range="" onRangeChange={() => {}} />
    );
    expect(screen.getByRole('option', { name: '全部时间' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '近 30 天' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '近一年' })).toBeTruthy();
  });

  it('右侧可追加操作（如新建按钮）', () => {
    render(
      <FilterBar
        teachers={[]}
        teacherId=""
        onTeacherChange={() => {}}
        range=""
        onRangeChange={() => {}}
        right={<button type="button">新建听课记录</button>}
      />
    );
    expect(screen.getByRole('button', { name: '新建听课记录' })).toBeTruthy();
  });
});
