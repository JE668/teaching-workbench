import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LessonPlanner from './LessonPlanner';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({
  api: {
    request: vi.fn(),
  },
}));

const request = api.request as Mock;

type RequestOptions = { method?: string; body?: string };

const ACTIVITY = {
  name: '面积模型导入',
  duration_minutes: 45,
  teacher_activity: '演示把正方形平均分成两份',
  student_activity: '观察并描述其中一份',
};

const WEEK = {
  week: 1,
  title: '分数的初步认识',
  objectives: ['能借助面积模型说明二分之一的意义'],
  key_points: ['理解平均分'],
  difficult_points: ['区分分子和分母'],
  materials: ['正方形纸片'],
  activities: [ACTIVITY],
  exercises: [],
  layered_homework: { basic: [], advanced: [], challenge: [] },
  preset_questions: [],
  blackboard_design: ['1/2'],
  evaluation_rubric: [],
  reflection_prompts: ['学生能否解释平均分？'],
};

const HISTORY_PLAN = {
  id: 9,
  userId: 1,
  studentId: 1,
  courseId: 5,
  studentName: '陈晨',
  courseTitle: '分数的意义',
  title: '2026年11月分数复习',
  month: '2026-11',
  durationMinutes: 45,
  weekCount: 3,
  requirements: '先复习再练习',
  status: 'draft',
  confirmedAt: null,
  plan: {
    month: '2026-11',
    weekly_lesson_plans: [{ ...WEEK, title: '复习分数意义' }],
  },
  provider: 'local',
  model: 'template',
  modelMetadata: { provider: 'local', model: 'template', usedFallback: false },
  createdAt: '2026-11-01 09:00:00',
  updatedAt: '2026-11-18 16:30:00',
};

type LessonPlanFixture = Omit<typeof HISTORY_PLAN, 'confirmedAt'> & { confirmedAt: string | null };

const GENERATED_PLAN = {
  ...HISTORY_PLAN,
  id: 20,
  title: '2026年12月分数初步教案',
  month: '2026-12',
  weekCount: 2,
  requirements: '多用面积模型，减少机械练习',
  plan: {
    month: '2026-12',
    weekly_lesson_plans: [WEEK],
  },
  createdAt: '2026-11-20 10:00:00',
  updatedAt: '2026-11-20 10:00:00',
};

const HOMEWORK_WEEK_ONE = {
  ...WEEK,
  title: '分数意义分层练习',
  layered_homework: {
    basic: ['用图形表示 1/2', '圈出平均分的图形'],
    advanced: ['解释 2/4 与 1/2 的关系'],
    challenge: ['设计一个非对称的平均分反例'],
  },
};

const HOMEWORK_WEEK_TWO = {
  ...WEEK,
  week: 2,
  title: '几分之一比较',
  layered_homework: {
    basic: ['比较 1/3 和 1/4'],
    advanced: [],
    challenge: [],
  },
};

const LAYERED_GENERATED_PLAN = {
  ...GENERATED_PLAN,
  id: 30,
  title: '分层作业回归教案',
  plan: {
    month: '2026-12',
    weekly_lesson_plans: [HOMEWORK_WEEK_ONE, HOMEWORK_WEEK_TWO],
  },
};

function mockRequests(handlers: {
  plans?: LessonPlanFixture[];
  groupPlans?: LessonPlanFixture[];
  generate?: (options: RequestOptions) => unknown;
  update?: (id: number, options: RequestOptions) => unknown;
  clone?: (id: number, options: RequestOptions) => unknown;
} = {}) {
  const plans = handlers.plans ?? [HISTORY_PLAN];
  request.mockImplementation(async (path: string, options: RequestOptions = {}) => {
    if (path === '/students') {
      return { students: [{ id: 1, name: '陈晨', grade: '五年级', subject: '数学' }] };
    }
    if (path === '/catalog/courses') {
      return {
        courses: [
          { id: 5, term: '2026 秋', grade: '五年级', subject: '数学', content: '分数的意义', section: '第三单元' },
        ],
      };
    }
    if (path === '/lesson-plans?limit=50') return { plans, total: plans.length };
    if (path === '/lesson-plans?limit=50&scope=group') {
      const groupPlans = handlers.groupPlans ?? plans;
      return { plans: groupPlans, total: groupPlans.length };
    }
    if (path === '/lesson-plans/generate' && options.method === 'POST') {
      if (!handlers.generate) throw new Error('未配置生成接口');
      return handlers.generate(options);
    }
    const cloneMatch = path.match(/^\/lesson-plans\/(\d+)\/clone$/);
    if (cloneMatch && options.method === 'POST') {
      if (!handlers.clone) throw new Error('未配置克隆接口');
      return handlers.clone(Number(cloneMatch[1]), options);
    }
    const updateMatch = path.match(/^\/lesson-plans\/(\d+)$/);
    if (updateMatch && options.method === 'PUT') {
      if (!handlers.update) throw new Error('未配置保存接口');
      return handlers.update(Number(updateMatch[1]), options);
    }
    throw new Error('未 mock 的请求：' + options.method + ' ' + path);
  });
}

beforeEach(() => {
  request.mockReset();
});

describe('AI 备课助手', () => {
  it('加载历史教案和学生教材，点击历史记录后可进入逐周编辑', async () => {
    mockRequests();
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);

    expect(await screen.findByText('2026年11月分数复习')).toBeInTheDocument();
    expect(screen.getByText('共 1 份')).toBeInTheDocument();
    expect(screen.getByText('陈晨')).toBeInTheDocument();
    expect(screen.getByText('3 周')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/students');
    expect(request).toHaveBeenCalledWith('/catalog/courses');
    expect(request).toHaveBeenCalledWith('/lesson-plans?limit=50');

    await user.click(screen.getByRole('button', { name: /2026年11月分数复习/ }));
    expect(screen.getByText('逐周编辑教案')).toBeInTheDocument();
    expect(screen.getByLabelText('教案名称')).toHaveValue('2026年11月分数复习');
    expect(screen.getByDisplayValue('复习分数意义')).toBeInTheDocument();
    expect(screen.getByDisplayValue('能借助面积模型说明二分之一的意义')).toBeInTheDocument();
  });

  it('教研组按固定 scope URL 加载；组外学生不预选并以 null 克隆，源记录保持不变', async () => {
    const GROUP_SOURCE = {
      ...HISTORY_PLAN,
      id: 40,
      userId: 8,
      studentId: 99,
      studentName: '外组学生',
      title: '教研组已确认教案',
      status: 'confirmed',
      confirmedAt: '2026-11-19 12:00:00',
    };
    const NULL_CLONE = {
      ...GROUP_SOURCE,
      id: 41,
      userId: 1,
      studentId: null,
      studentName: null,
      title: '组内教案的未绑定克隆',
      status: 'draft',
      confirmedAt: null,
    };
    const sourceSnapshot = JSON.parse(JSON.stringify(GROUP_SOURCE));
    mockRequests({
      plans: [HISTORY_PLAN],
      groupPlans: [GROUP_SOURCE],
      clone: () => ({ plan: NULL_CLONE }),
    });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);
    await screen.findByRole('button', { name: /2026年11月分数复习/ });

    await user.click(screen.getByRole('button', { name: '教研组' }));
    const sourceButton = await screen.findByRole('button', { name: /教研组已确认教案/ });
    expect(request).toHaveBeenCalledWith('/lesson-plans?limit=50&scope=group');
    expect(request.mock.calls.filter(([path]) => path === '/lesson-plans?limit=50&scope=group')).toHaveLength(1);

    await user.click(sourceButton);
    expect(screen.getByLabelText('教案名称')).toHaveValue('教研组已确认教案');
    const cloneTarget = screen.getByLabelText('克隆目标学生');
    expect(cloneTarget).toHaveValue('');
    expect(cloneTarget).toHaveDisplayValue('克隆：不绑定学生');

    await user.click(screen.getByRole('button', { name: '克隆教案' }));
    await waitFor(() => expect(screen.getByLabelText('教案名称')).toHaveValue('组内教案的未绑定克隆'));
    expect(screen.getByText('已克隆为我的草稿，原教案和确认状态未改动')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/lesson-plans/40/clone', {
      method: 'POST',
      body: JSON.stringify({ studentId: null }),
    });
    expect(cloneTarget).toHaveValue('');
    expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
    expect(GROUP_SOURCE).toEqual(sourceSnapshot);
    expect(await screen.findByRole('button', { name: /2026年11月分数复习/ })).toBeInTheDocument();
    expect(request.mock.calls.filter(([path]) => path === '/lesson-plans?limit=50')).toHaveLength(2);
  });

  it('源学生属于当前学生列表时默认预选，克隆发送数字 ID 并保留已确认源教案', async () => {
    const OWN_CONFIRMED_SOURCE = {
      ...HISTORY_PLAN,
      id: 50,
      title: '我的已确认分数教案',
      status: 'confirmed',
      confirmedAt: '2026-11-19 12:00:00',
    };
    const NUMERIC_CLONE = {
      ...OWN_CONFIRMED_SOURCE,
      id: 51,
      title: '克隆给陈晨的新草稿',
      status: 'draft',
      confirmedAt: null,
    };
    const sourceSnapshot = JSON.parse(JSON.stringify(OWN_CONFIRMED_SOURCE));
    mockRequests({
      plans: [OWN_CONFIRMED_SOURCE],
      clone: () => ({ plan: NUMERIC_CLONE }),
    });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);

    await user.click(await screen.findByRole('button', { name: /我的已确认分数教案/ }));
    const cloneTarget = screen.getByLabelText('克隆目标学生');
    await waitFor(() => expect(cloneTarget).toHaveValue('1'));
    expect(cloneTarget).toHaveDisplayValue('克隆给：陈晨');

    await user.click(screen.getByRole('button', { name: '克隆教案' }));
    await waitFor(() => expect(screen.getByLabelText('教案名称')).toHaveValue('克隆给陈晨的新草稿'));
    expect(screen.getByText('已克隆为我的草稿，原教案和确认状态未改动')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/lesson-plans/50/clone', {
      method: 'POST',
      body: JSON.stringify({ studentId: 1 }),
    });
    expect(cloneTarget).toHaveValue('1');
    expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
    expect(OWN_CONFIRMED_SOURCE).toEqual(sourceSnapshot);

    const unchangedSource = await screen.findByRole('button', { name: /我的已确认分数教案/ });
    expect(unchangedSource).toHaveTextContent('已确认');
    expect(unchangedSource).toHaveTextContent('陈晨');
    expect(request.mock.calls.filter(([path]) => path === '/lesson-plans?limit=50')).toHaveLength(2);
  });

  it('组内他人教案只读但可克隆；未带 isMine 的克隆恢复保存和确认操作', async () => {
    const GROUP_SOURCE = {
      ...HISTORY_PLAN,
      id: 60,
      userId: 8,
      title: '组内共享分数教案',
      status: 'confirmed',
      confirmedAt: '2026-11-19 12:00:00',
      isMine: false,
    };
    const { isMine: sourceIsMine, ...cloneBase } = GROUP_SOURCE;
    const CLONED_PLAN = {
      ...cloneBase,
      id: 61,
      userId: 1,
      title: '我的组内克隆教案',
      status: 'draft',
      confirmedAt: null,
    };
    expect(sourceIsMine).toBe(false);
    expect(CLONED_PLAN).not.toHaveProperty('isMine');
    mockRequests({
      plans: [HISTORY_PLAN],
      groupPlans: [GROUP_SOURCE],
      clone: () => ({ plan: CLONED_PLAN }),
    });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);
    await screen.findByRole('button', { name: /2026年11月分数复习/ });

    await user.click(screen.getByRole('button', { name: '教研组' }));
    await user.click(await screen.findByRole('button', { name: /组内共享分数教案/ }));

    expect(screen.getByText('组内教案（只读）')).toBeInTheDocument();
    expect(screen.getByText('可查看已确认教案；克隆为自己的草稿后再编辑')).toBeInTheDocument();
    expect(
      screen.getByText('这是其他教师已确认的共享教案。源教案不可修改或删除；请选择目标学生并克隆后再编辑。')
    ).toBeInTheDocument();
    const titleInput = screen.getByLabelText('教案名称');
    expect(titleInput).toHaveValue('组内共享分数教案');
    expect(titleInput).toBeDisabled();
    expect(screen.queryByRole('button', { name: '删除教案' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认教案' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '克隆教案' })).toBeEnabled();
    await waitFor(() => expect(screen.getByLabelText('克隆目标学生')).toHaveValue('1'));

    await user.click(screen.getByRole('button', { name: '克隆教案' }));

    await waitFor(() => expect(titleInput).toHaveValue('我的组内克隆教案'));
    expect(request).toHaveBeenCalledWith('/lesson-plans/60/clone', {
      method: 'POST',
      body: JSON.stringify({ studentId: 1 }),
    });
    expect(screen.getByText('已克隆为我的草稿，原教案和确认状态未改动')).toBeInTheDocument();
    expect(screen.queryByText('组内教案（只读）')).not.toBeInTheDocument();
    expect(screen.queryByText('可查看已确认教案；克隆为自己的草稿后再编辑')).not.toBeInTheDocument();
    expect(titleInput).toBeEnabled();
    expect(screen.getByRole('button', { name: '删除教案' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '确认教案' })).toBeEnabled();
    expect(request.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  });

  it('初始 URL 带 planId 时，列表加载后自动打开对应教案', async () => {
    mockRequests({ plans: [HISTORY_PLAN, GENERATED_PLAN] });
    renderWithProviders(<LessonPlanner />, {
      route: '/lesson-plans?planId=20',
      path: '/lesson-plans',
    });

    expect(await screen.findByText('逐周编辑教案')).toBeInTheDocument();
    expect(screen.getByLabelText('教案名称')).toHaveValue('2026年12月分数初步教案');
    expect(screen.getByDisplayValue('分数的初步认识')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026年11月分数复习/ })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/lesson-plans?limit=50');
    expect(request).not.toHaveBeenCalledWith('/lesson-plans/generate', expect.anything());
  });

  it('初始 URL 的 planId 不存在时保留列表和生成表单，不打开空编辑器', async () => {
    mockRequests();
    renderWithProviders(<LessonPlanner />, {
      route: '/lesson-plans?planId=9999',
      path: '/lesson-plans',
    });

    expect(await screen.findByRole('button', { name: /2026年11月分数复习/ })).toBeInTheDocument();
    expect(screen.getByText('共 1 份')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成教案' })).toBeEnabled();
    expect(screen.queryByText('逐周编辑教案')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('教案名称')).not.toBeInTheDocument();
    expect(screen.queryByText(/加载教案失败：/)).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/lesson-plans?limit=50');
    expect(request).not.toHaveBeenCalledWith('/lesson-plans/9999', expect.anything());
  });

  it('按参数生成教案，编辑名称课时和本周活动后保存完整草稿', async () => {
    mockRequests({
      generate: () => ({ plan: GENERATED_PLAN }),
      update: (_id, options) => {
        const payload = JSON.parse(options.body || '{}');
        return {
          plan: {
            ...GENERATED_PLAN,
            ...payload,
            updatedAt: '2026-11-20 10:20:00',
          },
        };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);
    await screen.findByText('2026年11月分数复习');

    await user.selectOptions(screen.getByLabelText('学生'), '1');
    await user.selectOptions(screen.getByLabelText('教材章节'), '5');
    fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-12' } });
    fireEvent.change(screen.getByLabelText('课时时长（分钟）'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('规划周数'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('补充要求'), {
      target: { value: '  多用面积模型，减少机械练习  ' },
    });
    await user.click(screen.getByRole('button', { name: '生成教案' }));

    expect(await screen.findByText('逐周编辑教案')).toBeInTheDocument();
    expect(screen.getByText('教案已生成，确认前可逐周修改')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/lesson-plans/generate', {
      method: 'POST',
      body: JSON.stringify({
        studentId: 1,
        courseId: 5,
        month: '2026-12',
        durationMinutes: 50,
        weekCount: 2,
        requirements: '多用面积模型，减少机械练习',
      }),
    });

    fireEvent.change(screen.getByLabelText('教案名称'), { target: { value: '分数概念精修教案' } });
    fireEvent.change(screen.getAllByLabelText('课时时长（分钟）')[1], { target: { value: '50' } });
    fireEvent.change(screen.getByDisplayValue('分数的初步认识'), {
      target: { value: '分数的初步认识与面积模型' },
    });
    fireEvent.change(screen.getByPlaceholderText('活动名称'), {
      target: { value: '折叠纸认识二分之一' },
    });
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(screen.getByLabelText('教案名称')).toHaveValue('分数概念精修教案');
    const expectedWeek = {
      ...WEEK,
      title: '分数的初步认识与面积模型',
      activities: [{ ...ACTIVITY, name: '折叠纸认识二分之一' }],
    };
    expect(request).toHaveBeenCalledWith('/lesson-plans/20', {
      method: 'PUT',
      body: JSON.stringify({
        title: '分数概念精修教案',
        durationMinutes: 50,
        requirements: '多用面积模型，减少机械练习',
        status: 'draft',
        plan: { month: '2026-12', weekly_lesson_plans: [expectedWeek] },
      }),
    });
    await waitFor(() => {
      expect(request.mock.calls.filter(([path]) => path === '/lesson-plans?limit=50')).toHaveLength(3);
    });
  });

  it('切换周/日视图后，通过下拉把基础层作业移到提高层和挑战层并保存', async () => {
    mockRequests({
      generate: () => ({ plan: LAYERED_GENERATED_PLAN }),
      update: (_id, options) => {
        const payload = JSON.parse(options.body || '{}');
        return {
          plan: {
            ...LAYERED_GENERATED_PLAN,
            ...payload,
            updatedAt: '2026-11-20 11:00:00',
          },
        };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);
    await screen.findByText('2026年11月分数复习');
    await user.click(screen.getByRole('button', { name: '生成教案' }));
    await screen.findByText('逐周编辑教案');

    const weekView = screen.getByRole('button', { name: '周视图' });
    const dayView = screen.getByRole('button', { name: '日视图（每次课）' });
    expect(weekView).toHaveAttribute('aria-pressed', 'true');
    expect(dayView).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByDisplayValue('用图形表示 1/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第 2 周 · 几分之一比较/ })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('比较 1/3 和 1/4')).not.toBeInTheDocument();

    await user.click(dayView);
    expect(dayView).toHaveAttribute('aria-pressed', 'true');
    expect(weekView).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('选择课时')).toHaveValue('1');
    expect(screen.getByDisplayValue('用图形表示 1/2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /第 2 周 · 几分之一比较/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('选择课时'), '2');
    expect(screen.getByDisplayValue('比较 1/3 和 1/4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /第 1 周 · 分数意义分层练习/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('选择课时'), '1');
    await user.click(weekView);
    expect(weekView).toHaveAttribute('aria-pressed', 'true');
    expect(dayView).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByDisplayValue('用图形表示 1/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第 2 周 · 几分之一比较/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('移动基础层作业1'), 'advanced');
    const advancedRow = screen.getByLabelText('移动提高层作业2').parentElement;
    expect(advancedRow?.querySelector('textarea')).toHaveValue('用图形表示 1/2');
    expect(screen.getByLabelText('移动基础层作业1')).toHaveValue('basic');
    expect(screen.queryByLabelText('移动基础层作业2')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('移动基础层作业1'), 'challenge');
    const challengeRow = screen.getByLabelText('移动挑战层作业2').parentElement;
    expect(challengeRow?.querySelector('textarea')).toHaveValue('圈出平均分的图形');
    expect(screen.queryByLabelText('移动基础层作业1')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('解释 2/4 与 1/2 的关系')).toBeInTheDocument();
    expect(screen.getByDisplayValue('设计一个非对称的平均分反例')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    const expectedFirstWeek = {
      ...HOMEWORK_WEEK_ONE,
      layered_homework: {
        basic: [],
        advanced: ['解释 2/4 与 1/2 的关系', '用图形表示 1/2'],
        challenge: ['设计一个非对称的平均分反例', '圈出平均分的图形'],
      },
    };
    expect(request).toHaveBeenCalledWith('/lesson-plans/30', {
      method: 'PUT',
      body: JSON.stringify({
        title: '分层作业回归教案',
        durationMinutes: 45,
        requirements: '多用面积模型，减少机械练习',
        status: 'draft',
        plan: {
          month: '2026-12',
          weekly_lesson_plans: [expectedFirstWeek, HOMEWORK_WEEK_TWO],
        },
      }),
    });
  });

  it('生成接口失败时显示错误、保留参数并恢复操作按钮', async () => {
    mockRequests({
      plans: [],
      generate: () => Promise.reject(new Error('模型服务超时')),
    });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);
    await screen.findByText('还没有教案');

    fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-12' } });
    await user.type(screen.getByLabelText('补充要求'), '保留这份备课要求');
    await user.click(screen.getByRole('button', { name: '生成教案' }));

    expect(await screen.findByText('生成教案失败：模型服务超时')).toBeInTheDocument();
    expect(screen.getByLabelText('补充要求')).toHaveValue('保留这份备课要求');
    expect(screen.getByRole('button', { name: '生成教案' })).toBeEnabled();
    expect(screen.queryByText('逐周编辑教案')).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/lesson-plans/generate', {
      method: 'POST',
      body: JSON.stringify({
        studentId: null,
        courseId: null,
        month: '2026-12',
        durationMinutes: 45,
        weekCount: 4,
        requirements: '保留这份备课要求',
      }),
    });
  });

  it('保存接口失败时显示错误并保留尚未保存的编辑内容', async () => {
    mockRequests({ update: () => Promise.reject(new Error('数据库暂时锁定')) });
    const user = userEvent.setup();
    renderWithProviders(<LessonPlanner />);
    await user.click(await screen.findByRole('button', { name: /2026年11月分数复习/ }));

    fireEvent.change(screen.getByLabelText('教案名称'), { target: { value: '尚未保存的新名称' } });
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByText('保存教案失败：数据库暂时锁定')).toBeInTheDocument();
    expect(screen.getByLabelText('教案名称')).toHaveValue('尚未保存的新名称');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(request).toHaveBeenCalledWith('/lesson-plans/9', {
      method: 'PUT',
      body: JSON.stringify({
        title: '尚未保存的新名称',
        durationMinutes: 45,
        requirements: '先复习再练习',
        status: 'draft',
        plan: HISTORY_PLAN.plan,
      }),
    });
    expect(request.mock.calls.filter(([path]) => path === '/lesson-plans?limit=50')).toHaveLength(1);
  });
});
