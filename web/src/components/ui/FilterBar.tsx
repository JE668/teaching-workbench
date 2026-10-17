import React from 'react';
import { Select } from './Field';
import { RANGE_OPTIONS, type RangeKey } from '../../lib/dateRange';

/** 看板筛选条里的老师条目 */
export interface FilterTeacher {
  id: number;
  name: string;
  subject?: string | null;
}

interface FilterBarProps {
  teachers: FilterTeacher[];
  teacherId: string;
  onTeacherChange: (value: string) => void;
  range: RangeKey;
  onRangeChange: (value: RangeKey) => void;
  /** 右侧追加内容（如"新建"按钮） */
  right?: React.ReactNode;
}

/**
 * 看板通用筛选条：按老师 + 按时间。
 *
 * 老师统计 / 回复闭环两个看板共用，避免各写一套样式与选项。
 */
export function FilterBar({
  teachers,
  teacherId,
  onTeacherChange,
  range,
  onRangeChange,
  right,
}: FilterBarProps) {
  const teacherOptions = teachers.map((t) => ({
    value: String(t.id),
    label: t.subject ? t.name + '（' + t.subject + '）' : t.name,
  }));

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={teacherId}
          onChange={(e) => onTeacherChange(e.target.value)}
          options={teacherOptions}
          placeholder="全部老师"
          className="h-9 w-44 text-xs"
          aria-label="按老师筛选"
        />
        <Select
          value={range}
          onChange={(e) => onRangeChange(e.target.value as RangeKey)}
          options={RANGE_OPTIONS}
          className="h-9 w-28 text-xs"
          aria-label="按时间筛选"
        />
      </div>
      {right}
    </div>
  );
}
