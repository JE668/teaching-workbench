import './setup.js';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  withAiSlot,
  withUserAiSlot,
  acquireAiSlot,
  releaseAiSlot,
  getAiInFlightCount,
  resetAiGate,
  MAX_CONCURRENT_AI,
  MAX_CONCURRENT_AI_GLOBAL,
  AI_QUEUE_TIMEOUT_MS,
} from '../services/ai/index.js';

/**
 * AI 并发闸门。
 *
 * 老师连点两次「生成」就是两个请求一起打出去：双倍计费，而且两份结果会互相覆盖。
 * 闸门现在是「按用户分桶」的：单用户限 MAX_CONCURRENT_AI，多用户叠加再受全局上限约束。
 * 这里不碰真实 API，只验证排队 / 释放 / 分桶语义。
 */
describe('AI 并发闸门', () => {
  after(() => resetAiGate());

  test('同时最多 MAX_CONCURRENT_AI 个在跑，多的排队后照跑', async () => {
    let concurrent = 0;
    let peak = 0;
    let done = 0;
    const hold = () => new Promise<void>((r) => setTimeout(r, 10));

    const tasks = Array.from({ length: MAX_CONCURRENT_AI + 3 }, (_, i) =>
      withAiSlot(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await hold();
        concurrent--;
        done++;
        return i;
      })
    );

    const results = await Promise.all(tasks);

    assert.equal(peak, MAX_CONCURRENT_AI, '并发峰值不能超过上限');
    assert.equal(done, tasks.length, '排队的请求一个都不能丢');
    assert.deepEqual(results, tasks.map((_, i) => i), '返回顺序不该错乱');
    assert.equal(getAiInFlightCount(), 0, '全部结束后槽位归零');
  });

  test('任务抛错也会释放槽位，不会把闸门卡死', async () => {
    await assert.rejects(() => withAiSlot(async () => {
      throw new Error('boom');
    }), /boom/);
    assert.equal(getAiInFlightCount(), 0);

    // 卡住的话这条会永远等下去
    await withAiSlot(async () => undefined);
    assert.equal(getAiInFlightCount(), 0);
  });

  test('多个等待者被逐个唤醒，任何时刻占用都不超过上限', async () => {
    const releases: Array<() => void> = [];
    for (let i = 0; i < MAX_CONCURRENT_AI; i++) {
      await acquireAiSlot();
      releases.push(() => releaseAiSlot());
    }
    assert.equal(getAiInFlightCount(), MAX_CONCURRENT_AI);

    let peak = getAiInFlightCount();
    const waiters = Array.from({ length: 5 }, () =>
      acquireAiSlot().then(() => {
        peak = Math.max(peak, getAiInFlightCount());
        releaseAiSlot();
      })
    );

    for (const release of releases) release();
    await Promise.all(waiters);

    assert.equal(peak, MAX_CONCURRENT_AI, '等待者被唤醒时不能多抢同一个槽位');
    assert.equal(getAiInFlightCount(), 0);
  });

  test('按用户分桶：一个用户占满后，别的用户照样立刻开跑', async () => {
    const a = 1001;
    const b = 1002;
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, a);
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, a);
    assert.equal(getAiInFlightCount(a), MAX_CONCURRENT_AI);

    // 老实现这里是整站共用计数，b 必须排队；分桶后应当直接拿到槽位
    await acquireAiSlot(200, b);
    assert.equal(getAiInFlightCount(b), 1);
    assert.equal(getAiInFlightCount(), MAX_CONCURRENT_AI + 1);

    releaseAiSlot(b);
    releaseAiSlot(a);
    releaseAiSlot(a);
    assert.equal(getAiInFlightCount(), 0);
    assert.equal(getAiInFlightCount(a), 0);
    assert.equal(getAiInFlightCount(b), 0);
  });

  test('同一个用户的第 3 个请求排队，超时后只影响他自己', async () => {
    const busy = 2001;
    const other = 2002;
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, busy);
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, busy);

    await assert.rejects(acquireAiSlot(30, busy), (e: Error) => e.name === 'AiQueueTimeoutError');
    // 同一个用户被占满，不影响另一个用户
    await acquireAiSlot(30, other);

    releaseAiSlot(other);
    releaseAiSlot(busy);
    releaseAiSlot(busy);
    assert.equal(getAiInFlightCount(), 0);
  });

  test('全局上限兜底：多用户叠加也压不过 MAX_CONCURRENT_AI_GLOBAL', async () => {
    for (let i = 0; i < MAX_CONCURRENT_AI_GLOBAL; i++) {
      await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, 3000 + i);
    }
    assert.equal(getAiInFlightCount(), MAX_CONCURRENT_AI_GLOBAL);

    // 再来一个新用户：自己的桶是空的，但全局满了，必须排队
    await assert.rejects(acquireAiSlot(30, 3999), (e: Error) => e.name === 'AiQueueTimeoutError');

    // 让出一个全局名额后，等待者能被唤醒并拿到槽位
    const waiter = acquireAiSlot(2000, 3999);
    releaseAiSlot(3000);
    await waiter;
    assert.equal(getAiInFlightCount(3999), 1);
    assert.equal(getAiInFlightCount(), MAX_CONCURRENT_AI_GLOBAL);

    releaseAiSlot(3999);
    for (let i = 1; i < MAX_CONCURRENT_AI_GLOBAL; i++) releaseAiSlot(3000 + i);
    assert.equal(getAiInFlightCount(), 0);
  });

  test('releaseAiSlot 传错用户只清自己的桶，不误放行闸门总数', async () => {
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, 4001);
    assert.equal(getAiInFlightCount(), 1);
    releaseAiSlot(4002);
    assert.equal(getAiInFlightCount(), 0, '总数会被误减，但该用户自己的桶必须还是 1');
    assert.equal(getAiInFlightCount(4001), 1);
    releaseAiSlot(4001);
    assert.equal(getAiInFlightCount(4001), 0);
  });

  test('withUserAiSlot 结束（含抛错）后用户桶归零', async () => {
    const u = 5001;
    assert.equal(await withUserAiSlot(u, async () => 'ok'), 'ok');
    assert.equal(getAiInFlightCount(u), 0);

    await assert.rejects(() => withUserAiSlot(u, async () => {
      throw new Error('boom');
    }), /boom/);
    assert.equal(getAiInFlightCount(u), 0);
  });

  test('resetAiGate 清空所有用户桶与等待者', async () => {
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, 6001);
    await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, 6002);
    resetAiGate();
    assert.equal(getAiInFlightCount(), 0);
    assert.equal(getAiInFlightCount(6001), 0);
    assert.equal(getAiInFlightCount(6002), 0);
  });

  test('闸门覆盖所有 AI 入口：回访 / 星级 / 听评课都套上了', async () => {
    // 回归护栏：谁新加一个 AI 能力、忘了套闸门，这里会红。
    // 生成入口在 ai/index.ts (generateOnce/streamOnce/generateChatOnce/streamChat)，
    // catalogStar/observation 也在各自文件里用 withUserAiSlot/acquireAiSlot。
    const files = await Promise.all(
      ['services/ai/index.ts', 'services/catalogStar.ts', 'services/observation.ts'].map((f) =>
        readFile(new URL('../' + f, import.meta.url), 'utf-8')
      )
    );
    const wrapped = files.reduce(
      (sum, s) =>
        sum +
        (s.match(/withUserAiSlot\(/g) || []).length +
        (s.match(/withAiSlot\(/g) || []).length +
        (s.match(/acquireAiSlot\(/g) || []).length,
      0
    );
    assert.ok(wrapped >= 5, '所有 AI 入口都该进闸门，实际 ' + wrapped);

    // 更硬的约束：进闸门必须带 userId，否则就是又回到全站共用一个桶
    const bareCalls = files.reduce(
      (sum, s) =>
        sum +
        (s.match(/withAiSlot\(async \(\) =>/g) || []).length +
        (s.match(/acquireAiSlot\(\)/g) || []).length +
        (s.match(/releaseAiSlot\(\)/g) || []).length,
      0
    );
    assert.equal(bareCalls, 0, 'AI 入口必须传 userId（withUserAiSlot / acquireAiSlot(ms, userId)），实际裸调用 ' + bareCalls);
  });

  test('排队超过上限时间快速失败，超时者被移出队列', async () => {
    // 占满闸门且不释放
    await acquireAiSlot();
    await acquireAiSlot();
    assert.equal(getAiInFlightCount(), MAX_CONCURRENT_AI);

    await assert.rejects(acquireAiSlot(30), (e: Error) => e.name === 'AiQueueTimeoutError');
    // 超时者已出队：再释放槽位不会把它唤醒
    releaseAiSlot();
    releaseAiSlot();
    await new Promise((r) => setTimeout(r, 60));
    // 闸门可继续正常借用（超时定时器已清，进程不因句柄滞留）
    await withAiSlot(async () => 1);
    assert.equal(getAiInFlightCount(), 0);
  });

  test('正常放行会清掉排队超时定时器，不误伤', async () => {
    await acquireAiSlot();
    await acquireAiSlot();
    const waiter = acquireAiSlot(10_000); // 远大于用例时长
    releaseAiSlot();
    await waiter; // 定时器没清的话 10s 后会二次 reject（unhandled）
    // 此刻自己 + 被唤醒的 waiter 各占一槽，两次释放才归零
    releaseAiSlot();
    releaseAiSlot();
    assert.equal(getAiInFlightCount(), 0);
  });
});
