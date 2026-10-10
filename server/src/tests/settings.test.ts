import './setup.js';
import http from 'http';
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

// ===== 模型下拉列表 =====
// 用本地 mock 上游验证整条链路：设置 baseUrl/apiKey -> GET /models -> 实时返回
describe('可用模型列表', () => {
  /** 起一个假的 /v1/models 上游 */
  function startMockModels(payload: unknown, status = 200): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve) => {
      const srv = http.createServer((_req: any, res: any) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      });
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as any;
        resolve({ url: 'http://127.0.0.1:' + port, close: () => srv.close() });
      });
    });
  }

  test('未配置 API Key 时返回内置列表并标注来源', async () => {
    const fresh = await createUser('models-nokey');
    const res = await req('GET', '/api/settings/models', { token: fresh });

    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'builtin');
    assert.ok(res.body.models.length >= 2, '内置列表至少应有已知模型');
    assert.ok(res.body.models.some((m: any) => m.id === 'sensenova-6.8-flash-lite'));
  });

  test('配置 Key 后实时查询上游（OpenAI data 格式）', async () => {
    const t = await createUser('models-live');
    const mock = await startMockModels({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] });

    try {
      await req('PUT', '/api/settings', {
        token: t,
        body: { 'ai.apiKey': 'test-key', 'ai.baseUrl': mock.url },
      });

      const res = await req('GET', '/api/settings/models', { token: t });

      assert.equal(res.status, 200);
      assert.equal(res.body.source, 'api', '应标注为实时查询');
      assert.deepEqual(
        res.body.models.map((m: any) => m.id),
        ['model-a', 'model-b']
      );
      assert.ok(!res.body.error, '实时查询成功时不应有错误信息');
    } finally {
      mock.close();
    }
  });

  test('上游直接返回数组（部分网关的格式）也能解析', async () => {
    const t = await createUser('models-array');
    const mock = await startMockModels(['model-x', 'model-y']);

    try {
      await req('PUT', '/api/settings', {
        token: t,
        body: { 'ai.apiKey': 'test-key', 'ai.baseUrl': mock.url },
      });

      const res = await req('GET', '/api/settings/models', { token: t });
      assert.equal(res.body.source, 'api');
      assert.deepEqual(
        res.body.models.map((m: any) => m.id),
        ['model-x', 'model-y']
      );
    } finally {
      mock.close();
    }
  });

  test('上游不可达时回落内置列表并带上原因', async () => {
    const t = await createUser('models-dead');
    await req('PUT', '/api/settings', {
      token: t,
      body: { 'ai.apiKey': 'test-key', 'ai.baseUrl': 'http://127.0.0.1:1' },
    });

    const res = await req('GET', '/api/settings/models', { token: t });

    assert.equal(res.status, 200, '上游挂了也不该报错，要能打开设置页');
    assert.equal(res.body.source, 'builtin');
    assert.ok(res.body.error, '应带上失败原因');
    assert.ok(res.body.models.length >= 2);
  });

  test('上游返回非 200 时回落内置列表', async () => {
    const t = await createUser('models-500');
    const mock = await startMockModels({ message: 'boom' }, 500);

    try {
      await req('PUT', '/api/settings', {
        token: t,
        body: { 'ai.apiKey': 'test-key', 'ai.baseUrl': mock.url },
      });

      const res = await req('GET', '/api/settings/models', { token: t });
      assert.equal(res.body.source, 'builtin');
    } finally {
      mock.close();
    }
  });

  test('返回当前配置的模型，供前端判断是否需要切到自定义模式', async () => {
    const t = await createUser('models-current');
    const mock = await startMockModels({ data: [{ id: 'model-a' }] });

    try {
      await req('PUT', '/api/settings', {
        token: t,
        body: { 'ai.apiKey': 'test-key', 'ai.baseUrl': mock.url, 'ai.model': 'my-own-model' },
      });

      const res = await req('GET', '/api/settings/models', { token: t });
      assert.equal(res.body.current, 'my-own-model');
    } finally {
      mock.close();
    }
  });

  test('内置目录覆盖官方文档全部 7 个模型，并带读图能力与档位', async () => {
    const fresh = await createUser('models-catalog');
    const res = await req('GET', '/api/settings/models', { token: fresh });

    const ids = res.body.models.map((m: any) => m.id);
    const documented = [
      'sensenova-6.8-flash-lite', 'deepseek-flash', 'kimi-k3',
      'glm-5.2', 'deepseek-v4-flash',
      'sensenova-u1.5-lite', 'sensenova-u1.5-fast',
    ];
    for (const id of documented) {
      assert.ok(ids.includes(id), '内置目录缺少文档模型: ' + id);
    }

    // 元数据：能读图的模型排前面
    const flash = res.body.models.find((m: any) => m.id === 'sensenova-6.8-flash-lite');
    assert.equal(flash.vision, true, '6.8-flash-lite 支持读图');
    assert.ok(flash.efforts.includes('none'), '应支持 none 关闭思考');

    const glm = res.body.models.find((m: any) => m.id === 'glm-5.2');
    assert.equal(glm.vision, false, 'GLM-5.2 不支持读图');
    assert.ok(glm.efforts.includes('xhigh'), 'GLM 独有 xhigh 档位');

    // 推荐排序：读图模型应排在图片创作模型前面
    const idxVision = ids.indexOf('kimi-k3');
    const idxGen = ids.indexOf('sensenova-u1.5-lite');
    assert.ok(idxVision < idxGen, '能读图的模型应排在图片创作模型之前');
  });

  test('接口返回已知模型时，元数据来自文档目录；未知模型给兜底', async () => {
    const t = await createUser('models-merge');
    const mock = await startMockModels({ data: [{ id: 'glm-5.2' }, { id: 'brand-new-model' }] });

    try {
      await req('PUT', '/api/settings', {
        token: t,
        body: { 'ai.apiKey': 'k', 'ai.baseUrl': mock.url },
      });

      const res = await req('GET', '/api/settings/models', { token: t });

      const known = res.body.models.find((m: any) => m.id === 'glm-5.2');
      assert.equal(known.vision, false, '已知模型应带文档元数据');
      assert.ok(known.efforts.includes('xhigh'));

      const unknown = res.body.models.find((m: any) => m.id === 'brand-new-model');
      assert.equal(unknown.vision, true, '未知模型给通用兜底（默认可读图）');
      assert.ok(unknown.efforts.includes('low'));
    } finally {
      mock.close();
    }
  });

  test('思考等级接受文档确认的全集（none/minimal/xhigh/max）', async () => {
    const t = await createUser('models-efforts');
    for (const v of ['none', 'minimal', 'xhigh', 'max']) {
      const res = await req('PUT', '/api/settings', { token: t, body: { 'ai.reasoningEffort': v } });
      assert.equal(res.status, 200, v + ' 应被接受');
    }
  });

  test('未登录返回 401', async () => {
    assert.equal((await req('GET', '/api/settings/models')).status, 401);
  });
});
