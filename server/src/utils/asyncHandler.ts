import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 不自动捕获 async handler 的 rejection：
 * async 路由抛错不会进 errorHandler，而是变成 unhandledRejection ——
 * 进程活着（只留一条日志），但该请求永远没有响应（SSE 场景下前端无限等待）。
 *
 * 这个包装把 rejection 接住：
 * - 响应头未发出（普通 JSON 路由 / SSE 建流前的准备段抛错）→ 回 500；
 * - 响应头已发出（SSE 流中途抛错，handler 内部通常已有 catch，这里是最后防线）→
 *   强制终结连接，让客户端立即感知中断而不是无限等待。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch((err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: '服务器内部错误', message: err?.message ?? String(err) });
      } else {
        try {
          res.destroy(err instanceof Error ? err : new Error(String(err)));
        } catch {
          /* 连接已死，忽略 */
        }
      }
    });
  };
}
