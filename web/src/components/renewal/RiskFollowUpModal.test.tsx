import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RiskFollowUpModal, { type RiskFollowUpRecord } from './RiskFollowUpModal';
import { renderWithProviders } from '../../test/test-utils';
import { api } from '../../api/client';
import type { RiskStudentRow } from '../../lib/renewal';

vi.mock('../../api/client', () => ({ api: { put: vi.fn() } }));
const putMock = api.put as Mock;
const student = {
  studentKey: 'S001', sourceRow: 9, studentId: 'S001', studentName: '测试学生', managerName: '学管甲', grade: '初二',
  enrollDays: 100, coef: 1, type: '1对1', courseProduct: '数学', classLast1: 0, classLast2: 2,
} as RiskStudentRow;
const saved: RiskFollowUpRecord = { reportId: 2, studentKey: 'S001', owner: '负责人', followUpStatus: 'contacted', nextFollowUpDate: '2026-12-01', outcome: '已沟通' };

describe('风险学生跟进', () => {
  beforeEach(() => putMock.mockReset());

  it('保存负责人、状态、日期和处置记录', async () => {
    putMock.mockResolvedValue({ record: saved });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<RiskFollowUpModal open student={student} reportId={2} onClose={onClose} onSaved={onSaved} />);
    await user.type(screen.getByLabelText(/跟进负责人/), '负责人');
    await user.selectOptions(screen.getByLabelText('跟进状态'), 'contacted');
    await user.type(screen.getByLabelText('下次跟进日期'), '2026-12-01');
    await user.type(screen.getByLabelText('沟通与处置记录'), '已沟通');
    await user.click(screen.getByRole('button', { name: '保存跟进' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/renewal/risk-followups/S001?reportId=2', {
      owner: '负责人', followUpStatus: 'contacted', nextFollowUpDate: '2026-12-01', outcome: '已沟通',
    }));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalled();
  });

  it('负责人缺失时不提交', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RiskFollowUpModal open student={student} reportId={2} onClose={() => {}} onSaved={() => {}} />);
    await user.click(screen.getByRole('button', { name: '保存跟进' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写跟进负责人');
    expect(putMock).not.toHaveBeenCalled();
  });
});
