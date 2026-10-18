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

async function collectSse(path: string, body: unknown = {}): Promise<{ status: number; contentType: string | null; events: { event: string; data: any }[]; raw: string }> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
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

  test('生成前已选定等级：AI 收到该等级，且落库以选定值为准', async () => {
    const t = await req('POST', '/api/teachers', { token, body: { name: '李老师' } });
    const o = await req('POST', '/api/observations', {
      token,
      body: { teacherId: t.body.teacher.id, topic: '分数加减法', lessonType: 'new', classNotes: '实录…' },
    });
    const id = o.body.observation.id;

    // 真实前端流程：点「生成」时先 PUT 保存（含已选等级），再开流式生成
    const put = await req('PUT', '/api/observations/' + id, { token, body: { overallGrade: 'excellent' } });
    assert.equal(put.body.observation.overallGrade, 'excellent');

    // AI 明明判了"良好"，但用户生成前选的是"优秀" —— 选定值必须胜出
    let seenGrade: string | null | undefined;
    setObservationStreamer((p: any) => {
      seenGrade = p.overallGrade ?? null;
      return streamOf(['【综合评价与建议】\n', '四、总体评价等级：良好\n'])();
    });

    const sse = await collectSse('/api/observations/' + id + '/report/stream', { overallGrade: 'excellent' });
    assert.equal(sse.status, 200);
    const done = sse.events.find((e) => e.event === 'done');
    assert.ok(done, '应有 done 事件');

    // ① 等级确实传进了生成参数（→ 进了提示词，AI 据此写内容）
    assert.equal(seenGrade, 'excellent');
    // ② 对外回报与落库都以选定值为准，不被 AI 建议覆盖
    assert.equal(done.data.suggestedGrade, 'good');
    assert.equal(done.data.overallGrade, 'excellent');
    const after = await req('GET', '/api/observations/' + id, { token });
    assert.equal(after.body.observation.overallGrade, 'excellent');
  });

  test('生成前没选等级：不做等级约束，回退用 AI 建议', async () => {
    const t = await req('POST', '/api/teachers', { token, body: { name: '张老师' } });
    const o = await req('POST', '/api/observations', {
      token,
      body: { teacherId: t.body.teacher.id, topic: '分数加减法', lessonType: 'new', classNotes: '实录…' },
    });
    const id = o.body.observation.id;

    let seenGrade: string | null | undefined;
    setObservationStreamer((p: any) => {
      seenGrade = p.overallGrade ?? null;
      return streamOf(['【综合评价与建议】\n', '四、总体评价等级：合格\n'])();
    });

    const sse = await collectSse('/api/observations/' + id + '/report/stream', {});
    const done = sse.events.find((e) => e.event === 'done');
    assert.ok(done);
    assert.equal(seenGrade, null, '未选定时不应给 AI 注入等级约束');
    assert.equal(done.data.overallGrade, 'pass');
  });
});
