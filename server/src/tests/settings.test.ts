import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, createUser } from './helpers.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('settings-teacher');
});
after(async () => {
  await stopServer();
});

describe('应用设置 · 读取', () => {
  test('初始返回 .env 提供的默认值', async () => {
    const res = await req('GET', '/api/settings', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.settings['ai.model'], '应有模型名');
    assert.ok(res.body.settings['ai.reasoningEffort']);
    assert.deepEqual(res.body.overridden, [], '尚未覆盖任何项');
  });

  test('API Key 不回传明文，只给掩码与是否已配置', async () => {
    const res = await req('GET', '/api/settings', { token });
    const key = res.body.settings['ai.apiKey'];

    assert.equal(typeof key, 'object', '不应直接返回字符串');
    assert.ok('configured' in key);
    assert.ok('masked' in key);
    // 掩码里不能出现完整密钥
    assert.ok(!key.masked || key.masked.includes('••'));
  });

  test('元信息带出可选思考等级', async () => {
    const res = await req('GET', '/api/settings', { token });
    assert.ok(Array.isArray(res.body.meta.effortLevels));
    assert.ok(res.body.meta.effortLevels.includes('low'));
    assert.ok(res.body.meta.effortLevels.includes('high'));
  });

  test('未登录返回 401', async () => {
    assert.equal((await req('GET', '/api/settings')).status, 401);
  });
});

describe('应用设置 · 写入', () => {
  test('可修改模型与思考等级并读回', async () => {
    const res = await req('PUT', '/api/settings', {
      token,
      body: { 'ai.model': 'my-custom-model', 'ai.reasoningEffort': 'high' },
    });
    assert.equal(res.status, 200);

    const read = await req('GET', '/api/settings', { token });
    assert.equal(read.body.settings['ai.model'], 'my-custom-model');
    assert.equal(read.body.settings['ai.reasoningEffort'], 'high');
    assert.ok(read.body.overridden.includes('ai.model'), '应记录为已覆盖');
  });

  test('传空值 = 清除覆盖，回落 .env', async () => {
    await req('PUT', '/api/settings', { token, body: { 'ai.model': 'temp-model' } });
    let read = await req('GET', '/api/settings', { token });
    assert.equal(read.body.settings['ai.model'], 'temp-model');

    await req('PUT', '/api/settings', { token, body: { 'ai.model': '' } });
    read = await req('GET', '/api/settings', { token });

    assert.notEqual(read.body.settings['ai.model'], 'temp-model', '应回落到 .env 的值');
    assert.ok(!read.body.overridden.includes('ai.model'));
  });

  test('非法思考等级被拒绝', async () => {
    const res = await req('PUT', '/api/settings', {
      token,
      body: { 'ai.reasoningEffort': 'ultra-max' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /思考等级/);
  });

  test('超时时间超出范围被拒绝', async () => {
    const tooSmall = await req('PUT', '/api/settings', { token, body: { 'ai.timeoutMs': '100' } });
    assert.equal(tooSmall.status, 400);

    const tooBig = await req('PUT', '/api/settings', { token, body: { 'ai.timeoutMs': '999999' } });
    assert.equal(tooBig.status, 400);
  });

  test('接口地址必须是 http(s)', async () => {
    const res = await req('PUT', '/api/settings', { token, body: { 'ai.baseUrl': 'file:///etc/passwd' } });
    assert.equal(res.status, 400);
  });

  test('只接受白名单键，任意内容写不进去', async () => {
    const res = await req('PUT', '/api/settings', {
      token,
      body: { 'evil.key': 'x', __proto__: { polluted: true } },
    });
    assert.equal(res.status, 400, '没有可更新的合法键时应报错');

    const read = await req('GET', '/api/settings', { token });
    assert.equal(read.body.settings['evil.key'], undefined);
    assert.equal(({} as any).polluted, undefined);
  });

  test('传掩码不会把密钥写成掩码本身', async () => {
    // 先设置一个真 key
    await req('PUT', '/api/settings', { token, body: { 'ai.apiKey': 'sk-real-key-1234567890' } });

    // 前端回显的是掩码，若被误提交不能覆盖真 key
    await req('PUT', '/api/settings', {
      token,
      body: { 'ai.model': 'another-model', 'ai.apiKey': '••••••••7890' },
    });

    const read = await req('GET', '/api/settings', { token });
    assert.ok(read.body.settings['ai.apiKey'].configured);
    assert.ok(read.body.settings['ai.apiKey'].masked.endsWith('7890'));

    // 真正的 key 仍是原值（用 AI 配置快照间接验证）
    const { getAiConfig } = await import('../config/settings.js');
    assert.equal(getAiConfig().apiKey, 'sk-real-key-1234567890', '掩码不应覆盖真实密钥');
  });
});

describe('应用设置 · 立即生效', () => {
  test('保存后配置版本号递增，触发 AI 客户端重建', async () => {
    const { getConfigVersion, getAiConfig } = await import('../config/settings.js');

    await req('PUT', '/api/settings', { token, body: { 'ai.model': 'model-' + Date.now() } });
    const v1 = getConfigVersion();

    await req('PUT', '/api/settings', { token, body: { 'ai.model': 'model-b-' + Date.now() } });
    const v2 = getConfigVersion();

    assert.ok(v2 > v1, '版本号应递增（否则客户端会一直用旧配置）');
    assert.ok(getAiConfig().model.startsWith('model-'));
  });
});

describe('修改密码', () => {
  test('当前密码错误时拒绝', async () => {
    const t = await createUser('pwd-wrong', 'correct-pass');
    const res = await req('PUT', '/api/auth/password', {
      token: t,
      body: { currentPassword: 'wrong-pass', newPassword: 'new-pass-123' },
    });

    assert.equal(res.status, 401);
    assert.match(res.body.error, /当前密码不正确/);
  });

  test('新密码过短被拒绝', async () => {
    const t = await createUser('pwd-short', 'correct-pass');
    const res = await req('PUT', '/api/auth/password', {
      token: t,
      body: { currentPassword: 'correct-pass', newPassword: '123' },
    });
    assert.equal(res.status, 400);
  });

  test('新旧密码相同被拒绝', async () => {
    const t = await createUser('pwd-same', 'same-pass-123');
    const res = await req('PUT', '/api/auth/password', {
      token: t,
      body: { currentPassword: 'same-pass-123', newPassword: 'same-pass-123' },
    });
    assert.equal(res.status, 400);
  });

  test('修改成功后新密码可登录、旧密码失效', async () => {
    const t = await createUser('pwd-change', 'old-pass-123');

    const res = await req('PUT', '/api/auth/password', {
      token: t,
      body: { currentPassword: 'old-pass-123', newPassword: 'new-pass-456' },
    });
    assert.equal(res.status, 200);

    const withNew = await req('POST', '/api/auth/login', {
      body: { username: 'pwd-change', password: 'new-pass-456' },
    });
    assert.equal(withNew.status, 200, '新密码应可登录');

    const withOld = await req('POST', '/api/auth/login', {
      body: { username: 'pwd-change', password: 'old-pass-123' },
    });
    assert.equal(withOld.status, 401, '旧密码应失效');
  });

  test('不影响其它用户的密码', async () => {
    const a = await createUser('pwd-user-a', 'a-pass-123');
    await createUser('pwd-user-b', 'b-pass-123');

    await req('PUT', '/api/auth/password', {
      token: a,
      body: { currentPassword: 'a-pass-123', newPassword: 'a-new-456' },
    });

    const bLogin = await req('POST', '/api/auth/login', {
      body: { username: 'pwd-user-b', password: 'b-pass-123' },
    });
    assert.equal(bLogin.status, 200, 'B 的密码不应受影响');
  });

  test('未登录返回 401', async () => {
    const res = await req('PUT', '/api/auth/password', {
      body: { currentPassword: 'x', newPassword: 'yyyyyy' },
    });
    assert.equal(res.status, 401);
  });
});
