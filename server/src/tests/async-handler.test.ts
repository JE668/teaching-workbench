import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Express 4 不会自动捕获 async handler 的 rejection：
 * 不包的话，抛出的错误变成 unhandledRejection（进程只留一条日志），
 * 而该请求【永远没有响应】—— 浏览器一直转圈，SSE 场景下更是无限挂起。
 *
 * asyncHandler 的两个分支都必须有用例，否则"兜底"是假的：
 *   1) 响应头未发出 → 回 500 JSON（普通路由、SSE 建流前的准备段）
 *   2) 响应头已发出 → 不再试图写 500，而是销毁连接让客户端立刻感知中断
 */

function fakeRes(headersSent = false) {
  const calls: { method: string; args: unknown[] }[] = [];
  const res = {
    headersSent,
    statusCode: 200,
    destroyed: false,
    status: (code: number) => {
      calls.push({ method: 'status', args: [code] });
      res.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      calls.push({ method: 'json', args: [body] });
      return res;
    },
    destroy: (err?: Error) => {
      calls.push({ method: 'destroy', args: [err] });
      res.destroyed = true;
      return res;
    },
  };
  return { res: res as unknown as Response & typeof res, calls };
}

describe('asyncHandler：把 async rejection 转成确定的失败响应', () => {
  test('响应头未发送 → 500 + 错误信息，不让请求永挂', async () => {
    const { res, calls } = fakeRes(false);
    const handler = asyncHandler(async () => {
      throw new Error('boom');
    });

    await handler({} as Request, res, () => {});

    assert.equal(res.statusCode, 500);
    const jsonCall = calls.find((c) => c.method === 'json');
    assert.ok(jsonCall, '必须写出响应体');
    assert.equal((jsonCall!.args[0] as any).message, 'boom');
  });

  test('非 Error 抛出物也能被安全序列化（不会二次崩溃）', async () => {
    const { res, calls } = fakeRes(false);
    const handler = asyncHandler(async () => {
      throw '不是 Error 的字符串';
    });

    await handler({} as Request, res, () => {});

    assert.equal(res.statusCode, 500);
    const jsonCall = calls.find((c) => c.method === 'json');
    assert.equal((jsonCall!.args[0] as any).message, '不是 Error 的字符串');
  });

  test('响应头已发送（SSE 中途） → 不再写 500，改为销毁连接', async () => {
    const { res, calls } = fakeRes(true);
    const handler = asyncHandler(async () => {
      throw new Error('stream broke');
    });

    await handler({} as Request, res, () => {});

    assert.equal(res.destroyed, true, '应销毁连接，让客户端立刻感知中断');
    assert.equal(res.statusCode, 200, '不应再改状态码（头已发出）');
    assert.ok(
      !calls.some((c) => c.method === 'json'),
      '头已发出时再 json() 会产生 ERR_HTTP_HEADERS_SENT'
    );
  });

  test('正常返回不触发任何错误分支', async () => {
    const { res, calls } = fakeRes(false);
    const handler = asyncHandler(async () => {});

    await handler({} as Request, res, () => {});
    assert.equal(calls.length, 0);
    assert.equal(res.destroyed, false);
  });
});
