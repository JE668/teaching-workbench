import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

function mockSettings(overrides: Record<string, any> = {}) {
  get.mockResolvedValue({
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

    const modelInput = screen.getByDisplayValue('sensenova-6.8-flash-lite');
    await user.clear(modelInput);
    await user.type(modelInput, 'new-model-id');
    await user.selectOptions(screen.getByDisplayValue(/low（默认/), 'high');

    await user.click(screen.getByRole('button', { name: /保存 AI 设置/ }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ 'ai.model': 'new-model-id', 'ai.reasoningEffort': 'high' })
      );
    });
    expect(await screen.findByText(/AI 设置已保存/)).toBeInTheDocument();
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
