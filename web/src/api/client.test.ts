import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './client';

/** 构造一个 SSE 响应，chunks 会被依次推入流中（用于模拟网络分片） */
function sseResponse(chunks: string[], init: { ok?: boolean; status?: number; json?: any } = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body: stream,
    json: async () => init.json ?? {},
  } as any;
}

function frame(event: string, data: unknown) {
  return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

/** 收集一次 streamPost 的全部回调 */
async function collect(chunks: string[], init?: Parameters<typeof sseResponse>[1]) {
  const fetchMock = vi.fn().mockResolvedValue(sseResponse(chunks, init));
  vi.stubGlobal('fetch', fetchMock);

  const deltas: string[] = [];
  const regens: number[] = [];
  let done: any = null;
  const errors: string[] = [];

  let thrown: Error | null = null;
  try {
    await api.streamPost('/followups/generate/stream', { any: 'body' }, {
      onDelta: (t) => deltas.push(t),
      onRegenerating: (n) => regens.push(n),
      onDone: (d) => (done = d),
      onError: (m) => errors.push(m),
    });
  } catch (e: any) {
    thrown = e;
  }

  return { deltas, regens, done, errors, thrown, fetchMock };
}

beforeEach(() => {
  api.setToken('test-token');
});

afterEach(() => {
  api.clearAuth();
  vi.unstubAllGlobals();
});

describe('streamPost 请求构造', () => {
  it('携带 Authorization 与 JSON Content-Type', async () => {
    const { fetchMock } = await collect([frame('done', { content: 'x', wordCount: 1, regenerated: false })]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/followups/generate/stream');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer test-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ any: 'body' });
  });
});

describe('streamPost 事件解析', () => {
  it('逐块回传 delta', async () => {
    const { deltas, done } = await collect([
      frame('delta', { text: '你好' }),
      frame('delta', { text: '世界' }),
      frame('done', { content: '你好世界', wordCount: 4, regenerated: false }),
    ]);

    expect(deltas).toEqual(['你好', '世界']);
    expect(done).toEqual({ content: '你好世界', wordCount: 4, regenerated: false });
  });

  it('识别 regenerating 事件', async () => {
    const { regens, done } = await collect([
      frame('delta', { text: '短' }),
      frame('regenerating', { wordCount: 3 }),
      frame('done', { content: '完整内容', wordCount: 200, regenerated: true }),
    ]);

    expect(regens).toEqual([3]);
    expect(done.regenerated).toBe(true);
  });

  it('识别 error 事件且不抛异常', async () => {
    const { errors, done, thrown } = await collect([frame('error', { error: 'API Key 无效' })]);

    expect(errors).toEqual(['API Key 无效']);
    expect(done).toBeNull();
    expect(thrown).toBeNull();
  });

  // ===== 边界：SSE 帧可能被 TCP 切成任意片段 =====
  it('单个事件被拆到多个网络分片时仍能正确解析', async () => {
    const payload = frame('delta', { text: '跨分片内容' });
    const mid = Math.floor(payload.length / 2);

    const { deltas } = await collect([payload.slice(0, mid), payload.slice(mid)]);

    expect(deltas).toEqual(['跨分片内容']);
  });

  it('分隔符本身被切开（\n 与 \n 分属两片）也能解析', async () => {
    const { deltas } = await collect([
      'event: delta\ndata: {"text":"甲"}\n',
      '\nevent: delta\ndata: {"text":"乙"}\n\n',
    ]);

    expect(deltas).toEqual(['甲', '乙']);
  });

  it('多个事件挤在同一分片内全部解析', async () => {
    const { deltas } = await collect([
      frame('delta', { text: 'A' }) + frame('delta', { text: 'B' }) + frame('delta', { text: 'C' }),
    ]);

    expect(deltas).toEqual(['A', 'B', 'C']);
  });

  it('忽略非 JSON 的 data 行而不中断后续解析', async () => {
    const { deltas, done } = await collect([
      'event: delta\ndata: {坏掉的 json\n\n',
      frame('delta', { text: '正常' }),
      frame('done', { content: 'x', wordCount: 1, regenerated: false }),
    ]);

    expect(deltas).toEqual(['正常']);
    expect(done).not.toBeNull();
  });

  it('流被中断（既无 done 也无 error）时回传中断提示', async () => {
    const { errors, done } = await collect([frame('delta', { text: '半截' })]);

    expect(done).toBeNull();
    expect(errors).toEqual(['生成中断，请重试']);
  });
});

describe('streamPost 错误处理', () => {
  it('HTTP 非 2xx 时抛出后端返回的错误信息', async () => {
    const { thrown } = await collect([], { ok: false, status: 400, json: { error: '缺少必填字段' } });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toBe('缺少必填字段');
  });

  it('响应无 body 时抛出可读错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, json: async () => ({}) } as any)
    );

    await expect(api.streamPost('/x', {}, {})).rejects.toThrow(/不支持流式响应/);
  });

  it('AbortSignal 取消时抛出 AbortError', async () => {
    const controller = new AbortController();
    controller.abort();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: any) => {
        if (init?.signal?.aborted) {
          const e = new Error('aborted');
          e.name = 'AbortError';
          return Promise.reject(e);
        }
        return Promise.resolve(sseResponse([]));
      })
    );

    await expect(
      api.streamPost('/x', {}, {}, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

/**
 * 登录态失效（401）的全局处理。
 *
 * 背景：令牌可能因过期（7 天）或 JWT_SECRET 变更而失效，此时任何接口都返回 401。
 * 若不统一处理，用户看到的是「保存失败：认证令牌无效或已过期」这种
 * 无从下手的提示（真实用户反馈过）。这里锁定行为：
 *   1) 带着令牌请求收到 401 → 清本地登录态 + 通知上层跳登录页
 *   2) 登录/注册接口的 401 是「账号或密码错误」→ 绝不能清掉会话
 *   3) 未带令牌的 401 → 不触发（本就没登录）
 */
describe('api 客户端 · 登录态失效（401）处理', () => {
  function plainResponse(status: number, body: any = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      body: null,
    } as any;
  }

  let onUnauthorized: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    api.clearAuth();
    onUnauthorized = vi.fn();
    api.setUnauthorizedHandler(onUnauthorized as any);
  });

  it('带令牌请求收到 401：清登录态并通知跳登录页', async () => {
    api.setToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(plainResponse(401, { error: '登录已过期，请重新登录' }))
    );

    await expect(api.get('/settings')).rejects.toThrow('登录已过期，请重新登录');

    expect(api.getToken()).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('登录接口的 401 是密码错误：不清会话、不触发跳转', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(plainResponse(401, { error: '用户名或密码错误' }))
    );

    await expect(
      api.post('/auth/login', { username: 'a', password: 'wrong' })
    ).rejects.toThrow('用户名或密码错误');

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('注册接口的 401 同理不触发跳转', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(plainResponse(401, { error: '用户名已存在' })));

    await expect(api.post('/auth/register', { username: 'a', password: 'b' })).rejects.toThrow();

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('未带令牌时的 401 不触发（本就没登录）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(plainResponse(401, { error: '未提供认证令牌' })));

    await expect(api.get('/students')).rejects.toThrow();

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('其它错误码不触发跳转，且保留令牌', async () => {
    api.setToken('good-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(plainResponse(500, { error: '服务器错误' })));

    await expect(api.get('/students')).rejects.toThrow('服务器错误');

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(api.getToken()).toBe('good-token');
  });

  it('上传接口的 401 同样触发（图片鉴权失效也要回登录页）', async () => {
    api.setToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(plainResponse(401, { error: '登录状态已失效，请重新登录' }))
    );

    const fd = new FormData();
    await expect(api.upload('/upload', fd)).rejects.toThrow('登录状态已失效');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(api.getToken()).toBeNull();
  });

  it('令牌被清掉后的后续请求不再重复触发', async () => {
    api.setToken('t');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(plainResponse(401, { error: 'x' })));

    await expect(api.get('/a')).rejects.toThrow();
    await expect(api.get('/b')).rejects.toThrow();

    // 第一次已清掉令牌，第二次请求没带令牌 → 只应触发一次
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
