import type { Response } from 'express';

/**
 * 打开一条 SSE 响应并返回写接口。回访和月度总结的流式路由共用这一份。
 *
 * 客户端提前断开检测的坑：不能用 req.on('close') —— 请求体读完后它就触发，
 * 会误判为断连。res 的 'close' 在响应结束或连接断开时触发，
 * 配合 writableEnded 才能区分"正常结束"和"中途掉线"。
 */
export function openSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 关键：禁用 nginx 缓冲，否则流式会被攒成一坨再下发
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) clientGone = true;
  });

  const send = (event: string, data: unknown) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    } catch {
      clientGone = true;
    }
  };

  return {
    send,
    isGone: () => clientGone,
    end: () => {
      if (!res.writableEnded) res.end();
    },
  };
}
