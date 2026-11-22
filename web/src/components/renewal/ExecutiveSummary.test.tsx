import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ExecutiveSummary from './ExecutiveSummary';
import type { TeacherStatRow } from '../../lib/renewal';

function teacherRow(overrides: Partial<TeacherStatRow> = {}): TeacherStatRow {
  return {
    tab: 'stage', teacherName: '教师A', teacherNo: 'T1', subjectGroup: '理科',
    baseCount: 10, prepaidCount: 0, prepaidRate: 0,
    renewedCount: null, renewRate: null, incentiveGap: null,
    extra: {}, studentCount: 0, students: [], ...overrides,
  };
}

function card(label: string) {
  const element = screen.getByText(label).closest('.rounded-2xl');
  if (!element) throw new Error(`KPI card not found: ${label}`);
  return within(element as HTMLElement);
}

describe('ExecutiveSummary', () => {
  it('区分源表真实 0 与缺失列，并明确总预存口径', () => {
    render(
      <ExecutiveSummary
        teacherRows={[teacherRow()]}
        managerRows={[]}
        reportId={1}
        reports={[]}
        currentTab="stage"
      />,
    );

    expect(card('学生基数').getByText('10')).toBeInTheDocument();
    expect(card('已预存').getByText('0')).toBeInTheDocument();
    expect(card('已预存').getByText(/总预存（含毕业班）/)).toBeInTheDocument();
    expect(card('已续科').getByText('—')).toBeInTheDocument();
    expect(card('已续科').getByText('源表未提供此列')).toBeInTheDocument();
    expect(card('80%目标差额').getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/整体续科率仅/)).not.toBeInTheDocument();
  });
});
