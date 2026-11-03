import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.js';
import { startStreamWatchdog, AiStreamIdleError } from '../services/ai/index.js';
import { env } from '../config/env.js';

// 流式空闲中断（watchdog）：
// SDK 的 timeout 只管连接/首响应，流中途上游挂住（不发 chunk 也不关连接）时
// for await 会永久挂起、把并发槽占死。watchdog 用「相邻 chunk 最大间隔」定时器
// abort，让循环抛错释放槽。这里直接测 watchdog 核心行为（不必拉起真实 SDK 流）。

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

/** 把 idle 超时临时调短，避免测试等 60s */
function withShortIdle<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const orig = env.AI_STREAM_IDLE_TIMEOUT_MS;
  env.AI_STREAM_IDLE_TIMEOUT_MS = ms;
  return fn().finally(() => {
    env.AI_STREAM_IDLE_TIMEOUT_MS = orig;
  });
}

test('流空闲超过阈值时 abort，错误是 AiStreamIdleError', async () => {
  await withShortIdle(60, async () => {
    const wd = startStreamWatchdog();
    const aborted = new Promise<unknown>((resolve) => {
      wd.signal.addEventListener('abort', () => resolve(wd.signal.reason));
    });
    // 不 kick，等空闲定时器触发
    const reason = await aborted;
    wd.done();
    assert.ok(reason instanceof AiStreamIdleError, 'abort reason 应为 AiStreamIdleError');
  });
});

test('持续 kick 会复位定时器，不误伤正常产出的慢流', async () => {
  await withShortIdle(80, async () => {
    const wd = startStreamWatchdog();
    let aborted = false;
    wd.signal.addEventListener('abort', () => {
      aborted = true;
    });
    // 每 30ms kick 一次，共 6 次（总 180ms > 80ms 阈值），若不复位早就 abort
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(aborted, false, `第 ${i + 1} 次 kick 后不应 abort`);
      wd.kick();
    }
    wd.done();
    assert.equal(aborted, false, '持续 kick 全程不应 abort');
  });
});

test('done() 后不再触发 abort（避免流正常结束后误报）', async () => {
  await withShortIdle(60, async () => {
    const wd = startStreamWatchdog();
    wd.done();
    let aborted = false;
    wd.signal.addEventListener('abort', () => {
      aborted = true;
    });
    await new Promise((r) => setTimeout(r, 160)); // 远超 60ms 阈值
    assert.equal(aborted, false, 'done() 后定时器应已清理，不应 abort');
  });
});
