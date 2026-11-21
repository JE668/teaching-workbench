import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import TeachingReview from './TeachingReview';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({ api: { request: vi.fn() } }));
const request = api.request as Mock;

const summary = {
  month: '2026-05',
  workload: { followups: 2, reports: 1, observations: 1, lessonPlans: 3, lessonPlansConfirmed: 2, students: 3, total: 7 },
  quality: {
    aiCalls: 4,
    aiSuccessRate: 50,
    aiErrorCount: 1,
    aiRetryCount: 2,
    aiRetryRate: 50,
    retryAttempts: 3,
    totalTokens: 170,
    avgLatencyMs: 200,
    wordTarget: { measured: 2, inRange: 1, rate: 50 },
    funnel: [
      { key: 'calls', label: '发起调用', value: 4 },
      { key: 'success', label: '生成成功', value: 2 },
      { key: 'measured', label: '成功且有字数目标', value: 2 },
      { key: 'inRange', label: '字数达标', value: 1 },
    ],
    latencyWordCount: [{ endpoint: 'followup_stream', latencyMs: 100, wordCount: 120 }],
    byEndpoint: [{ endpoint: 'followup_stream', calls: 4, successRate: 50, retryCount: 2, retryRate: 50, avgLatencyMs: 200 }],
  },
  masteryDistribution: [{ key: 'good', label: '良好', count: 2, percent: 100 }],
  dailyActivity: [{ day: '2026-05-03', n: 2 }],
  growth: [{ category: 'concept', total: 3, solid: 1, weak: 1, avgMastery: 0.6 }],
  growthSemantics: 'current_snapshot_student_weighted',
  monthlyKnowledgeDelta: [{ category: 'concept', delta: 0.3, evidenceCount: 2, semantics: 'sum_of_report_deltas_not_historical_mastery' }],
  followupQuality: { total: 2, avgWordCount: 150, structured: 2, structuredRate: 100, withImages: 1, imageRecordRate: 50, referenced: 1, historicalReferenceRate: 50, parentShared: 1, parentRead: 1, parentReadRate: 100 },
  groupComparisons: [{ groupId: 1, groupName: '五年级小组', studentCount: 2, masteryStudentCount: 2, avgMastery: 0.6, deltaStudentCount: 2, avgMasteryDelta: 0.15, deltaEvidenceCount: 2, followupCovered: 1, followupCoverageRate: 50 }],
  attendance: { sessions: 0, present: 0, rate: null },
  limitations: ['成长雷达是当前知识快照，不是所选月末的历史掌握度；月度曲线使用月报记录的原始 delta。'],
};

const coverage = {
  totalStudents: 3,
  coveredStudents: 1,
  coldCount: 2,
  returnedCount: 3,
  students: [
    { studentId: 2, studentName: '未回访学生', grade: '五年级', subject: '数学', followups: 0, lastFollowupAt: null, cold: true },
    { studentId: 1, studentName: '已回访学生', grade: '五年级', subject: '数学', followups: 2, lastFollowupAt: '2026-05-03', cold: false },
  ],
};

function installMock() {
  request.mockImplementation(async (path: string) => {
    if (path === '/teaching-review/access') return { canViewTeam: false };
    if (path.startsWith('/teaching-review/summary')) return summary;
    if (path.startsWith('/teaching-review/trend')) return { months: 6, points: [{ month: '2026-05', followups: 2, reports: 1, observations: 1, aiCalls: 4, aiSuccessRate: 50 }] };
    if (path.startsWith('/teaching-review/students')) return coverage;
    throw new Error('unexpected request: ' + path);
  });
}

describe('TeachingReview', () => {
  beforeEach(() => {
    request.mockReset();
    installMock();
  });

  it('loads all three review endpoints with the selected month', async () => {
    renderWithProviders(<TeachingReview />);
    expect(await screen.findByText('回访内容质量')).toBeInTheDocument();
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path !== '/teaching-review/access')).toHaveLength(3));
    expect(request.mock.calls.some(([path]) => String(path).includes('/teaching-review/trend?months=6&endMonth='))).toBe(true);
    expect(request.mock.calls.some(([path]) => String(path).includes('/teaching-review/students?month='))).toBe(true);
  });

  it('renders real quality, coverage, group delta and limitations', async () => {
    renderWithProviders(<TeachingReview />);
    expect(await screen.findByText('AI 生成质量漏斗')).toBeInTheDocument();
    expect(screen.getByText('本月未回访')).toBeInTheDocument();
    expect(screen.getByText('未回访学生')).toBeInTheDocument();
    expect(screen.getByText('五年级小组')).toBeInTheDocument();
    expect(screen.getByText(/当前掌握 · 2\/2 人/)).toBeInTheDocument();
    expect(screen.getByText(/月报 delta · 2\/2 人/)).toBeInTheDocument();
    expect(screen.getByText('+0.3')).toBeInTheDocument();
    expect(screen.getByText('数据边界与未采集指标')).toBeInTheDocument();
    expect(screen.getByText(/成长雷达是当前知识快照/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AI 调用延迟与字数散点图' })).toBeInTheDocument();
  });

  it('does not turn empty attendance into a fabricated zero percent', async () => {
    renderWithProviders(<TeachingReview />);
    expect(await screen.findByText('回访内容质量')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('shows a retryable load failure instead of stale data or a permanent skeleton', async () => {
    let failSummary = true;
    request.mockImplementation(async (path: string) => {
      if (path.startsWith('/teaching-review/summary')) {
        if (failSummary) throw new Error('月度接口失败');
        return summary;
      }
      if (path.startsWith('/teaching-review/trend')) return { months: 6, points: [] };
      if (path.startsWith('/teaching-review/students')) return coverage;
      throw new Error('unexpected request: ' + path);
    });
    renderWithProviders(<TeachingReview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('月度接口失败');
    expect(screen.queryByText('回访内容质量')).toBeNull();
    failSummary = false;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('回访内容质量')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(request.mock.calls.filter(([path]) => String(path).startsWith('/teaching-review/summary')).length).toBe(2);
  });

  it('lets a supervisor open team health and drill into a teacher', async () => {
    request.mockImplementation(async (path: string) => {
      if (path === '/teaching-review/access') return { canViewTeam: true };
      if (path.startsWith('/teaching-review/team')) return { teachers: [{ teacherId: 7, username: '教师乙', students: 4, followups: 5, reports: 2, observations: 1, lessonPlans: 3, aiCalls: 4, aiSuccessRate: 75 }] };
      if (path.startsWith('/teaching-review/summary')) return summary;
      if (path.startsWith('/teaching-review/trend')) return { months: 6, points: [] };
      if (path.startsWith('/teaching-review/students')) return coverage;
      throw new Error('unexpected request: ' + path);
    });
    renderWithProviders(<TeachingReview />);
    expect(await screen.findByText('全组教学健康度')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '查看 教师乙' })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 教师乙' }));
    await waitFor(() => {
      expect(request.mock.calls.some(([path]) => String(path).startsWith('/teaching-review/summary') && String(path).includes('teacherId=7'))).toBe(true);
      expect(request.mock.calls.some(([path]) => String(path).startsWith('/teaching-review/students') && String(path).includes('teacherId=7'))).toBe(true);
    });
    expect(screen.getByLabelText('复盘教师')).toHaveValue('7');
  });

});
