import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, url, createUser } from './helpers.js';
import {
  setFollowUpCondenser,
  resetFollowUpCondenser,
  condenseForParent,
  streamCondenseForParent,
  runCondense,
  runStreamCondense,
} from '../services/ai.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('condense-teacher');
});
after(async () => {
  await stopServer();
});
beforeEach(() => {
  resetFollowUpCondenser();
});

/** 发一次精简请求，收集 SSE 事件 */
async function collectSse(body: any, tk = token) {
  const res = await fetch(url('/api/followups/condense/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type');
  const raw = await res.text();

  if (!contentType || !contentType.includes('text/event-stream')) {
    return { status: res.status, contentType, events: [] as { event: string; data: any }[], raw };
  }

  const events = raw
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((frame) => {
      const evMatch = /^event:\s*(.+)$/m.exec(frame);
      const dataMatch = /^data:\s*(.+)$/m.exec(frame);
      let data: any = null;
      try {
        data = dataMatch ? JSON.parse(dataMatch[1]) : null;
      } catch {
        data = dataMatch ? dataMatch[1] : null;
      }
      return { event: evMatch ? evMatch[1] : 'message', data };
    });

  return { status: res.status, contentType, events, raw };
}

test('condense/stream：SSE 逐块下发并发送 done', async () => {
  setFollowUpCondenser(async () => '小明家长您好，今天练了分母不同的分数加减，回家做三题巩固就好。');

  const { status, contentType, events } = await collectSse({
    content: '本节课学习异分母分数加减，小明掌握情况良好。',
    studentName: '小明',
    topic: '异分母分数加减',
  });

  assert.equal(status, 200);
  assert.ok(contentType!.includes('text/event-stream'));
  assert.equal(events.filter((e) => e.event === 'done').length, 1);
  assert.equal(events[events.length - 1].event, 'done');
  assert.equal(typeof events[events.length - 1].data.wordCount, 'number');
});

test('condense/stream：未认证返回 401，而不是 SSE', async () => {
  const { status, contentType } = await collectSse({ content: '内容' }, '');
  assert.equal(status, 401);
  // 绝不能变成 SSE —— 否则前端会以为在流式生成
  assert.ok(!contentType || !contentType.includes('text/event-stream'));
});

test('condense/stream：内容缺失或全空格返回 400', async () => {
  const missing = await fetch(url('/api/followups/condense/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ studentName: '小明' }),
  });
  assert.equal(missing.status, 400);

  const blank = await fetch(url('/api/followups/condense/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ content: '   ' }),
  });
  assert.equal(blank.status, 400);
});

test('condense/stream：把学生姓名与课题传给精简实现', async () => {
  let received: any = null;
  setFollowUpCondenser(async (params) => {
    received = params;
    return '一段精简内容。';
  });

  await collectSse({ content: '完整回访正文。', studentName: '小红', topic: '百分数应用' });

  assert.ok(received);
  assert.equal(received.content, '完整回访正文。');
  assert.equal(received.studentName, '小红');
  assert.equal(received.topic, '百分数应用');
});

test('condense/stream：AI 失败时以 error 事件返回，而不是 HTTP 500', async () => {
  setFollowUpCondenser(async () => {
    throw new Error('上游模型拒绝');
  });

  const { status, contentType, events } = await collectSse({ content: '完整回访正文。' });

  assert.equal(status, 200);
  assert.ok(contentType!.includes('text/event-stream'));
  assert.equal(events.filter((e) => e.event === 'error').length, 1);
  assert.match(events.find((e) => e.event === 'error')!.data.error, /上游模型拒绝|请求失败|AI/);
});

// ---- 服务层：路由与非流式共用同一注入点 ----

test('路由与 runCondense 共用注入实现（seam 生效）', async () => {
  setFollowUpCondenser(async () => '共享实现');
  assert.equal(await runCondense({ content: 'x' }), '共享实现');

  // 流式入口同样走注入实现
  const chunks: string[] = [];
  for await (const delta of runStreamCondense({ content: 'x' })) {
    chunks.push(delta);
  }
  assert.deepEqual(chunks.join(''), '共享实现');
});

test('condenseForParent / streamCondenseForParent 默认真实实现（未注入）', () => {
  assert.equal(typeof condenseForParent, 'function');
  assert.equal(typeof streamCondenseForParent, 'function');
  // 注入后替换的应是 runXxx 入口，不动导出原函数
  setFollowUpCondenser(async () => '注入');
  assert.equal(runCondense({ content: 'x' }).constructor.name, 'Promise');
  resetFollowUpCondenser();
});
