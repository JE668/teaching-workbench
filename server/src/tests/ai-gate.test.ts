import './setup.js';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  withAiSlot,
  acquireAiSlot,
  releaseAiSlot,
  getAiInFlightCount,
  resetAiGate,
  MAX_CONCURRENT_AI,
} from '../services/ai.js';

/**
 * AI 并发闸门。
 *
 * 老师连点两次「生成」就是两个请求一起打出去：双倍计费，而且两份结果会互相覆盖。
 * 这里不碰真实 API，只验证闸门的排队 / 释放语义。
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

  test('闸门覆盖所有 AI 入口：回访 / 精简 / 星级 / 听评课都套上了', async () => {
    // 回归护栏：谁新加一个 AI 能力、忘了套闸门，这里会红。
    const files = await Promise.all(
      ['services/ai.ts', 'services/catalogStar.ts', 'services/observation.ts'].map((f) =>
        readFile(new URL('../' + f, import.meta.url), 'utf-8')
      )
    );
    // ai.ts 4 处（generateOnce / streamOnce / condense / streamCondense），
    // catalogStar 1 处，observation 2 处
    const wrapped = files.reduce(
      (sum, s) =>
        sum +
        (s.match(/withAiSlot\(/g) || []).length +
        (s.match(/acquireAiSlot\(/g) || []).length,
      0
    );
    assert.ok(wrapped >= 6, '所有 AI 入口都该进闸门，实际 ' + wrapped);
  });
});
