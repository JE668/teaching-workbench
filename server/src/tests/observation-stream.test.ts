import './setup.js';
import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, url, createUser, req } from './helpers.js';
import {
  setObservationStreamer,
  resetObservationStreamer,
} from '../services/observation.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('obs-stream');
});
after(async () => {
  await stopServer();
});
beforeEach(() => {
  resetObservationStreamer();
});

async function collectSse(path: string): Promise<{ status: number; contentType: string | null; events: { event: string; data: any }[]; raw: string }> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: '{}',
  });
  const contentType = res.headers.get('content-type');
  const raw = await res.text();
  if (!contentType || !contentType.includes('text/event-stream')) {
    return { status: res.status, contentType, events: [], raw };
  }
  const events = raw
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((frame) => {
      const ev = /^event:\s*(.+)$/m.exec(frame);
      const data = /^data:\s*(.+)$/m.exec(frame);
      let parsed: any = null;
      try {
        parsed = data ? JSON.parse(data[1]) : null;
      } catch {
        parsed = data ? data[1] : null;
      }
      return { event: ev ? ev[1] : 'message', data: parsed };
    });
  return { status: res.status, contentType, events, raw };
}

function streamOf(chunks: string[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

describe('听评课 SSE 流式生成', () => {
  test('流式下发 delta + done，并落库', async () => {
    const t = await req('POST', '/api/teachers', { token, body: { name: '王老师' } });
    const o = await req('POST', '/api/observations', {
      token,
      body: { teacherId: t.body.teacher.id, topic: '分数加减法', lessonType: 'new', classNotes: '实录…' },
    });
    const id = o.body.observation.id;

    setObservationStreamer(() =>
      streamOf(['【听课人评价】\n', '教学目标：目标明确，贴合课程标准。\n', '四、总体评价等级：良好\n'])()
    );

    const sse = await collectSse('/api/observations/' + id + '/report/stream');
    assert.equal(sse.status, 200);
    assert.ok(String(sse.contentType).includes('text/event-stream'));
    const deltas = sse.events.filter((e) => e.event === 'delta');
    assert.ok(deltas.length >= 2, '应有多段 delta');
    const done = sse.events.find((e) => e.event === 'done');
    assert.ok(done, '应有 done 事件');
    assert.match(done.data.report, /目标明确/);
    assert.equal(done.data.suggestedGrade, 'good');

    // 已落库
    const after = await req('GET', '/api/observations/' + id, { token });
    assert.ok(after.body.observation.report.includes('目标明确'));
    assert.equal(after.body.observation.overallGrade, 'good');
  });

  test('记录不存在 → 404（非 SSE）', async () => {
    const sse = await collectSse('/api/observations/999999/report/stream');
    assert.equal(sse.status, 404);
    assert.ok(!String(sse.contentType || '').includes('text/event-stream'));
  });
});
