import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudentProfilePanel } from './StudentProfile';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const get = api.get as Mock;
const post = api.post as Mock;
const patch = api.patch as Mock;

const GENERATED_AT = '2026-11-20T08:30:00.000Z';

const EXISTING_PROFILE = {
  id: 101,
  studentId: 12,
  studentName: '陈晨',
  sourceSummary: '综合 6 次回访与 2 份月报生成',
  confidence: 0.86,
  generatedAt: GENERATED_AT,
  confirmedByTeacher: true,
  teacherNotes: '课堂观察与画像一致',
  profile: {
    learning_style: 'visual',
    weak_points: ['分数通分仍需提示'],
    strong_points: ['几何直观清晰'],
    motivation_drivers: ['老师表扬', '闯关挑战'],
    pacing_preference: 'steady',
    communication_style: 'encouraging',
    attention_span_minutes: 35,
    homework_compliance: 'high',
    parental_involvement: 'medium',
    confidence: 0.72,
    updated_at: GENERATED_AT,
  },
};

const GENERATED_PROFILE = {
  ...EXISTING_PROFILE,
  id: 202,
  sourceSummary: '依据最新 8 次课堂记录生成',
  confidence: 0.89,
  generatedAt: '2026-11-21T09:45:00.000Z',
  confirmedByTeacher: false,
  teacherNotes: '',
  profile: {
    ...EXISTING_PROFILE.profile,
    learning_style: 'kinesthetic',
    strong_points: ['动手操作与空间想象扎实'],
    weak_points: ['独立审题需要 scaffold'],
    updated_at: '2026-11-21T09:45:00.000Z',
  },
};

const REGENERATED_PROFILE = {
  ...EXISTING_PROFILE,
  sourceSummary: '重新聚合最新月报与错因分析',
  confidence: 0.93,
  generatedAt: '2026-11-22T10:15:00.000Z',
  profile: {
    ...EXISTING_PROFILE.profile,
    learning_style: 'auditory',
    strong_points: ['能独立讲解通分'],
    weak_points: ['复杂应用题需要分步提示'],
    motivation_drivers: ['同伴互评'],
    updated_at: '2026-11-22T10:15:00.000Z',
  },
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  get.mockResolvedValue({ profile: EXISTING_PROFILE });
});

describe('学生画像面板', () => {
  it('加载已有画像后显示真实标题、维度值和强弱项，不泄露字面插值占位符', async () => {
    const { container } = renderWithProviders(
      <StudentProfilePanel studentId={12} studentName="陈晨" />
    );

    expect(await screen.findByText('陈晨 的学生画像')).toBeInTheDocument();
    expect(screen.getByText('综合 6 次回访与 2 份月报生成')).toBeInTheDocument();
    expect(screen.getByText('学习风格')).toBeInTheDocument();
    expect(screen.getByText('视觉型')).toBeInTheDocument();
    expect(screen.getByText('稳扎稳打')).toBeInTheDocument();
    expect(screen.getByText('鼓励为主')).toBeInTheDocument();
    expect(screen.getByText('35 分钟')).toBeInTheDocument();
    expect(screen.getByText('老师表扬、闯关挑战')).toBeInTheDocument();
    expect(screen.getByText('几何直观清晰')).toBeInTheDocument();
    expect(screen.getByText('分数通分仍需提示')).toBeInTheDocument();
    expect(screen.getByText('画像可信度: 86%')).toBeInTheDocument();
    expect(screen.getByText('课堂观察与画像一致')).toBeInTheDocument();
    for (const placeholder of ['${title}', '${value}', '${item}']) {
      expect(container.textContent).not.toContain(placeholder);
    }
    expect(get).toHaveBeenCalledWith('/student-profiles/12');
  });

  it('将有效 generatedAt 格式化为可读时间，两个时间位置均无 Invalid Date', async () => {
    const { container } = renderWithProviders(
      <StudentProfilePanel studentId={12} studentName="陈晨" />
    );
    await screen.findByText('几何直观清晰');

    const formatted = new Date(GENERATED_AT).toLocaleString();
    expect(
      screen.getByText(
        (_content, element) => element?.tagName === 'SPAN' && element.textContent === '生成于 ' + formatted
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' && element.textContent === '画像更新于 ' + formatted + ' · 已由教师确认'
      )
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain('Invalid Date');
  });

  it('画像生成成功但内容引用失败时保留新画像，并同时提示成功与非阻塞引用错误', async () => {
    get.mockRejectedValue(new Error('404 Not Found'));
    post.mockImplementation((path: string) => {
      if (path === '/student-profiles/12/generate') {
        return Promise.resolve({ profile: GENERATED_PROFILE });
      }
      if (path === '/content/references') {
        return Promise.reject(new Error('引用服务暂不可用'));
      }
      return Promise.reject(new Error('未 mock 的 POST：' + path));
    });
    const user = userEvent.setup();
    renderWithProviders(
      <StudentProfilePanel
        studentId={12}
        studentName="陈晨"
        entityType="report"
        entityId={42}
      />
    );

    await user.click(await screen.findByRole('button', { name: '生成学生画像' }));

    expect(await screen.findByText('动手操作与空间想象扎实')).toBeInTheDocument();
    expect(screen.getByText('动觉型')).toBeInTheDocument();
    expect(screen.getByText('学生画像生成完成')).toBeInTheDocument();
    expect(screen.getByText('画像已生成，但内容引用创建失败：引用服务暂不可用')).toBeInTheDocument();
    expect(screen.queryByText(/生成学生画像失败：/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(post).toHaveBeenCalledWith('/student-profiles/12/generate', {});
    expect(post).toHaveBeenCalledWith('/content/references', {
      sourceType: 'student_profile',
      sourceId: 202,
      targetType: 'report',
      targetId: 42,
      refRole: 'derives_from',
    });
  });

  it('重新生成后用响应替换旧画像内容并恢复按钮', async () => {
    post.mockResolvedValue({ profile: REGENERATED_PROFILE });
    const user = userEvent.setup();
    renderWithProviders(<StudentProfilePanel studentId={12} studentName="陈晨" />);
    await screen.findByText('几何直观清晰');

    await user.click(screen.getByRole('button', { name: '重新生成' }));

    expect(await screen.findByText('能独立讲解通分')).toBeInTheDocument();
    expect(screen.getByText('复杂应用题需要分步提示')).toBeInTheDocument();
    expect(screen.getByText('听觉型')).toBeInTheDocument();
    expect(screen.getByText('同伴互评')).toBeInTheDocument();
    expect(screen.getByText('重新聚合最新月报与错因分析')).toBeInTheDocument();
    expect(screen.getByText('画像可信度: 93%')).toBeInTheDocument();
    expect(screen.queryByText('几何直观清晰')).not.toBeInTheDocument();
    expect(screen.queryByText('视觉型')).not.toBeInTheDocument();
    expect(screen.queryByText('老师表扬、闯关挑战')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/student-profiles/12/generate', {});
  });
});
