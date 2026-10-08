import './setup.js';
import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, url, createUser } from './helpers.js';
import {
  setFollowUpStreamer,
  setFollowUpGenerator,
  resetFollowUpGenerator,
} from '../services/ai.js';

let token = '';

before(async () => {
  await startServer();
  token = await createUser('stream-teacher');
});
after(async () => {
  await stopServer();
});
beforeEach(() => {
  resetFollowUpGenerator();
});

const VALID_BODY = {
  studentName: '李小明',
  grade: '小学五年级',
  subject: '数学',
  topic: '分数加减法运算',
  performance: '专注度较高',
  mastery: 'good',
  images: [],
};

/** 收集 SSE 事件 */
async function collectSse(
  body: any,
  tk = token
): Promise<{ status: number; contentType: string | null; events: { event: string; data: any }[]; raw: string }> {
  const res = await fetch(url('/api/followups/generate/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
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

/** 生成一个会产生指定分片的流式桩 */
function streamOf(chunks: string[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

describe('流式生成接口', () => {
  test('缺少必填字段返回 400（普通 JSON，非 SSE）', async () => {
    const res = await collectSse({ studentName: '只有名字' });
    assert.equal(res.status, 400);
    assert.ok(!String(res.contentType).includes('text/event-stream'));
  });

  test('声明 SSE 响应头并关闭 nginx 缓冲', async () => {
    setFollowUpStreamer(streamOf(['内容']));
    const res = await fetch(url('/api/followups/generate/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(VALID_BODY),
    });
    assert.match(String(res.headers.get('content-type')), /text\/event-stream/);
    assert.equal(res.headers.get('x-accel-buffering'), 'no', '必须关闭代理缓冲，否则流式失效');
    await res.text();
  });

  test('逐块下发 delta，最后以 done 收尾', async () => {
    const good =
      '【课堂内容】本节课重点讲解分数通分的原理与步骤，通过数轴演示帮助理解，并结合生活情境设计练习。' +
      '【学生收获】李小明专注度较高，能够主动举手回答问题，对通分方法掌握到位，独立完成基础题型准确率良好。' +
      '【课后任务】完成练习册第12页第1到8题，巩固通分步骤，每天做10道口算提升计算速度与准确率。';

    const mid = Math.floor(good.length / 2);
    setFollowUpStreamer(streamOf([good.slice(0, mid), good.slice(mid)]));

    const res = await collectSse(VALID_BODY);
    assert.equal(res.status, 200);

    const deltas = res.events.filter((e) => e.event === 'delta');
    assert.equal(deltas.length, 2, '应收到 2 个 delta');
    assert.equal(deltas.map((d) => d.data.text).join(''), good, 'delta 拼接应等于完整内容');

    const done = res.events.find((e) => e.event === 'done');
    assert.ok(done, '应有 done 事件');
    assert.equal(done.data.content, good);
    assert.equal(done.data.regenerated, false);
    assert.equal(done.data.wordCount, good.replace(/[\s\p{P}\p{S}]/gu, '').length);

    assert.equal(res.events[res.events.length - 1].event, 'done', 'done 必须是最后一个事件');
  });

  test('字数不达标时发出 regenerating 并以重试结果收尾', async () => {
    const tooShort = '太短了。';
    // 注意：必须真的落在 150-500 区间，否则路由会正确判定其不合格（这里曾经写短过）
    const good =
      '【课堂内容】本节课重点讲解异分母分数加减法的通分原理与步骤，通过数轴与图形直观演示，帮助学生理解分数单位统一的数学本质，并结合生活情境设计练习，让抽象的分数运算变得具体可感。' +
      '【学生收获】李小明本节课专注度较高，能够主动举手回答问题，对通分方法的理解比较到位，独立完成基础题型时准确率良好，计算速度还有提升空间，建议通过限时练习逐步改善。' +
      '【课后任务】完成练习册第12页第1到8题，重点巩固通分步骤；每天用5分钟做10道口算，提升计算速度与准确率。';

    setFollowUpStreamer(streamOf([tooShort]));
    setFollowUpGenerator(async () => good);

    const res = await collectSse(VALID_BODY);
    assert.equal(res.status, 200);

    const regen = res.events.find((e) => e.event === 'regenerating');
    assert.ok(regen, '应发出 regenerating 事件');
    assert.equal(regen.data.wordCount, tooShort.replace(/[\s\p{P}\p{S}]/gu, '').length);

    const done = res.events.find((e) => e.event === 'done');
    assert.ok(done);
    assert.equal(done.data.regenerated, true, '应标记为已重新生成');
    assert.equal(done.data.content, good, '应以重试版本收尾');

    const expectedWords = good.replace(/[\s\p{P}\p{S}]/gu, '').length;
    assert.equal(done.data.wordCount, expectedWords);
    assert.ok(
      expectedWords >= 150 && expectedWords <= 500,
      '测试数据本身应落在区间内，当前 ' + expectedWords + ' 字'
    );
  });

  test('流式异常时下发 error 事件（而非静默中断）', async () => {
    setFollowUpStreamer(async function* () {
      yield '开头';
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    });

    const res = await collectSse(VALID_BODY);
    assert.equal(res.status, 200, 'SSE 已开始发送，无法再改状态码');
    const err = res.events.find((e) => e.event === 'error');
    assert.ok(err, '应发出 error 事件');
    assert.match(err.data.error, /API Key 无效/);
  });

  test('超时错误映射为可读提示', async () => {
    setFollowUpStreamer(async function* () {
      throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    });
    const res = await collectSse(VALID_BODY);
    const err = res.events.find((e) => e.event === 'error');
    assert.ok(err);
    assert.match(err.data.error, /超时/);
  });

  test('未登录无法访问流式接口', async () => {
    const res = await fetch(url('/api/followups/generate/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    assert.equal(res.status, 401);
    await res.text();
  });
});
