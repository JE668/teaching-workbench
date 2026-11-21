import './setup.js';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createUser, startServer, stopServer, url } from './helpers.js';
import { db } from '../config/database.js';
import {
  resetFollowUpGenerator,
  setFollowUpGenerator,
  setFollowUpStreamer,
} from '../services/ai/index.js';

const VALID_BODY = {
  studentName: '李小明',
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法运算',
  performance: '专注度较高',
  mastery: 'good',
  images: [],
};

const GOOD =
  '【课堂内容】本节课重点讲解分数通分的原理与步骤，通过数轴演示帮助理解，并结合生活情境设计练习。' +
  '【学生收获】李小明专注度较高，能够主动举手回答问题，对通分方法掌握到位，独立完成基础题型准确率良好。' +
  '【课后任务】完成练习册第12页第1到8题，巩固通分步骤，每天做10道口算提升计算速度与准确率。';

type SseEvent = { event: string; id: string | null; data: any };

type StreamResult = {
  status: number;
  streamId: string;
  events: SseEvent[];
  raw: string;
  body: any;
};

function parseSse(raw: string): SseEvent[] {
  return raw
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      let event = 'message';
      let id: string | null = null;
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      let data: any = null;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        data = dataLines.join('\n');
      }
      return { event, id, data };
    });
}

async function collectStream(
  token: string,
  headers: Record<string, string> = {},
): Promise<StreamResult> {
  const res = await fetch(url('/api/followups/generate/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...headers,
    },
    body: JSON.stringify(VALID_BODY),
  });
  const raw = await res.text();
  const contentType = res.headers.get('content-type') || '';
  let body: any = null;
  if (!contentType.includes('text/event-stream')) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  return {
    status: res.status,
    streamId: res.headers.get('x-stream-id') || '',
    events: contentType.includes('text/event-stream') ? parseSse(raw) : [],
    raw,
    body,
  };
}

/** 真实 HTTP 连接收到首个 delta 后立即销毁 socket，模拟网络中断。 */
async function disconnectAfterFirstDelta(token: string): Promise<{
  streamId: string;
  events: SseEvent[];
  disconnectedAt: number;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let events: SseEvent[] = [];
    const request = http.request(
      url('/api/followups/generate/stream'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
      },
      (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffer += chunk;
          let separator = buffer.indexOf('\n\n');
          while (separator !== -1) {
            const frame = buffer.slice(0, separator + 2);
            buffer = buffer.slice(separator + 2);
            events = events.concat(parseSse(frame));
            separator = buffer.indexOf('\n\n');
          }
          const first = events.find((event) => event.event === 'delta' && event.id === '1');
          if (!first || settled) return;
          settled = true;
          const persisted = db
            .prepare('SELECT stream_id FROM ai_stream_chunks WHERE seq = 1 AND delta = ? ORDER BY rowid DESC LIMIT 1')
            .get(first.data.text) as { stream_id: string } | undefined;
          const responseId = response.headers['x-stream-id'];
          const streamId = String(
            (Array.isArray(responseId) ? responseId[0] : responseId) || persisted?.stream_id || '',
          );
          const disconnectedAt = Date.now();
          response.destroy();
          resolve({ streamId, events, disconnectedAt });
        });
        response.on('error', () => undefined);
      },
    );
    request.on('error', () => undefined);
    request.setTimeout(5000, () => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new Error('等待首个 delta 超时'));
    });
    request.end(JSON.stringify(VALID_BODY));
  });
}

function abortError() {
  const error = new Error('client disconnected');
  error.name = 'AbortError';
  return error;
}

describe('Task-6 SSE 断线续传', () => {
  let ownerToken = '';
  let otherToken = '';

  before(async () => {
    await startServer();
    ownerToken = await createUser('sse-resume-owner');
    otherToken = await createUser('sse-resume-other');
  });

  after(async () => {
    resetFollowUpGenerator();
    await stopServer();
  });

  beforeEach(() => {
    resetFollowUpGenerator();
    // 即使旧实现误入字数/结构重试，也绝不访问真实 AI 网络。
    setFollowUpGenerator(async () => ({ structured: null, text: '重试兜底', wordCount: 4 }));
  });

  test('真实断流约 10 秒后按 streamId + Last-Event-ID 有序补发缺失 seq，协议与实时 delta 一致', { timeout: 30000 }, async () => {
    let generationCalls = 0;
    setFollowUpStreamer(async function* () {
      generationCalls++;
      if (generationCalls > 1) {
        yield '错误地重新生成';
        return;
      }
      yield '甲';
      // 模拟上游已经缓冲、在连接断开后才交付的分片。
      await delay(250);
      yield '乙';
      yield '丙';
    });

    const first = await disconnectAfterFirstDelta(ownerToken);
    assert.ok(first.streamId, '首个响应必须暴露稳定的 X-Stream-ID（旧实现可从首个持久化分片取得基线 ID）');
    await delay(10000);
    const disconnectedMs = Date.now() - first.disconnectedAt;
    assert.ok(disconnectedMs >= 9500, '重连间隔应真实达到约 10 秒，实际 ' + disconnectedMs + 'ms');

    const resumed = await collectStream(ownerToken, {
      'X-Stream-ID': first.streamId,
      'Last-Event-ID': '1',
    });
    assert.equal(resumed.status, 200, resumed.raw);
    assert.deepEqual(
      resumed.events.filter((event) => event.event === 'delta' || event.event === 'chunk'),
      [
        { event: 'delta', id: '2', data: { text: '乙' } },
        { event: 'delta', id: '3', data: { text: '丙' } },
      ],
      '只补 seq>1，事件名、id、data.text 均与实时协议一致',
    );
    assert.equal(generationCalls, 1, '续传不能重启上游生成');
    assert.equal(resumed.events.at(-1)?.event, 'done', '断网期间上游继续完成，重连必须收到最终 done');
    assert.equal(resumed.events.at(-1)?.data.content, '甲乙丙', '最终内容完整且无重复、无乱序');
    const persisted = db
      .prepare('SELECT seq, delta FROM ai_stream_chunks WHERE stream_id = ? ORDER BY seq')
      .all(first.streamId);
    assert.deepEqual(persisted, [
      { seq: 1, delta: '甲' },
      { seq: 2, delta: '乙' },
      { seq: 3, delta: '丙' },
    ]);
  });

  test('已完成流可重放最终 done，且不会重新调用上游', async () => {
    let generationCalls = 0;
    setFollowUpStreamer(async function* () {
      generationCalls++;
      yield GOOD;
    });
    const initial = await collectStream(ownerToken);
    assert.equal(initial.status, 200, initial.raw);
    assert.ok(initial.streamId, '完成响应也必须提供 X-Stream-ID');
    assert.equal(initial.events.at(-1)?.event, 'done', initial.raw);

    const resumed = await collectStream(ownerToken, {
      'X-Stream-ID': initial.streamId,
      'Last-Event-ID': '1',
    });
    assert.equal(resumed.status, 200, resumed.raw);
    assert.equal(resumed.events.filter((event) => event.event === 'delta').length, 0);
    assert.equal(resumed.events.filter((event) => event.event === 'done').length, 1);
    assert.equal(resumed.events.at(-1)?.data.content, initial.events.at(-1)?.data.content);
    assert.equal(generationCalls, 1, '完成态重连只读持久化结果');
  });

  test('过期流返回 410 STREAM_EXPIRED，并清理会话与全部分片', async () => {
    setFollowUpStreamer(async function* () {
      yield GOOD;
    });
    const initial = await collectStream(ownerToken);
    assert.ok(initial.streamId, initial.raw);
    db.prepare('UPDATE ai_stream_sessions SET expires_at = ? WHERE stream_id = ?').run(
      Date.now() - 1000,
      initial.streamId,
    );

    const expired = await collectStream(ownerToken, {
      'X-Stream-ID': initial.streamId,
      'Last-Event-ID': '1',
    });
    assert.equal(expired.status, 410, expired.raw);
    assert.equal(expired.body?.code, 'STREAM_EXPIRED');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM ai_stream_chunks WHERE stream_id = ?').get(initial.streamId) as { count: number } | undefined)?.count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM ai_stream_sessions WHERE stream_id = ?').get(initial.streamId) as { count: number } | undefined)?.count,
      0,
    );
  });

  test('其他用户携带相同 streamId 与 Last-Event-ID 也读不到分片', async () => {
    setFollowUpStreamer(async function* () {
      yield 'USER_A_PRIVATE_FIRST';
      await delay(200);
      yield 'USER_A_PRIVATE_SECOND';
      throw abortError();
    });
    const first = await disconnectAfterFirstDelta(ownerToken);
    await delay(350);

    const forbidden = await collectStream(otherToken, {
      'X-Stream-ID': first.streamId,
      'Last-Event-ID': '1',
    });
    assert.equal(forbidden.status, 404, forbidden.raw);
    assert.equal(forbidden.body?.code, 'STREAM_NOT_FOUND');
    assert.equal(forbidden.raw.includes('USER_A_PRIVATE'), false);
  });
});
