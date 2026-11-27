import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import TeacherViewEnhanced from './TeacherViewEnhanced';
import type { MentorMatrix, RateOverview, TeacherStatRow } from '../../lib/renewal';

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

function Fixture({ rows, initialTab = 'stage', mentorMatrix, rateOverview }: {
  rows: TeacherStatRow[];
  initialTab?: string;
  mentorMatrix?: MentorMatrix;
  rateOverview?: RateOverview;
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
      rateOverview={rateOverview}
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

  it('同名教师按稳定行身份分别展开学生明细', async () => {
    const user = userEvent.setup();
    render(<Fixture rows={[
      teacherRow({ teacherStatId: 11, studentCount: 1, students: [{ name: '甲老师学生', status: 'prepaid', slot: 0 }] }),
      teacherRow({ teacherStatId: 12, studentCount: 1, students: [{ name: '乙老师学生', status: 'normal', slot: 0 }] }),
    ]} />);
    const buttons = screen.getAllByRole('button', { name: '查看 1 名学生明细' });
    await user.click(buttons[0]);
    expect(screen.getAllByRole('list', { name: '学生状态' })).toHaveLength(1);
    expect(screen.getByText('甲老师学生')).toBeInTheDocument();
    expect(screen.queryByText('乙老师学生')).not.toBeInTheDocument();
    await user.click(buttons[1]);
    expect(screen.getByText('甲老师学生')).toBeInTheDocument();
    expect(screen.getByText('乙老师学生')).toBeInTheDocument();
    expect(screen.getAllByRole('list', { name: '学生状态' })).toHaveLength(2);
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

  it('教师表格与预存 TOP 按率先人数后使用同一顺序，空指标最后', () => {
    render(<Fixture rows={[
      teacherRow({ teacherName: '人数多', prepaidRate: 50, prepaidCount: 20, students: [], studentCount: 0 }),
      teacherRow({ teacherName: '空指标', prepaidRate: null, prepaidCount: null, students: [], studentCount: 0 }),
      teacherRow({ teacherName: '率高', prepaidRate: 80, prepaidCount: 3, students: [], studentCount: 0 }),
      teacherRow({ teacherName: '同率人数少', prepaidRate: 50, prepaidCount: 8, students: [], studentCount: 0 }),
    ]} />);

    const expected = ['率高', '人数多', '同率人数少', '空指标'];
    const tableRegion = screen.getByRole('region', { name: '教师明细，可横向滚动' });
    const tableRows = within(tableRegion).getAllByRole('row').slice(1);
    expect(tableRows).toHaveLength(expected.length);
    expected.forEach((name, index) => {
      expect(within(tableRows[index]).getAllByRole('cell')[0]).toHaveTextContent(name);
    });

    const topHeading = screen.getByRole('heading', { name: '预存率优先 TOP 10' });
    const topItems = within(topHeading.parentElement!).getAllByRole('listitem');
    expect(topItems).toHaveLength(expected.length);
    expected.forEach((name, index) => expect(topItems[index]).toHaveTextContent(name));
    expect(topItems[0]).toHaveTextContent('预存率 80.0%');
    expect(topItems[0]).toHaveTextContent('3');
    expect(screen.getByText(/教师表格与主榜单排序：预存率降序 → 预存人数降序/)).toBeInTheDocument();
  });

  it('学管与科组随预存/续费切换按当前模式排序，并同时展示人数和率', async () => {
    const user = userEvent.setup();
    const rateOverview: RateOverview = {
      total: 20,
      prepaidCount: 10,
      expiredCount: 10,
      renewedCount: 8,
      lostCount: 2,
      prepaidRate: 50,
      expiredRate: 50,
      renewedRate: 40,
      lostRate: 10,
      overall: { baseCount: 20, prepaidCount: 10, renewedCount: 8, prepaidRate: 50, renewRate: 40 },
      byManager: [
        { managerName: '学管高续科率', baseCount: 20, prepaidCount: 9, renewedCount: 2, prepaidRate: 50, renewRate: 90 },
        { managerName: '学管高预存率', baseCount: 20, prepaidCount: 1, renewedCount: 1, prepaidRate: 90, renewRate: 10 },
      ],
      byGroup: [
        { subjectGroup: '科组高续科率', baseCount: 20, prepaidCount: 8, renewedCount: 4, prepaidRate: 60, renewRate: 95 },
        { subjectGroup: '科组高预存率', baseCount: 20, prepaidCount: 3, renewedCount: 1, prepaidRate: 80, renewRate: 20 },
      ],
    };
    render(<Fixture
      initialTab="mentor"
      rateOverview={rateOverview}
      rows={[
        teacherRow({ tab: 'mentor', teacherName: '高续科教师', prepaidRate: 50, prepaidCount: 9, renewRate: 90, renewedCount: 2, students: [], studentCount: 0 }),
        teacherRow({ tab: 'mentor', teacherName: '高预存教师', prepaidRate: 90, prepaidCount: 1, renewRate: 10, renewedCount: 1, students: [], studentCount: 0 }),
      ]}
    />);

    await user.click(screen.getByRole('radio', { name: '预存率优先' }));
    const managerSection = screen.getByText('学管维度').parentElement!;
    const groupSection = screen.getByText('科组维度').parentElement!;
    expect(managerSection.textContent!.indexOf('学管高预存率')).toBeLessThan(managerSection.textContent!.indexOf('学管高续科率'));
    expect(groupSection.textContent!.indexOf('科组高预存率')).toBeLessThan(groupSection.textContent!.indexOf('科组高续科率'));
    expect(managerSection).toHaveTextContent('预存 1 人 · 90.0%');
    expect(managerSection).toHaveTextContent('续费 2 人 · 90.0%');
    expect(screen.getByText('排序规则：预存率降序 → 预存人数降序 → 名称升序，空值最后')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '续费率优先' }));
    expect(managerSection.textContent!.indexOf('学管高续科率')).toBeLessThan(managerSection.textContent!.indexOf('学管高预存率'));
    expect(groupSection.textContent!.indexOf('科组高续科率')).toBeLessThan(groupSection.textContent!.indexOf('科组高预存率'));
    expect(screen.getByRole('heading', { name: '续科率优先 TOP 10' })).toBeInTheDocument();
    const tableRows = within(screen.getByRole('region', { name: '教师明细，可横向滚动' })).getAllByRole('row').slice(1);
    expect(tableRows[0]).toHaveTextContent('高续科教师');
    expect(tableRows[1]).toHaveTextContent('高预存教师');
  });

  it('区分真实零学生与全部/部分明细缺失，并显示汇总质量提示', () => {
    render(<Fixture rows={[
      teacherRow({ teacherName: '明细全缺', studentCount: 3, students: [] }),
      teacherRow({ teacherName: '明细部分缺失', studentCount: 3, students: [{ name: '仅存学生', status: 'normal', slot: 0 }] }),
      teacherRow({ teacherName: '真实零学生', studentCount: 0, students: [] }),
    ]} />);

    const notice = screen.getByRole('note', { name: '学生明细数据质量提示' });
    expect(notice).toHaveTextContent('2 名教师的统计人数与已返回学生明细条数不一致');
    expect(notice).toHaveTextContent('缺失明细不代表真实无学生');

    const tableRegion = screen.getByRole('region', { name: '教师明细，可横向滚动' });
    const missingRow = within(tableRegion).getByText('明细全缺').closest('tr')!;
    expect(missingRow).toHaveTextContent('学生明细缺失：统计 3 人，已返回 0 条');
    expect(within(missingRow).queryByText('无学生明细')).not.toBeInTheDocument();
    expect(within(missingRow).queryByRole('button')).not.toBeInTheDocument();

    const partialRow = within(tableRegion).getByText('明细部分缺失').closest('tr')!;
    expect(partialRow).toHaveTextContent('部分学生明细缺失：统计 3 人，已返回 1 条');
    expect(within(partialRow).getByRole('button', { name: '查看 1 名学生明细' })).toBeInTheDocument();

    const emptyRow = within(tableRegion).getByText('真实零学生').closest('tr')!;
    expect(within(emptyRow).getByText('无学生明细')).toBeInTheDocument();
    expect(emptyRow).not.toHaveTextContent('明细缺失');
  });
});
