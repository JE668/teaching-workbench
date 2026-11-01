import type { Response, Request } from 'express';

/**
 * 打开一条 SSE 响应并返回写接口。回访和月度总结的流式路由共用这一份。
 *
 * 客户端提前断开检测的坑：不能用 req.on('close') —— 请求体读完后它就触发，
 * 会误判为断连。res 的 'close' 在响应结束或连接断开时触发，
 * 配合 writableEnded 才能区分"正常结束"和"中途掉线"。
 *
 * 心跳机制：每 15 秒发送 `: heartbeat\n\n`（SSE 注释行，客户端忽略但能重置空闲超时）。
 * 续传支持：读取 Last-Event-ID 头，若客户端带有则可实现断点续传（当前实现仅确认收到）。
 */
export function openSse(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 关键：禁用 nginx 缓冲，否则流式会被攒成一坨再下发
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 读取 Last-Event-ID（用于续传确认）
  const lastEventId = req.headers['last-event-id'] as string | undefined;
  if (lastEventId) {
    log.debug({ lastEventId }, 'SSE 续传：客户端携带 Last-Event-ID');
  }

  let clientGone = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  // 启动 15 秒心跳
  heartbeatTimer = setInterval(() => {
    if (clientGone || res.writableEnded) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      return;
    }
    try {
      // SSE 注释行作为心跳，不触发 onmessage，但能重置浏览器/代理空闲超时
      res.write(': heartbeat\n\n');
    } catch {
      clientGone = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }, 15000);

  res.on('close', () => {
    if (!res.writableEnded) clientGone = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });

  const send = (event: string, data: unknown, options?: { id?: string }) => {
    if (clientGone || res.writableEnded) return;
    try {
      let payload = 'event: ' + event + '\n';
      if (options?.id) {
        payload += 'id: ' + options.id + '\n';
      }
      payload += 'data: ' + JSON.stringify(data) + '\n\n';
      res.write(payload);
    } catch {
      clientGone = true;
    }
  };

  return {
    send,
    isGone: () => clientGone,
    end: () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (!res.writableEnded) res.end();
    },
  };
}
