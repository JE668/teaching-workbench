import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowUp from './FollowUp';
import { renderWithProviders } from '../test/test-utils';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    streamPost: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
  },
}));

const get = api.get as Mock;
const post = api.post as Mock;
const put = api.put as Mock;
const streamPost = api.streamPost as Mock;

const GENERATED =
  '【课堂内容】本节课重点讲解异分母分数加减法的通分原理与步骤，通过数轴与图形直观演示，帮助学生理解分数单位统一的数学本质，并结合生活情境设计练习。' +
  '【学生收获】李小明本节课专注度较高，能够主动举手回答问题，对通分方法的理解比较到位，独立完成基础题型时准确率良好，计算速度还有提升空间。' +
  '【课后任务】完成练习册第12页第1到8题，重点巩固通分步骤；每天用5分钟做10道口算，提升计算速度与准确率。';

/** 让 streamPost 立即以完整内容回调 onDone */
function stubStream(content = GENERATED) {
  streamPost.mockImplementation(async (_path: string, _body: any, handlers: any) => {
    handlers.onDone?.({ content, wordCount: 175, regenerated: false });
  });
}

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>, topic = '分数加减法运算') {
  await user.type(screen.getByLabelText(/学生姓名/), '李小明');
  await user.type(screen.getByLabelText(/课程主题|课程内容/), topic);
  await user.type(screen.getByLabelText(/课堂表现/), '专注度较高');
}

/** 保存按钮：字数达标时叫「保存并归档到学生档案」，不达标时叫「仍要保存…」 */
async function clickSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: /保存并归档到学生档案|仍要保存/ })
  );
}

beforeEach(() => {
  // 草稿是跨用例的持久状态，必须清掉，否则会串味
  localStorage.clear();
  get.mockReset();
  post.mockReset();
  streamPost.mockReset();
  get.mockResolvedValue({ students: [] });
});

describe('课后回访 · 课次选择器', () => {
  it('默认选中 1 次课，且不显示阶段性提示', () => {
    renderWithProviders(<FollowUp />);

    for (const n of [1, 2, 3]) {
      expect(screen.getByRole('button', { name: n + ' 次课' })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/课程主题/)).toBeInTheDocument();
    expect(screen.queryByText(/作为一个阶段整体反馈/)).not.toBeInTheDocument();
  });

  it('选择 3 次课后出现阶段性提示，且主题标签随之变化', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '3 次课' }));

    expect(screen.getByText(/将把最近 3 次课作为一个阶段整体反馈/)).toBeInTheDocument();
    expect(screen.getByLabelText(/课程内容（这几次课）/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^课程主题$/)).not.toBeInTheDocument();
  });

  it('2 次课提示文案数字正确', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '2 次课' }));
    expect(screen.getByText(/将把最近 2 次课作为一个阶段整体反馈/)).toBeInTheDocument();
  });

  it('切回 1 次课提示消失', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '3 次课' }));
    expect(screen.getByText(/作为一个阶段整体反馈/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1 次课' }));
    expect(screen.queryByText(/作为一个阶段整体反馈/)).not.toBeInTheDocument();
  });
});

describe('课后回访 · 课次数传递', () => {
  it('默认以 sessionCount=1 生成', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    const body = streamPost.mock.calls[0][1];
    expect(body.sessionCount).toBe(1);
  });

  it('选择 3 次课后以 sessionCount=3 生成', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '3 次课' }));
    await fillMinimalForm(user, '分数加减法、分数乘法、分数除法');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    const body = streamPost.mock.calls[0][1];
    expect(body.sessionCount).toBe(3);
    expect(body.topic).toBe('分数加减法、分数乘法、分数除法');
  });

  it('保存时同样带上课次数', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ followup: { id: 1 } });

    renderWithProviders(<FollowUp />);

    await user.click(screen.getByRole('button', { name: '2 次课' }));
    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await screen.findByTestId('generated-content');
    await clickSave(user);

    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.sessionCount).toBe(2);
  });
});

const STUDENTS = [
  { id: 1, name: '李一一', grade: '小学五年级', subject: '数学', createdAt: '', updatedAt: '' },
  { id: 2, name: '王思涵', grade: '小学五年级', subject: '数学', createdAt: '', updatedAt: '' },
  { id: 3, name: '张小北', grade: '小学六年级', subject: '英语', createdAt: '', updatedAt: '' },
] as any;

describe('课后回访 · 课程类型', () => {
  it('默认 1对1，显示单个学生输入与称呼字段', () => {
    renderWithProviders(<FollowUp />);

    expect(screen.getByRole('button', { name: '1对1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '小组课' })).toBeInTheDocument();
    expect(screen.getByLabelText(/学生姓名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/亲切称呼/)).toBeInTheDocument();
    // 精确匹配：正则 /选择学生/ 会误命中下拉框的「选择已有学生」
    expect(screen.queryByText('选择学生')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-count')).not.toBeInTheDocument();
  });

  it('切到小组课：出现多选列表，单个姓名输入消失', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: STUDENTS });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));

    expect(await screen.findByText('选择学生')).toBeInTheDocument();
    expect(screen.queryByLabelText(/学生姓名/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/亲切称呼/)).not.toBeInTheDocument();
    // 三名学生都出现
    for (const s of STUDENTS) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it('小组课可勾选多人并显示已选人数', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: STUDENTS });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByText('选择学生');

    const count = () => screen.getByTestId('selected-count').textContent || '';
    expect(count()).toMatch(/已选\s*0\s*人/);

    await user.click(screen.getByText('李一一'));
    expect(count()).toMatch(/已选\s*1\s*人/);

    await user.click(screen.getByText('王思涵'));
    expect(count()).toMatch(/已选\s*2\s*人/);

    // 再点一次取消勾选
    await user.click(screen.getByText('李一一'));
    expect(count()).toMatch(/已选\s*1\s*人/);
  });

  it('切换课程类型会清空已选学生', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: STUDENTS });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByText('选择学生');
    await user.click(screen.getByText('李一一'));
    expect(screen.getByTestId('selected-count').textContent).toMatch(/已选\s*1\s*人/);

    await user.click(screen.getByRole('button', { name: '1对1' }));
    await user.click(screen.getByRole('button', { name: '小组课' }));

    expect(screen.getByTestId('selected-count').textContent).toMatch(/已选\s*0\s*人/);
  });

  it('小组课未选学生时生成按钮禁用；选了之后恢复可用', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ students: STUDENTS });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByText('选择学生');

    await user.type(screen.getByLabelText(/课程主题/), '小组课主题');
    await user.type(screen.getByLabelText(/课堂表现/), '整体积极');

    const btn = screen.getByRole('button', { name: /生成课后回访内容/ });
    // 防呆优于报错：条件不满足时直接禁用
    expect(btn).toBeDisabled();
    expect(streamPost).not.toHaveBeenCalled();

    await user.click(screen.getByText('李一一'));
    expect(btn).toBeEnabled();
  });

  it('小组课生成时带 courseType=group 且不需要学生姓名', async () => {
    const user = userEvent.setup();
    stubStream();
    get.mockResolvedValue({ students: STUDENTS });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByText('选择学生');
    await user.click(screen.getByText('李一一'));

    await user.type(screen.getByLabelText(/课程主题/), '小组课主题');
    await user.type(screen.getByLabelText(/课堂表现/), '整体积极');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    const body = streamPost.mock.calls[0][1];
    expect(body.courseType).toBe('group');
    expect(body.studentName).toBe('');
  });

  it('小组课保存时提交 studentIds 数组', async () => {
    const user = userEvent.setup();
    stubStream();
    get.mockResolvedValue({ students: STUDENTS });
    post.mockResolvedValue({ followup: { id: 1, studentId: 1 }, created: 2 });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByText('选择学生');
    await user.click(screen.getByText('李一一'));
    await user.click(screen.getByText('王思涵'));

    await user.type(screen.getByLabelText(/课程主题/), '小组课主题');
    await user.type(screen.getByLabelText(/课堂表现/), '整体积极');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    await user.click(screen.getByRole('button', { name: /保存并归档|仍要保存/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.courseType).toBe('group');
    expect(body.studentIds).toEqual([1, 2]);
    expect(body.studentName).toBe('');
    expect(await screen.findByText(/已为 2 位学生各归档一条回访/)).toBeInTheDocument();
  });
});

describe('课后回访 · 称呼', () => {
  it('输入姓名后 placeholder 显示自动推导的称呼', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    await user.type(screen.getByLabelText(/学生姓名/), '李一一');

    // 未填写称呼时，placeholder 应展示推导结果
    expect(screen.getByLabelText(/亲切称呼/)).toHaveAttribute('placeholder', '一一');
  });

  it('生成时把称呼一并发给服务端', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    await user.type(screen.getByLabelText(/学生姓名/), '李一一');
    await user.type(screen.getByLabelText(/课程主题/), '分数加减法');
    await user.type(screen.getByLabelText(/课堂表现/), '专注');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    expect(streamPost.mock.calls[0][1].nickname).toBe('一一');
  });

  it('手动填写称呼时优先使用填写值', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    await user.type(screen.getByLabelText(/学生姓名/), '李一一');
    await user.type(screen.getByLabelText(/亲切称呼/), '小一');
    await user.type(screen.getByLabelText(/课程主题/), '分数加减法');
    await user.type(screen.getByLabelText(/课堂表现/), '专注');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    await waitFor(() => expect(streamPost).toHaveBeenCalled());
    expect(streamPost.mock.calls[0][1].nickname).toBe('小一');
  });
});

describe('课后回访 · 保存后的告知', () => {
  it('自动建档时给出提示', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ followup: { id: 1, studentId: 9 }, createdStudent: true });

    renderWithProviders(<FollowUp />);
    await user.type(screen.getByLabelText(/学生姓名/), '新同学');
    await user.type(screen.getByLabelText(/课程主题/), '主题');
    await user.type(screen.getByLabelText(/课堂表现/), '表现');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    await user.click(screen.getByRole('button', { name: /保存并归档|仍要保存/ }));

    expect(await screen.findByText(/学生库中没有「新同学」，已自动为其建立档案/)).toBeInTheDocument();
  });

  it('历史记录被归位时给出提示', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ followup: { id: 1, studentId: 5 }, backfilled: 3 });

    renderWithProviders(<FollowUp />);
    await user.type(screen.getByLabelText(/学生姓名/), '老同学');
    await user.type(screen.getByLabelText(/课程主题/), '主题');
    await user.type(screen.getByLabelText(/课堂表现/), '表现');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    await user.click(screen.getByRole('button', { name: /保存并归档|仍要保存/ }));

    expect(
      await screen.findByText(/已把 3 条同名历史回访归入该学生档案/)
    ).toBeInTheDocument();
  });
});

describe('课后回访 · 历史联想', () => {
  it('把历史里的高频短语一并展示，且优先于内置词', async () => {
    get.mockImplementation((path: string) => {
      if (String(path).startsWith('/followups/suggestions')) {
        return Promise.resolve({
          topics: [{ text: '我的常用主题', count: 5 }],
          phrases: [{ text: '这孩子思路活', count: 4 }],
        });
      }
      return Promise.resolve({ students: [] });
    });

    renderWithProviders(<FollowUp />);

    // 历史学到的短语出现
    expect(await screen.findByRole('button', { name: '这孩子思路活' })).toBeInTheDocument();
    // 内置通用词仍在（历史为空时也有词可用）
    expect(screen.getByRole('button', { name: '计算粗心' })).toBeInTheDocument();
  });

  it('历史主题出现在 datalist 里供联想', async () => {
    get.mockImplementation((path: string) => {
      if (String(path).startsWith('/followups/suggestions')) {
        return Promise.resolve({ topics: [{ text: '分数加减法', count: 3 }], phrases: [] });
      }
      return Promise.resolve({ students: [] });
    });

    const { container } = renderWithProviders(<FollowUp />);

    await waitFor(() => {
      expect(container.querySelector('#topic-suggestions option')).toBeTruthy();
    });

    const option = container.querySelector('#topic-suggestions option') as HTMLOptionElement;
    expect(option.value).toBe('分数加减法');
  });

  it('联想接口失败不影响正常使用', async () => {
    get.mockImplementation((path: string) => {
      if (String(path).startsWith('/followups/suggestions')) return Promise.reject(new Error('挂了'));
      return Promise.resolve({ students: [] });
    });

    renderWithProviders(<FollowUp />);

    // 内置短语仍在
    expect(await screen.findByRole('button', { name: '专注度高' })).toBeInTheDocument();
  });
});

describe('课后回访 · 小组课分组预设', () => {
  function mockGroupSetup() {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p === '/groups') {
        return Promise.resolve({
          groups: [{ id: 7, name: '周六三年级班', studentIds: [1, 3], memberCount: 2, staleCount: 0 }],
        });
      }
      if (p.startsWith('/followups/suggestions')) return Promise.resolve({ topics: [], phrases: [] });
      if (p.startsWith('/auth/preferences')) {
        return Promise.resolve({ preferences: { phraseMode: 'mixed', pendingDays: 7 } });
      }
      return Promise.resolve({ students: STUDENTS });
    });
  }

  it('点分组即全选成员，人数正确', async () => {
    const user = userEvent.setup();
    mockGroupSetup();

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByTestId('selected-count');

    expect(screen.getByTestId('selected-count').textContent).toMatch(/已选\s*0\s*人/);

    await user.click(screen.getByRole('button', { name: /周六三年级班/ }));

    expect(screen.getByTestId('selected-count').textContent).toMatch(/已选\s*2\s*人/);
  });

  it('默认全选后可以手动取消请假的同学', async () => {
    const user = userEvent.setup();
    mockGroupSetup();

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByTestId('selected-count');

    await user.click(screen.getByRole('button', { name: /周六三年级班/ }));
    expect(screen.getByTestId('selected-count').textContent).toMatch(/已选\s*2\s*人/);

    // 取消其中一位（张小北 id=3）
    await user.click(screen.getByText('张小北'));
    expect(screen.getByTestId('selected-count').textContent).toMatch(/已选\s*1\s*人/);
  });

  it('把当前选择存为分组', async () => {
    const user = userEvent.setup();
    mockGroupSetup();
    post.mockResolvedValue({ group: { id: 9, name: '新分组', studentIds: [1], memberCount: 1 } });

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByTestId('selected-count');

    await user.click(screen.getByText('李一一'));
    await user.click(screen.getByRole('button', { name: '＋ 存为分组' }));

    await user.type(screen.getByPlaceholderText(/周六上午三年级班/), '新分组');
    await user.click(screen.getByRole('button', { name: /保存（1 人）/ }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/groups', { name: '新分组', studentIds: [1] });
    });
    expect(await screen.findByText(/已保存分组「新分组」/)).toBeInTheDocument();
  });

  it('未选学生时提示先选人', async () => {
    const user = userEvent.setup();
    mockGroupSetup();

    renderWithProviders(<FollowUp />);
    await user.click(screen.getByRole('button', { name: '小组课' }));
    await screen.findByTestId('selected-count');

    await user.click(screen.getByRole('button', { name: '＋ 存为分组' }));
    await user.type(screen.getByPlaceholderText(/周六上午三年级班/), '空分组');
    await user.click(screen.getByRole('button', { name: /保存（0 人）/ }));

    expect(await screen.findByText('请先选择学生，再存为分组')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('课后回访 · 快捷短语模式开关', () => {
  function mockWithPhrases(phraseMode: 'mixed' | 'history_only' = 'mixed') {
    get.mockImplementation((path: string) => {
      if (String(path) === '/auth/preferences') {
        return Promise.resolve({ preferences: { phraseMode, pendingDays: 7 } });
      }
      if (String(path).startsWith('/followups/suggestions')) {
        return Promise.resolve({ topics: [], phrases: [{ text: '我的专属用词', count: 3 }] });
      }
      return Promise.resolve({ students: [] });
    });
  }

  it('默认模式：历史用词与内置通用词同时出现', async () => {
    mockWithPhrases('mixed');
    renderWithProviders(<FollowUp />);

    expect(await screen.findByRole('button', { name: '我的专属用词' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '计算粗心' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '含内置通用词' })).toBeInTheDocument();
  });

  it('偏好为"仅用我的历史"时，内置通用词不出现', async () => {
    mockWithPhrases('history_only');
    renderWithProviders(<FollowUp />);

    expect(await screen.findByRole('button', { name: '我的专属用词' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '计算粗心' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仅用我的历史' })).toBeInTheDocument();
  });

  it('点击开关会切换模式并落库', async () => {
    const user = userEvent.setup();
    mockWithPhrases('mixed');
    put.mockResolvedValue({ preferences: { phraseMode: 'history_only', pendingDays: 7 } });

    renderWithProviders(<FollowUp />);
    await screen.findByRole('button', { name: '含内置通用词' });

    await user.click(screen.getByRole('button', { name: '含内置通用词' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/auth/preferences', expect.objectContaining({ phraseMode: 'history_only' }));
    });

    expect(await screen.findByRole('button', { name: '仅用我的历史' })).toBeInTheDocument();
  });

  it('仅用历史且暂无历史时给出说明', async () => {
    get.mockImplementation((path: string) => {
      if (String(path) === '/auth/preferences') {
        return Promise.resolve({ preferences: { phraseMode: 'history_only', pendingDays: 7 } });
      }
      if (String(path).startsWith('/followups/suggestions')) {
        return Promise.resolve({ topics: [], phrases: [] });
      }
      return Promise.resolve({ students: [] });
    });

    renderWithProviders(<FollowUp />);

    expect(await screen.findByText(/还没有历史记录/)).toBeInTheDocument();
  });
});

describe('课后回访 · 保存后继续下一个', () => {
  it('勾选后保存不跳转，并重置学生与内容', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ followup: { id: 1, studentId: 1 } });

    renderWithProviders(<FollowUp />);

    await user.type(screen.getByLabelText(/学生姓名/), '李一一');
    await user.type(screen.getByLabelText(/课程主题/), '分数加减法');
    await user.type(screen.getByLabelText(/课堂表现/), '专注');
    await user.type(screen.getByLabelText(/课堂表现/), '高');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    await user.click(screen.getByLabelText(/保存后继续填下一个学生/));
    await user.click(screen.getByRole('button', { name: /保存并归档|仍要保存/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());

    // 学生与内容被清空，年级/学科保留
    expect(screen.getByLabelText(/学生姓名/)).toHaveValue('');
    expect(screen.getByLabelText(/课程主题/)).toHaveValue('');
    expect(screen.getByLabelText(/年级/)).toHaveValue('小学三年级');
    expect(await screen.findByText(/已归档，可以继续填下一个学生/)).toBeInTheDocument();
  });
});

describe('课后回访 · 课堂表现快捷短语', () => {
  it('点一下即插入，再点不重复插入', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    const box = screen.getByLabelText(/课堂表现/) as HTMLTextAreaElement;

    await user.click(screen.getByRole('button', { name: '专注度高' }));
    expect(box.value).toBe('专注度高');

    await user.click(screen.getByRole('button', { name: '计算粗心' }));
    expect(box.value).toBe('专注度高，计算粗心');

    // 重复点击不应叠加
    await user.click(screen.getByRole('button', { name: '专注度高' }));
    expect(box.value).toBe('专注度高，计算粗心');
  });

  it('已插入的短语标记为激活态', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    const chip = screen.getByRole('button', { name: '主动提问' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');

    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('课后回访 · 草稿恢复（切微信回来不丢数据）', () => {
  it('重新进入页面时恢复上次未保存的表单与文案', async () => {
    localStorage.setItem(
      'tw:followup-draft:v1',
      JSON.stringify({
        savedAt: Date.now(),
        form: { studentName: '李一一', topic: '分数加减法', performance: '专注度高' },
        images: [],
        selectedIds: [],
        content: '【课堂内容】上次生成但没保存的内容。',
        draft: '',
      })
    );

    renderWithProviders(<FollowUp />);

    expect(screen.getByLabelText(/学生姓名/)).toHaveValue('李一一');
    expect(screen.getByLabelText(/课程主题/)).toHaveValue('分数加减法');
    expect(screen.getByLabelText(/课堂表现/)).toHaveValue('专注度高');
    expect(screen.getByTestId('generated-content')).toHaveTextContent('上次生成但没保存的内容');
  });

  it('恢复草稿时给出提示，避免用户困惑', async () => {
    localStorage.setItem(
      'tw:followup-draft:v1',
      JSON.stringify({
        savedAt: Date.now(),
        form: { studentName: '李一一', topic: 'x', performance: 'y' },
        images: [],
        selectedIds: [],
        content: '',
        draft: '',
      })
    );

    renderWithProviders(<FollowUp />);

    expect(await screen.findByText('已恢复上次未保存的内容')).toBeInTheDocument();
  });

  it('没有草稿时不提示', async () => {
    renderWithProviders(<FollowUp />);

    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText('已恢复上次未保存的内容')).not.toBeInTheDocument();
  });

  it('保存成功后清除草稿，重新进入不再恢复', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ followup: { id: 1, studentId: 1 } });

    renderWithProviders(<FollowUp />);
    await user.type(screen.getByLabelText(/学生姓名/), '李一一');
    await user.type(screen.getByLabelText(/课程主题/), '分数加减法');
    await user.type(screen.getByLabelText(/课堂表现/), '专注');
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    await user.click(screen.getByRole('button', { name: /保存并归档|仍要保存/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    await waitFor(() => {
      expect(localStorage.getItem('tw:followup-draft:v1')).toBeNull();
    });
  });
});

async function generateOnce(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/学生姓名/), '李小明');
  await user.type(screen.getByLabelText(/课程主题/), '分数加减法运算');
  await user.type(screen.getByLabelText(/课堂表现/), '专注度较高');
  await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
  await screen.findByTestId('generated-content');
}

describe('课后回访 · 流程打卡新规达标线', () => {
  // 学校新规：打卡文字约 150 字、课堂照片不少于 3 张。
  // 这里只锁 UI 上的达标提示，提示词的约束由服务端 course-type.test.ts 锁。
  // 默认勾选 5 个板块，字数区间随之放宽到 200–300
  it('字数超上限时提示动态区间与板块数，图片卡片写明 3 张要求', async () => {
    const user = userEvent.setup();
    // 故意给一段超上限的内容，好让「字数不达标」提示出现
    stubStream(GENERATED + '补充说明'.repeat(60));
    renderWithProviders(<FollowUp />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    // 提示文案由多个表达式拼接成一段，用容器全文断言，不被节点切分影响
    const bodyText = document.body.textContent || '';
    expect(bodyText).toContain('当前 415 字');
    expect(bodyText).toContain('需 200–300 字');
    expect(bodyText).toContain('5 个板块');
    expect(bodyText).toContain('不少于 3 张');
  });

  it('字数落在区间内时不再提示不达标', async () => {
    const user = userEvent.setup();
    // 175 + 80 = 255 字，落在 5 个板块的 200–300 区间内
    stubStream(GENERATED + '补充说明'.repeat(20));
    renderWithProviders(<FollowUp />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    const bodyText = document.body.textContent || '';
    expect(bodyText).not.toContain('需 200–300 字');
    await clickSave(user);
    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});

describe('课后回访 · 覆盖板块（多选，常规类 9 + 非常规类 7）', () => {
  // 回访内容本质是向家长展示教学服务流程：一次回访要覆盖 5 个以上流程环节，
  // 每次课的环节灵活变动，所以 5 个是「建议下限」而不是硬门槛——少了也能生成。
  // 这里只锁 UI 选择与请求载荷；提示词按板块换写法由服务端 followup-module.test.ts 锁。

  it('默认勾选 5 个板块，两组类型与十六个选项都在', () => {
    renderWithProviders(<FollowUp />);

    expect(screen.getByText('覆盖板块')).toBeInTheDocument();
    expect(screen.getByText(/已选 5 个，够用/)).toBeInTheDocument();
    expect(screen.getByText('常规类')).toBeInTheDocument();
    expect(screen.getByText(/日常回访的主体/)).toBeInTheDocument();
    expect(screen.getByText('非常规类')).toBeInTheDocument();
    expect(screen.getByText(/特殊情况的沟通/)).toBeInTheDocument();

    for (const label of [
      '课程主题',
      '课堂总结',
      '作业批改',
      '笔记/解题痕迹',
      '预习资料',
      '错题专练',
      '作业布置',
      '积累打卡',
      '备考资料',
      '成绩分析',
      '阶测反馈',
      '规划调整',
      '学生要求',
      '学管协助',
      '加课沟通',
      '补课安排',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('默认勾选 5 个板块，按声明顺序传给生成与保存载荷', async () => {
    const user = userEvent.setup();
    stubStream();
    post.mockResolvedValue({ id: 1 });
    renderWithProviders(<FollowUp />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    // 按 FOLLOWUP_MODULES 声明顺序排列，而不是勾选顺序
    const expected = [
      'class_content',
      'class_performance',
      'homework_review',
      'note_trace',
      'homework_assign',
    ];
    expect(streamPost.mock.calls[0][1].modules).toEqual(expected);

    await clickSave(user);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].modules).toEqual(expected);
  });

  it('常规类与非常规类都能继续勾选，生成载荷随勾选变化', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    // 常规类：把「错题专练」加上
    await user.click(screen.getByRole('button', { name: '错题专练' }));
    // 非常规类：把「成绩分析」加上
    await user.click(screen.getByRole('button', { name: '成绩分析' }));
    expect(screen.getByText(/已选 7 个，够用/)).toBeInTheDocument();

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    const sent = streamPost.mock.calls[0][1].modules;
    expect(sent).toContain('mistake_drill');
    expect(sent).toContain('grade_analysis');
    expect(sent).toHaveLength(7);
  });

  it('取消到 3 个板块时只做软提示，仍然能生成', async () => {
    const user = userEvent.setup();
    stubStream();
    renderWithProviders(<FollowUp />);

    // 取消两个默认板块，只剩 3 个
    await user.click(screen.getByRole('button', { name: '课程主题' }));
    await user.click(screen.getByRole('button', { name: '作业布置' }));
    expect(screen.getByText(/已选 3 个（建议 5 个以上）/)).toBeInTheDocument();

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));

    // 软提示而非硬拦：给出建议，但照常生成
    expect(await screen.findByText(/建议一次回访覆盖 5 个以上板块/)).toBeInTheDocument();
    expect(screen.queryByText(/请至少勾选 5 个板块/)).not.toBeInTheDocument();
    expect(streamPost).toHaveBeenCalledTimes(1);
    // modules 按板块声明顺序排：课堂总结、作业批改、笔记/解题痕迹
    expect(streamPost.mock.calls[0][1].modules).toEqual([
      'class_performance',
      'homework_review',
      'note_trace',
    ]);
  });

  it('板块数减少时，字数区间按实际板块数实时收紧', async () => {
    const user = userEvent.setup();
    stubStream(GENERATED + '补充说明'.repeat(60));
    renderWithProviders(<FollowUp />);

    await fillMinimalForm(user);
    await user.click(screen.getByRole('button', { name: /生成课后回访内容/ }));
    await screen.findByTestId('generated-content');

    // 5 个板块的区间是 200–300，415 字的内容超出上限
    let body = document.body.textContent || '';
    expect(body).toContain('需 200–300 字（5 个板块）');

    // 取消两个板块后区间随实际板块数收紧到 170–250
    await user.click(screen.getByRole('button', { name: '课程主题' }));
    await user.click(screen.getByRole('button', { name: '作业布置' }));
    body = document.body.textContent || '';
    expect(body).toContain('需 170–250 字（3 个板块）');
  });

  it('勾选后计数实时更新，5 个及以上用绿色标记', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FollowUp />);

    const counter = screen.getByText(/已选 5 个，够用/);
    expect(counter.className).toContain('text-emerald-600');

    await user.click(screen.getByRole('button', { name: '成绩分析' }));
    expect(screen.getByText(/已选 6 个，够用/)).toBeInTheDocument();

    // 降到 5 个以下时退出绿色态
    await user.click(screen.getByRole('button', { name: '作业批改' }));
    expect(screen.getByText(/已选 5 个，够用/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '课堂总结' }));
    expect(screen.getByText(/已选 4 个（建议 5 个以上）/)).toBeInTheDocument();
  });
});