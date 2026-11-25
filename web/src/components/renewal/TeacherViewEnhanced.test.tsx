import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import TeacherViewEnhanced from './TeacherViewEnhanced';
import type { MentorMatrix, TeacherStatRow } from '../../lib/renewal';

function teacherRow(overrides: Partial<TeacherStatRow> = {}): TeacherStatRow {
  return {
    tab: 'stage',
    teacherName: '教师A',
    teacherNo: 'T1',
    subjectGroup: '理科',
    baseCount: 16,
    prepaidCount: 6,
    prepaidRate: 37.5,
    renewedCount: null,
    renewRate: null,
    incentiveGap: null,
    extra: {
      enroll_nongrad: 12,
      prepaid_nongrad: 5,
      enroll_g9: 4,
      prepaid_g9: 1,
      enroll_g12: 0,
      prepaid_g12: 0,
    },
    studentCount: 2,
    students: [
      { name: '学生甲', status: 'prepaid', slot: 0 },
      { name: '学生乙', status: 'renewed', slot: 1 },
    ],
    ...overrides,
  };
}

function Fixture({ rows, initialTab = 'stage', mentorMatrix }: {
  rows: TeacherStatRow[];
  initialTab?: string;
  mentorMatrix?: MentorMatrix;
}) {
  const [tab, setTab] = useState(initialTab);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleTeacher = (name: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <TeacherViewEnhanced
      rows={rows}
      tab={tab}
      setTab={setTab}
      expanded={expanded}
      toggleTeacher={toggleTeacher}
      mentorMatrix={mentorMatrix}
    />
  );
}

function mentorMatrixWithSixManagers(): MentorMatrix {
  const managers = Array.from({ length: 6 }, (_, index) => `学管${index + 1}`);
  return {
    teachers: ['教师A'],
    managers,
    cells: managers.map((managerName, index) => ({
      teacherName: '教师A',
      managerName,
      studentCount: index + 1,
      prepaidCount: 0,
      renewedCount: 0,
      prepaidRate: 0,
      renewRate: 0,
      students: [],
    })),
    totalPrepaid: 0,
    totalRenewed: 0,
    totalStudents: 21,
  };
}

describe('TeacherViewEnhanced', () => {
  it('默认隐藏学生色块，点击后仅在一处展示并可再次收起', async () => {
    const user = userEvent.setup();
    render(<Fixture rows={[teacherRow()]} />);

    expect(screen.queryByText('学生甲')).not.toBeInTheDocument();
    expect(screen.queryByText('学生乙')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '学生状态' })).not.toBeInTheDocument();

    const showButton = screen.getByRole('button', { name: '查看 2 名学生明细' });
    expect(showButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(showButton);

    expect(screen.getAllByRole('list', { name: '学生状态' })).toHaveLength(1);
    expect(screen.getAllByText('学生甲')).toHaveLength(1);
    expect(screen.getAllByText('学生乙')).toHaveLength(1);
    const hideButton = screen.getByRole('button', { name: '收起 2 名学生明细' });
    expect(hideButton).toHaveAttribute('aria-expanded', 'true');

    await user.click(hideButton);
    expect(screen.queryByRole('list', { name: '学生状态' })).not.toBeInTheDocument();
    expect(screen.queryByText('学生甲')).not.toBeInTheDocument();
  });

  it('按同学段预存人数除以在读人数展示比例，0 基数显示占位符', () => {
    render(<Fixture rows={[
      teacherRow({ students: [], studentCount: 0 }),
      teacherRow({
        teacherName: '教师B',
        teacherNo: 'T2',
        students: [],
        studentCount: 0,
        extra: {
          enroll_nongrad: 8,
          prepaid_nongrad: 3,
          enroll_g9: 0,
          prepaid_g9: 0,
          enroll_g12: 0,
          prepaid_g12: 0,
        },
      }),
    ]} />);

    const rates = screen.getByRole('region', { name: '学段预存率' });
    expect(rates).toHaveTextContent('预存人数 ÷ 同学段在读人数');

    const nonGrad = within(rates).getByRole('group', { name: '非毕业班预存率' });
    expect(nonGrad).toHaveTextContent('40.0%');
    expect(nonGrad).toHaveTextContent('预存 8 人 ÷ 在读 20 人');

    const grade9 = within(rates).getByRole('group', { name: '初三预存率' });
    expect(grade9).toHaveTextContent('25.0%');
    expect(grade9).toHaveTextContent('预存 1 人 ÷ 在读 4 人');

    const grade12 = within(rates).getByRole('group', { name: '高三预存率' });
    expect(grade12).toHaveTextContent('—');
    expect(grade12).toHaveTextContent('预存 0 人 ÷ 在读 0 人');
    expect(grade12).toHaveTextContent('在读基数为 0');
    expect(rates).not.toHaveTextContent('NaN');
    expect(rates).not.toHaveTextContent('Infinity');
  });

  it('课时表格与分布图使用同一套五档学生网格口径', () => {
    render(<Fixture
      initialTab="hours"
      rows={[teacherRow({
        tab: 'hours', baseCount: 10, studentCount: 10,
        students: [
          { name: '0-24预存', status: 'prepaid', slot: 1 },
          { name: '0-24在读', status: 'normal', slot: 7 },
          { name: '24-40预存', status: 'prepaid', slot: 9 },
          { name: '40-60续费', status: 'renewed', slot: 19 },
          { name: '40-60在读', status: 'normal', slot: 22 },
          { name: '60-80预存', status: 'prepaid', slot: 24 },
          { name: '80+预存', status: 'prepaid', slot: 29 },
          { name: '80+在读', status: 'normal', slot: 33 },
          { name: '分隔列', status: 'prepaid', slot: 8 },
          { name: '新增续费网格', status: 'prepaid', slot: 35 },
        ],
      })]}
    />);

    const expected = [
      ['0–24', 2, 1], ['24–40', 1, 1], ['40–60', 2, 0], ['60–80', 1, 1], ['80+', 2, 1],
    ] as const;
    for (const [label, enrolled, prepaid] of expected) {
      expect(screen.getByRole('columnheader', { name: `${label}课时在读` })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: `${label}课时预存` })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: `${label} 课时：在读 ${enrolled} 人，预存 ${prepaid} 人` })).toBeInTheDocument();
    }
  });

  it('课时网格完全缺失时保留未知，不显示为 0 人', () => {
    render(<Fixture
      initialTab="hours"
      rows={[teacherRow({ tab: 'hours', baseCount: 5, students: [], studentCount: 0 })]}
    />);
    expect(screen.getByText('当前报表缺少可识别的课时学生网格，空值未按 0 人统计')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /0–24 课时/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '0–24课时在读' })).toBeInTheDocument();
  });

  it('教师×学管矩阵完整展示接口返回的 6 名学管并支持横向滚动', () => {
    const mentorMatrix = mentorMatrixWithSixManagers();
    render(<Fixture rows={[teacherRow({ tab: 'mentor', students: [], studentCount: 0 })]} initialTab="mentor" mentorMatrix={mentorMatrix} />);

    const region = screen.getByRole('region', { name: '教师 × 学管匹配矩阵，可横向滚动' });
    expect(region).toHaveClass('overflow-x-auto');
    const table = within(region).getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8);
    for (const manager of mentorMatrix.managers) {
      expect(within(table).getByRole('columnheader', { name: manager })).toBeInTheDocument();
    }
    expect(within(table).getByText('共 6 名学管')).toBeInTheDocument();
  });
});
