import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import {
  clearWechatAccessTokenCache,
  sendParentWechatPush,
} from '../services/wechatPush.js';

const configuredEnv: NodeJS.ProcessEnv = {
  WECHAT_APP_ID: 'official-account-id',
  WECHAT_APP_SECRET: 'test-app-secret',
  WECHAT_PARENT_TEMPLATE_ID: 'parent-template-id',
  WECHAT_MINIPROGRAM_APP_ID: 'mini-program-id',
};

const input = {
  recipientOpenId: 'parent-open-id',
  parentUrl: 'https://school.example/parent-view/token-123',
  studentName: '小明',
  summary: '已掌握分数通分，继续练习应用题。',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  clearWechatAccessTokenCache();
});

afterEach(() => {
  mock.restoreAll();
  clearWechatAccessTokenCache();
});

describe('sendParentWechatPush', () => {
  test('未完整配置时返回 skipped 且不请求网络', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('禁止真实网络');
    });

    const result = await sendParentWechatPush(input, {
      env: { WECHAT_APP_ID: 'only-app-id' },
    });

    assert.deepEqual(result, {
      status: 'skipped',
      reason: 'not_configured',
      missing: ['WECHAT_APP_SECRET', 'WECHAT_PARENT_TEMPLATE_ID'],
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('成功发送模板消息、携带小程序路径并缓存 access token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return jsonResponse({ access_token: 'cached-access-token', expires_in: 7200 });
      }
      return jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 987654 });
    });

    const first = await sendParentWechatPush(input, { env: configuredEnv });
    const second = await sendParentWechatPush(input, { env: configuredEnv });

    assert.deepEqual(first, { status: 'sent', messageId: 987654 });
    assert.deepEqual(second, { status: 'sent', messageId: 987654 });
    assert.equal(calls.length, 3, '两次发送只应获取一次 token');
    assert.match(calls[0].url, /^https:\/\/api\.weixin\.qq\.com\/cgi-bin\/token\?/);
    assert.match(calls[1].url, /access_token=cached-access-token$/);
    assert.equal(calls[1].init?.method, 'POST');
    assert.ok(calls[1].init?.signal instanceof AbortSignal);

    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.touser, input.recipientOpenId);
    assert.equal(body.template_id, configuredEnv.WECHAT_PARENT_TEMPLATE_ID);
    assert.equal(body.url, input.parentUrl);
    assert.equal(body.data.keyword1.value, input.studentName);
    assert.equal(body.data.keyword2.value, input.summary);
    assert.deepEqual(body.miniprogram, {
      appid: 'mini-program-id',
      pagepath: 'pages/parent-view/parent-view?token=token-123',
    });
  });

  test('token 接口微信 errcode 转为 failed，且不会缓存失败响应', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({
      errcode: 40013,
      errmsg: 'invalid appid',
    }));

    const result = await sendParentWechatPush(input, { env: configuredEnv });
    assert.deepEqual(result, {
      status: 'failed',
      reason: 'wechat_error',
      message: '微信接口错误 40013：invalid appid',
      errcode: 40013,
    });
  });

  test('模板发送微信 errcode 转为 failed，错误信息不泄露密钥', async () => {
    let call = 0;
    mock.method(globalThis, 'fetch', async () => {
      call += 1;
      if (call === 1) return jsonResponse({ access_token: 'token-value', expires_in: 7200 });
      return jsonResponse({
        errcode: 47003,
        errmsg: 'template rejected for test-app-secret',
      });
    });

    const result = await sendParentWechatPush(input, { env: configuredEnv });
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.reason, 'wechat_error');
      assert.equal(result.errcode, 47003);
      assert.ok(!result.message.includes('test-app-secret'));
      assert.match(result.message, /\[已隐藏\]/);
    }
  });

  test('HTTP 错误转为 failed 且不解析响应体', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse({ ignored: true }, 503));

    const result = await sendParentWechatPush(input, { env: configuredEnv });
    assert.deepEqual(result, {
      status: 'failed',
      reason: 'http_error',
      message: '微信接口 HTTP 错误（503）',
    });
  });

  test('请求超时会中止 fetch 并返回 failed', async () => {
    mock.method(globalThis, 'fetch', (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
    });

    const result = await sendParentWechatPush(input, { env: configuredEnv, timeoutMs: 5 });
    assert.deepEqual(result, {
      status: 'failed',
      reason: 'timeout',
      message: '微信请求超时（5ms）',
    });
  });

  test('无效 JSON 转为 failed，且不暴露原始异常', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('not-json', { status: 200 }));

    const result = await sendParentWechatPush(input, { env: configuredEnv });
    assert.deepEqual(result, {
      status: 'failed',
      reason: 'invalid_response',
      message: '微信接口返回了无效 JSON',
    });
  });
});
