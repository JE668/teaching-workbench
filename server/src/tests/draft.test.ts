import './setup.js';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, req, url, createUser } from './helpers.js';

let token = '';
let other = '';

before(async () => {
  await startServer();
  token = await createUser('draft-teacher');
  other = await createUser('draft-other');
});
after(async () => {
  await stopServer();
});

const payload = (over = {}) => ({
  form: { studentName: '李一一', topic: '分数加减法', performance: '专注' },
  images: [],
  selectedIds: [],
  content: '',
  draft: '',
  ...over,
});

describe('草稿 · 基本存取', () => {
  test('初始没有草稿', async () => {
    const fresh = await createUser('draft-fresh');
    const res = await req('GET', '/api/draft', { token: fresh });
    assert.equal(res.status, 200);
    assert.equal(res.body.draft, null);
  });

  test('保存后可读回，且带更新时间', async () => {
    const res = await req('PUT', '/api/draft', {
      token,
      body: { clientId: 'c1', payload: payload() },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const read = await req('GET', '/api/draft', { token });
    assert.equal(read.body.draft.form.studentName, '李一一');
    assert.equal(read.body.draft.form.topic, '分数加减法');
    assert.ok(read.body.updatedAt, '应返回更新时间');
  });

  test('重复保存是覆盖而不是新增', async () => {
    await req('PUT', '/api/draft', { token, body: { clientId: 'c1', payload: payload() } });
    await req('PUT', '/api/draft', {
      token,
      body: { clientId: 'c1', payload: payload({ content: '第二次' }) },
    });

    const read = await req('GET', '/api/draft', { token });
    assert.equal(read.body.draft.content, '第二次');

    const { db } = await import('../config/database.js');
    const uid = (await req('GET', '/api/auth/me', { token })).body.user.id;
    const rows = db.prepare('SELECT COUNT(*) AS n FROM drafts WHERE user_id = ?').get(uid) as any;
    assert.equal(rows.n, 1, '每个人的草稿应只有一条');
  });

  test('清空草稿', async () => {
    await req('PUT', '/api/draft', { token, body: { clientId: 'c1', payload: payload() } });
    const del = await req('DELETE', '/api/draft', { token, body: { clientId: 'c1' } });
    assert.equal(del.status, 200);

    const read = await req('GET', '/api/draft', { token });
    assert.equal(read.body.draft, null);
  });

  test('payload 缺失返回 400', async () => {
    const res = await req('PUT', '/api/draft', { token, body: { clientId: 'c1' } });
    assert.equal(res.status, 400);
  });

  test('超大 payload 被拒绝', async () => {
    const huge = payload({ content: 'x'.repeat(600 * 1024) });
    const res = await req('PUT', '/api/draft', { token, body: { clientId: 'c1', payload: huge } });
    assert.equal(res.status, 413);
  });

  test('未登录不能读写草稿', async () => {
    assert.equal((await req('GET', '/api/draft', {})).status, 401);
    assert.equal((await req('PUT', '/api/draft', { body: { payload: payload() } })).status, 401);
  });
});

describe('草稿 · 多用户隔离', () => {
  test('用户之间互相看不到对方的草稿', async () => {
    await req('PUT', '/api/draft', {
      token,
      body: { clientId: 'a', payload: payload({ form: { studentName: '甲的学生' } }) },
    });
    await req('PUT', '/api/draft', {
      token: other,
      body: { clientId: 'b', payload: payload({ form: { studentName: '乙的学生' } }) },
    });

    const a = await req('GET', '/api/draft', { token });
    const b = await req('GET', '/api/draft', { token: other });

    assert.equal(a.body.draft.form.studentName, '甲的学生');
    assert.equal(b.body.draft.form.studentName, '乙的学生');
  });

  test('清空自己的草稿不影响他人', async () => {
    await req('PUT', '/api/draft', { token: other, body: { clientId: 'b', payload: payload() } });
    await req('DELETE', '/api/draft', { token, body: { clientId: 'a' } });

    const b = await req('GET', '/api/draft', { token: other });
    assert.ok(b.body.draft, '另一用户的草稿不应被波及');
  });
});

/** 订阅 SSE 并收集事件（带超时，避免测试挂住） */
async function subscribe(
  token: string,
  clientId: string,
  opts: { until: (events: any[]) => boolean; timeoutMs?: number; onReady?: () => Promise<void> }
) {
  const controller = new AbortController();
  const events: any[] = [];
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);

  const res = await fetch(url('/api/draft/stream?clientId=' + clientId), {
    headers: { Authorization: 'Bearer ' + token },
    signal: controller.signal,
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let readyFired = false;

  try {
    while (Date.now() < deadline) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value?: Uint8Array }>((r) =>
          setTimeout(() => r({ done: false, value: undefined }), 150)
        ),
      ]);

      if (done) break;

      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!frame.trim()) continue;

          let event = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          try {
            events.push({ event, data: JSON.parse(dataLines.join('\n')) });
          } catch {
            /* 忽略坏帧 */
          }

          if (event === 'ready' && !readyFired) {
            readyFired = true;
            if (opts.onReady) await opts.onReady();
          }
        }
      }

      if (opts.until(events)) break;
    }
  } finally {
    controller.abort();
  }

  return events;
}

describe('草稿 · 实时同步（SSE）', () => {
  test('连接后立即收到 ready，并带上当前草稿', async () => {
    const fresh = await createUser('draft-sse-ready');
    await req('PUT', '/api/draft', {
      token: fresh,
      body: { clientId: 'seed', payload: payload({ content: '已有内容' }) },
    });

    const events = await subscribe(fresh, 'phone', {
      until: (e) => e.some((x) => x.event === 'ready'),
      timeoutMs: 3000,
    });

    const ready = events.find((e) => e.event === 'ready');
    assert.ok(ready, '应收到 ready');
    assert.equal(ready!.data.draft.content, '已有内容', 'ready 应带上当前草稿');
  });

  test('【核心】手机保存后，电脑端能收到广播', async () => {
    const user = await createUser('draft-sse-broadcast');

    const events = await subscribe(user, 'desktop', {
      until: (e) => e.some((x) => x.event === 'draft'),
      timeoutMs: 4000,
      // 连上后再让"手机"发起保存
      onReady: async () => {
        await req('PUT', '/api/draft', {
          token: user,
          body: { clientId: 'phone', payload: payload({ images: ['1/photo.png'] }) },
        });
      },
    });

    const got = events.find((e) => e.event === 'draft');
    assert.ok(got, '电脑端应收到手机保存的草稿');
    assert.deepEqual(got!.data.payload.images, ['1/photo.png'], '图片应同步过去');
  });

  test('广播不回发给发起方（避免覆盖自己正在输入的内容）', async () => {
    const user = await createUser('draft-sse-noecho');

    const events = await subscribe(user, 'same-client', {
      until: (e) => e.filter((x) => x.event === 'draft').length > 0,
      timeoutMs: 2500,
      onReady: async () => {
        // 用同一个 clientId 保存
        await req('PUT', '/api/draft', {
          token: user,
          body: { clientId: 'same-client', payload: payload({ content: '自己发的' }) },
        });
      },
    });

    const drafts = events.filter((e) => e.event === 'draft');
    assert.equal(drafts.length, 0, '不应收到自己发起的更新');
  });

  test('归档清空会通知其它设备', async () => {
    const user = await createUser('draft-sse-cleared');

    const events = await subscribe(user, 'desktop2', {
      until: (e) => e.some((x) => x.event === 'cleared'),
      timeoutMs: 4000,
      onReady: async () => {
        await req('DELETE', '/api/draft', { token: user, body: { clientId: 'phone2' } });
      },
    });

    assert.ok(events.some((e) => e.event === 'cleared'), '应收到 cleared 事件');
  });

  test('在线设备列表包含自己', async () => {
    const user = await createUser('draft-sse-clients');
    const events = await subscribe(user, 'device-x', {
      until: (e) => e.some((x) => x.event === 'ready'),
      timeoutMs: 3000,
    });

    const ready = events.find((e) => e.event === 'ready');
    assert.ok(ready!.data.onlineClients.includes('device-x'));
  });

  test('未登录不能订阅', async () => {
    const res = await fetch(url('/api/draft/stream?clientId=x'));
    assert.equal(res.status, 401);
  });
});
