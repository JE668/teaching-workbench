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
