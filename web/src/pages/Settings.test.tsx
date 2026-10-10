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

/** 模型列表接口的默认 mock：当前模型在列表里（下拉模式） */
const DEFAULT_MODELS = {
  models: [
    { id: 'model-a', label: 'model-a' },
    { id: 'sensenova-6.8-flash-lite', label: 'sensenova-6.8-flash-lite' },
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
      meta: { effortLevels: ['minimal', 'low', 'medium', 'high'] },
    });
  });
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

describe('设置页 · AI 设置', () => {
  it('回显当前配置', async () => {
    mockSettings();
    renderWithProviders(<Settings />);

    expect(await screen.findByDisplayValue('sensenova-6.8-flash-lite')).toBeInTheDocument();
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
    await screen.findByDisplayValue('sensenova-6.8-flash-lite');

    // select 不能用 clear+type，改用下拉选择
    await user.selectOptions(screen.getByLabelText('模型'), 'model-a');
    await user.selectOptions(screen.getByDisplayValue(/low（默认/), 'high');

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
      'sensenova-6.8-flash-lite',
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

  it('只在真的输入了新密钥时才提交密钥字段', async () => {
    const user = userEvent.setup();
    mockSettings();
    put.mockResolvedValue({ success: true });

    renderWithProviders(<Settings />);
    await screen.findByDisplayValue('sensenova-6.8-flash-lite');

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
});

describe('设置页 · 修改密码', () => {
  it('两次新密码不一致时阻止提交', async () => {
    const user = userEvent.setup();
    mockSettings();
    renderWithProviders(<Settings />);
    await screen.findByDisplayValue('sensenova-6.8-flash-lite');

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
    await screen.findByDisplayValue('sensenova-6.8-flash-lite');

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
    await screen.findByDisplayValue('sensenova-6.8-flash-lite');

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
    await screen.findByDisplayValue('sensenova-6.8-flash-lite');

    await user.type(screen.getByLabelText(/当前密码/), 'wrong');
    await user.type(screen.getByLabelText('新密码'), 'new-pass-456');
    await user.type(screen.getByLabelText(/确认新密码/), 'new-pass-456');
    await user.click(screen.getByRole('button', { name: /修改密码/ }));

    expect(await screen.findByText(/修改密码失败：当前密码不正确/)).toBeInTheDocument();
  });
});
