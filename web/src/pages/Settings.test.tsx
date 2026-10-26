import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
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
const put = api.put as Mock;
const post = api.post as Mock;

/** 模型列表接口的默认 mock：当前模型在列表里（下拉模式） */
const DEFAULT_MODELS = {
  models: [
    { id: 'model-a', label: 'model-a' },
    {
      id: 'sensenova-6.8-flash-lite',
      label: 'SenseNova 6.8 Flash Lite（轻量多模态智能体 · 速度快（默认））',
      name: 'SenseNova 6.8 Flash Lite',
      description: '轻量多模态智能体 · 速度快（默认）',
      vision: true,
      efforts: ['none', 'low', 'medium', 'high', 'max'],
    },
  ],
  source: 'api',
  current: 'sensenova-6.8-flash-lite',
};

function mockSettings(
  overrides: Record<string, any> = {},
  models: any = DEFAULT_MODELS
) {
  get.mockImplementation((path: string) => {
    if (String(path) === '/settings/models') return Promise.resolve(models);
    return Promise.resolve({
      settings: {
        'ai.model': 'sensenova-6.8-flash-lite',
        'ai.reasoningEffort': 'low',
        'ai.baseUrl': 'https://token.sensenova.cn/v1',
        'ai.timeoutMs': '60000',
        'ai.apiKey': { configured: true, masked: '••••••••abcd' },
        ...overrides,
      },
      overridden: [],
      meta: { effortLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
    });
  });
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  post.mockReset();
});

describe('设置页 · AI 设置', () => {
  it('回显当前配置', async () => {
    mockSettings();
    renderWithProviders(<Settings />);

    const model = (await screen.findByLabelText('模型')) as HTMLSelectElement;
    expect(model.value).toBe('sensenova-6.8-flash-lite');
    expect(screen.getByDisplayValue('https://token.sensenova.cn/v1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('60000')).toBeInTheDocument();
  });

  it('密钥只显示掩码，不出现明文', async () => {
    mockSettings();
    renderWithProviders(<Settings />);

    expect(await screen.findByText(/已配置/)).toBeInTheDocument();
    expect(screen.getByText(/••••••••abcd/)).toBeInTheDocument();
    // 输入框默认为空（不会把掩码填进去）
    const keyInput = screen.getByLabelText(/API Key/) as HTMLInputElement;
    expect(keyInput.value).toBe('');
  });

  it('未配置密钥时给出警告', async () => {
    mockSettings({ 'ai.apiKey': { configured: false, masked: '' } });
    renderWithProviders(<Settings />);

    expect(await screen.findByText(/未配置，无法生成回访/)).toBeInTheDocument();
  });

  it('保存时提交修改后的模型与思考等级', async () => {
    const user = userEvent.setup();
    mockSettings();
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    // select 不能用 clear+type，改用下拉选择
    await user.selectOptions(screen.getByLabelText('模型'), 'model-a');
    await user.selectOptions(screen.getByLabelText('思考等级'), 'high');

    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ 'ai.model': 'model-a', 'ai.reasoningEffort': 'high' })
      );
    });
    expect(await screen.findByText(/AI 设置已保存/)).toBeInTheDocument();
  });

  it('下拉显示平台返回的模型，并带"自定义模型…"入口', async () => {
    mockSettings();
    renderWithProviders(<Settings />);

    const select = await screen.findByLabelText('模型');
    const options = within(select).getAllByRole('option');

    // 平台返回的两个 + 自定义入口
    expect(options.map((o) => o.textContent)).toEqual([
      'model-a',
      'SenseNova 6.8 Flash Lite（轻量多模态智能体 · 速度快（默认））',
      '自定义模型…',
    ]);
    // 默认选中当前配置的模型
    expect((select as HTMLSelectElement).value).toBe('sensenova-6.8-flash-lite');
    // 提示列表来自平台实时查询
    expect(screen.getByText(/列表来自平台实时查询/)).toBeInTheDocument();
  });

  it('选择"自定义模型…"后切换为文本输入，可返回下拉', async () => {
    const user = userEvent.setup();
    mockSettings();
    renderWithProviders(<Settings />);

    const select = await screen.findByLabelText('模型');
    await user.selectOptions(select, '__custom__');

    // 出现文本输入框（带原有值，便于在它基础上改）
    const input = screen.getByLabelText('模型名称') as HTMLInputElement;
    expect(input.value).toBe('sensenova-6.8-flash-lite');

    // 手填一个新模型并保存
    await user.clear(input);
    await user.type(input, 'brand-new-model');
    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ 'ai.model': 'brand-new-model' })
      );
    });

    // 返回下拉选择
    await user.click(screen.getByRole('button', { name: /返回下拉选择/ }));
    expect(screen.getByLabelText('模型')).toBeInTheDocument();
    expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
  });

  it('当前配置的模型不在平台列表中时，自动进入自定义模式', async () => {
    mockSettings(
      { 'ai.model': 'my-own-model' },
      { ...DEFAULT_MODELS, current: 'my-own-model' }
    );
    renderWithProviders(<Settings />);

    // 直接出现文本输入框，值为当前配置
    const input = (await screen.findByLabelText('模型名称')) as HTMLInputElement;
    expect(input.value).toBe('my-own-model');
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
  });

  it('模型列表接口失败时仍可手填（不影响设置页可用）', async () => {
    mockSettings({}, null); // /settings/models 返回 null → 前端忽略
    renderWithProviders(<Settings />);

    // 列表为空 → 退回文本输入
    const input = (await screen.findByLabelText('模型名称')) as HTMLInputElement;
    expect(input.value).toBe('sensenova-6.8-flash-lite');
  });

  it('选择不支持读图的模型时给出警告', async () => {
    const user = userEvent.setup();
    mockSettings(
      {},
      {
        models: [
          {
            id: 'glm-5.2',
            label: 'GLM-5.2（智谱旗舰 · 不支持读图）',
            name: 'GLM-5.2',
            description: '智谱旗舰 · 不支持读图',
            vision: false,
            efforts: ['none', 'low', 'high', 'xhigh', 'max'],
          },
          DEFAULT_MODELS.models[1],
        ],
        source: 'api',
        current: 'sensenova-6.8-flash-lite',
      }
    );
    renderWithProviders(<Settings />);

    await screen.findByLabelText('模型');

    // 默认选中的是支持读图的模型，不应有警告
    expect(screen.queryByText(/不支持读取图片/)).not.toBeInTheDocument();

    // 切到 GLM-5.2 → 出现警告
    await user.selectOptions(screen.getByLabelText('模型'), 'glm-5.2');
    expect(await screen.findByText(/不支持读取图片/)).toBeInTheDocument();
  });

  it('思考等级的档位跟随所选模型', async () => {
    const user = userEvent.setup();
    mockSettings(
      {},
      {
        models: [
          {
            id: 'glm-5.2',
            label: 'GLM-5.2',
            name: 'GLM-5.2',
            description: '',
            vision: false,
            efforts: ['none', 'low', 'high', 'xhigh', 'max'],
          },
          DEFAULT_MODELS.models[1],
        ],
        source: 'api',
        current: 'sensenova-6.8-flash-lite',
      }
    );
    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    // 默认（6.8-flash-lite）：档位不含 xhigh
    let options = within(screen.getByLabelText('思考等级')).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).not.toContain('xhigh');

    // 切到 GLM-5.2：档位含 xhigh
    await user.selectOptions(screen.getByLabelText('模型'), 'glm-5.2');
    options = within(screen.getByLabelText('思考等级')).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).toContain('xhigh');
  });

  it('切换模型后当前档位不被支持时自动回落到 low', async () => {
    mockSettings(
      // 初始档位设为 xhigh（GLM 支持、6.8-flash-lite 不支持）
      { 'ai.reasoningEffort': 'xhigh' },
      {
        models: [
          {
            id: 'glm-5.2',
            label: 'GLM-5.2',
            name: 'GLM-5.2',
            description: '',
            vision: false,
            efforts: ['none', 'low', 'high', 'xhigh', 'max'],
          },
          DEFAULT_MODELS.models[1],
        ],
        source: 'api',
        current: 'sensenova-6.8-flash-lite',
      }
    );
    renderWithProviders(<Settings />);

    const effort = await screen.findByLabelText('思考等级');
    // 当前模型 6.8-flash-lite 不支持 xhigh → 应已回落为 low
    expect((effort as HTMLSelectElement).value).toBe('low');
  });

  it('只在真的输入了新密钥时才提交密钥字段', async () => {
    const user = userEvent.setup();
    mockSettings();
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    // 不填密钥直接保存
    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());

    const body = put.mock.calls[0][1];
    expect(body).not.toHaveProperty('ai.apiKey', expect.anything());
    expect('ai.apiKey' in body).toBe(false);
  });

  it('已覆盖的项可一键恢复为 .env 配置', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({
      settings: {
        'ai.model': 'custom',
        'ai.reasoningEffort': 'high',
        'ai.baseUrl': 'https://x/v1',
        'ai.timeoutMs': '60000',
        'ai.apiKey': { configured: true, masked: '••••••••abcd' },
      },
      overridden: ['ai.model'],
      meta: { effortLevels: ['low', 'high'] },
    });
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByText(/以下项已被自定义/);

    await user.click(screen.getByRole('button', { name: /model ✕/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/settings', { 'ai.model': '' });
    });
  });

  it('全部恢复：一次清掉所有覆盖项', async () => {
    const user = userEvent.setup();
    const settings: Record<string, any> = {
      'ai.model': 'custom',
      'ai.timeoutMs': '90000',
      'ai.baseUrl': 'https://x/v1',
    };
    let overridden: string[] = ['ai.model', 'ai.timeoutMs'];
    // 有状态：保存后重新加载会反映清掉之后的结果
    get.mockImplementation((path: string) => {
      if (String(path) === '/settings/models') return Promise.resolve(DEFAULT_MODELS);
      return Promise.resolve({
        settings,
        overridden,
        meta: {
          effortLevels: ['low'],
          defaults: { 'ai.model': 'default', 'ai.timeoutMs': '60000', 'ai.baseUrl': 'https://x/v1' },
        },
      });
    });
    put.mockImplementation(async (_path: string, body: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(body)) {
        if (v === '') overridden = overridden.filter((o) => o !== k);
        else settings[k] = v;
      }
      return { success: true };
    });

    renderWithProviders(<Settings />);
    await screen.findByText(/以下项已被自定义/);

    await user.click(screen.getByRole('button', { name: '全部恢复为 .env' }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/settings', { 'ai.model': '', 'ai.timeoutMs': '' });
    });
    // 重新加载后没有任何覆盖项了，面板消失（比断言 toast 文案更本质）
    await waitFor(() => {
      expect(screen.queryByText(/以下项已被自定义/)).not.toBeInTheDocument();
    });
  });
});

describe('设置页 · 防止 .env 出厂值被冻结', () => {
  // 出厂值必须和有效值一模一样，才能验证「没改过的字段不会被提交」
  const factory: Record<string, string> = {
    'ai.provider': 'sensenova',
    'ai.model': 'sensenova-6.8-flash-lite',
    'ai.reasoningEffort': 'low',
    'ai.baseUrl': 'https://token.sensenova.cn/v1',
    'ai.timeoutMs': '60000',
    'ai.prompt.style': 'balanced',
    'ai.apiKey': '',
    'ai.geminiProxy.provider': 'gemini-proxy',
    'ai.geminiProxy.model': 'gemini-3.8-flash',
    'ai.geminiProxy.baseUrl': 'https://api.gemmaproxy.dpdns.org/v1',
    'ai.geminiProxy.apiKey': '',
  };

  function mockWithDefaults(overrides: Record<string, any> = {}, overridden: string[] = []) {
    get.mockImplementation((path: string) => {
      if (String(path) === '/settings/models') return Promise.resolve(DEFAULT_MODELS);
      return Promise.resolve({
        settings: {
          'ai.provider': 'sensenova',
          'ai.model': factory['ai.model'],
          'ai.reasoningEffort': factory['ai.reasoningEffort'],
          'ai.baseUrl': factory['ai.baseUrl'],
          'ai.timeoutMs': factory['ai.timeoutMs'],
          'ai.prompt.style': factory['ai.prompt.style'],
          'ai.apiKey': { configured: true, masked: '••••••••abcd' },
          ...overrides,
        },
        overridden,
        meta: {
          effortLevels: ['none', 'low', 'medium', 'high', 'max'],
          writableKeys: Object.keys(factory),
          defaults: factory,
        },
      });
    });
  }

  it('什么都没改就点保存：不发任何请求（核心回归——这就是把 .env 冻结的源头）', async () => {
    const user = userEvent.setup();
    mockWithDefaults();
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));

    // 给足时间，若真发了请求 waitFor 也会拿到
    await new Promise((r) => setTimeout(r, 100));
    expect(put).not.toHaveBeenCalled();
    expect(await screen.findByText(/没有需要保存的改动/)).toBeInTheDocument();
  });

  it('只改一个字段：只提交那一个，其余出厂值一律不碰', async () => {
    const user = userEvent.setup();
    mockWithDefaults();
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.selectOptions(screen.getByLabelText('模型'), 'model-a');
    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1] as Record<string, string>;
    expect(Object.keys(body)).toEqual(['ai.model']);
    expect(body['ai.model']).toBe('model-a');
  });

  it('切服务商：接口地址立刻换成该服务商的出厂值，共用字段不丢（用户报的场景）', async () => {
    const user = userEvent.setup();
    // 有状态：切换服务商后重新加载要真的按新服务商回数据
    const settings: Record<string, any> = {
      'ai.provider': 'sensenova',
      'ai.model': factory['ai.model'],
      'ai.reasoningEffort': 'medium',
      'ai.baseUrl': factory['ai.baseUrl'],
      'ai.timeoutMs': factory['ai.timeoutMs'],
      'ai.prompt.style': 'detailed',
      'ai.apiKey': { configured: true, masked: '••••••••abcd' },
    };
    let overridden: string[] = [];
    get.mockImplementation((path: string) => {
      if (String(path) === '/settings/models') return Promise.resolve(DEFAULT_MODELS);
      return Promise.resolve({
        settings,
        overridden,
        meta: {
          effortLevels: ['none', 'low', 'medium', 'high', 'max'],
          writableKeys: Object.keys(factory),
          defaults: factory,
        },
      });
    });
    // 复刻后端规则：写空串或写成出厂值都算「清掉覆盖」
    put.mockImplementation(async (_path: string, body: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(body)) {
        if (v === '' || v === factory[k]) {
          delete settings[k];
          overridden = overridden.filter((o) => o !== k);
        } else {
          settings[k] = v;
          if (!overridden.includes(k)) overridden.push(k);
        }
      }
      return { success: true };
    });

    renderWithProviders(<Settings />);
    expect(((await screen.findByLabelText('接口地址')) as HTMLInputElement).value).toBe(
      factory['ai.baseUrl']
    );

    await user.selectOptions(screen.getByLabelText('AI 服务商'), 'gemini-proxy');

    // 接口地址立刻变成代理地址（不用等保存，也不依赖 .env 里有没有配）
    await waitFor(() => {
      expect((screen.getByLabelText('接口地址') as HTMLInputElement).value).toBe(
        factory['ai.geminiProxy.baseUrl']
      );
    });
    // 共用字段（思考等级、风格偏好）跟着账号走，切换时不丢
    expect((screen.getByLabelText('思考等级') as HTMLSelectElement).value).toBe('medium');
    expect((screen.getByLabelText(/风格偏好/) as HTMLInputElement).value).toBe('detailed');

    // 切回：地址回到 SenseNova 的出厂值
    await user.selectOptions(screen.getByLabelText('AI 服务商'), 'sensenova');
    await waitFor(() => {
      expect((screen.getByLabelText('接口地址') as HTMLInputElement).value).toBe(
        factory['ai.baseUrl']
      );
    });
  });

  it('改过又改回出厂值：提交空串清掉覆盖，不留冻结值', async () => {
    const user = userEvent.setup();
    const settings: Record<string, any> = {
      'ai.provider': 'sensenova',
      'ai.model': 'my-custom-model',
      'ai.reasoningEffort': factory['ai.reasoningEffort'],
      'ai.baseUrl': factory['ai.baseUrl'],
      'ai.timeoutMs': factory['ai.timeoutMs'],
      'ai.prompt.style': factory['ai.prompt.style'],
      'ai.apiKey': { configured: true, masked: '••••••••abcd' },
    };
    let overridden: string[] = ['ai.model'];
    get.mockImplementation((path: string) => {
      // 模型列表不可用 → 界面退化为手填输入框（这正是用户存自定义模型的常见路径）
      if (String(path) === '/settings/models') return Promise.resolve(null);
      return Promise.resolve({
        settings,
        overridden,
        meta: {
          effortLevels: ['none', 'low', 'medium', 'high', 'max'],
          writableKeys: Object.keys(factory),
          defaults: factory,
        },
      });
    });
    put.mockImplementation(async (_path: string, body: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(body)) {
        if (v === '') overridden = overridden.filter((o) => o !== k);
        else settings[k] = v;
      }
      return { success: true };
    });

    renderWithProviders(<Settings />);
    // 库里存的是自定义模型名，界面以手填输入框呈现它
    const input = (await screen.findByLabelText('模型名称')) as HTMLInputElement;
    expect(input.value).toBe('my-custom-model');

    await user.clear(input);
    await user.type(input, factory['ai.model']);
    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/settings', { 'ai.model': '' });
    });
  });

  it('接口地址提示：已自定义时说明 .env 不会生效', async () => {
    mockWithDefaults({ 'ai.baseUrl': 'https://my-private-gateway/v1' }, ['ai.baseUrl']);
    renderWithProviders(<Settings />);

    expect(await screen.findByText(/已自定义，优先级高于 \.env/)).toBeInTheDocument();
    expect(screen.queryByText(/沿用 \.env 中的配置/)).not.toBeInTheDocument();
  });

  it('接口地址沿用出厂值时提示 .env 会自动生效', async () => {
    mockWithDefaults();
    renderWithProviders(<Settings />);

    expect(await screen.findByText(/沿用 \.env 中的配置，改 \.env 会自动生效/)).toBeInTheDocument();
    expect(screen.queryByText(/已自定义，优先级高于/)).not.toBeInTheDocument();
  });
});


describe('设置页 · 修改密码', () => {
  it('两次新密码不一致时阻止提交', async () => {
    const user = userEvent.setup();
    mockSettings();
    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.type(screen.getByLabelText(/当前密码/), 'old-pass-123');
    await user.type(screen.getByLabelText('新密码'), 'new-pass-456');
    await user.type(screen.getByLabelText(/确认新密码/), 'different');
    await user.click(screen.getByRole('button', { name: /修改密码/ }));

    expect(await screen.findByText('两次输入的新密码不一致')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('新密码过短时阻止提交', async () => {
    const user = userEvent.setup();
    mockSettings();
    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.type(screen.getByLabelText(/当前密码/), 'old-pass-123');
    await user.type(screen.getByLabelText('新密码'), '123');
    await user.type(screen.getByLabelText(/确认新密码/), '123');
    await user.click(screen.getByRole('button', { name: /修改密码/ }));

    expect(await screen.findByText('新密码长度至少 6 位')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('校验通过时提交并清空表单', async () => {
    const user = userEvent.setup();
    mockSettings();
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.type(screen.getByLabelText(/当前密码/), 'old-pass-123');
    await user.type(screen.getByLabelText('新密码'), 'new-pass-456');
    await user.type(screen.getByLabelText(/确认新密码/), 'new-pass-456');
    await user.click(screen.getByRole('button', { name: /修改密码/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/auth/password', {
        currentPassword: 'old-pass-123',
        newPassword: 'new-pass-456',
      });
    });

    expect(await screen.findByText(/密码已修改/)).toBeInTheDocument();
    expect((screen.getByLabelText(/当前密码/) as HTMLInputElement).value).toBe('');
  });

  it('后端拒绝时展示具体原因', async () => {
    const user = userEvent.setup();
    mockSettings();
    put.mockRejectedValue(new Error('当前密码不正确'));

    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.type(screen.getByLabelText(/当前密码/), 'wrong');
    await user.type(screen.getByLabelText('新密码'), 'new-pass-456');
    await user.type(screen.getByLabelText(/确认新密码/), 'new-pass-456');
    await user.click(screen.getByRole('button', { name: /修改密码/ }));

    expect(await screen.findByText(/修改密码失败：当前密码不正确/)).toBeInTheDocument();
  });
});

describe('设置页 · 课程目录维护', () => {
  it('清除已导入课程规划：确认后调接口，提示清了多少', async () => {
    mockSettings();
    post.mockResolvedValue({
      removed: 3589,
      reassigned: 7,
      importsRemoved: 2,
      deduped: 18,
      remaining: 3589,
    });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.click(screen.getByTestId('reset-catalog-to-builtin'));
    expect(screen.getByText('清除已导入的课程规划？')).toBeInTheDocument();
    expect(screen.getByText(/课时来源会被改指到内置同名课/)).toBeInTheDocument();
    expect(screen.getByText(/不可撤销/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '清除，只保留系统内置' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/catalog/reset-to-builtin', {}));
    expect(
      await screen.findByText(/已清除 3589 条已导入课程、2 条导入记录/)
    ).toBeInTheDocument();
    expect(screen.getByText(/7 处月度总结\/课堂观察的课时来源已改指/)).toBeInTheDocument();
    expect(screen.getByText(/收尾又合并掉 18 条重复课程/)).toBeInTheDocument();
    // 确认框关掉了
    expect(screen.queryByText('清除已导入的课程规划？')).not.toBeInTheDocument();
  });

  it('接口报错时给出提示，不静默失败', async () => {
    mockSettings();
    post.mockRejectedValue(new Error('清理失败'));
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await screen.findByLabelText('模型');

    await user.click(screen.getByTestId('reset-catalog-to-builtin'));
    await user.click(screen.getByRole('button', { name: '清除，只保留系统内置' }));

    expect(await screen.findByText(/清理失败/)).toBeInTheDocument();
  });
});
