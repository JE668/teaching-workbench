import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger.js';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  log.error({ err: err.stack, path: req.path, method: req.method }, '请求处理异常');
  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

/**
 * S10 防泄露：85 处路由手写 res.status(500).json({ ..., message: error.message })
 * 会直接回显 SQLite/FS 错误（可能含 SQL 片段、绝对路径）。
 * 这里用 monkey-patch res.json 拦截：生产环境下 500 响应中的 message 字段一律抹除，
 * 完整错误仍走 log.error 记录在服务端日志里。
 * 不改 84 处业务代码 —— 逐个改工作量大且未来新路由容易漏。
 */
export function sanitizeErrorMessages(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'development') return next();
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode >= 500 && body && typeof body === 'object' && body.message) {
      log.warn({ path: req.path, method: req.method, leakedMessage: body.message }, '500 响应泄露 error.message，已抹除');
      return originalJson({ ...body, message: undefined });
    }
    return originalJson(body);
  };
  next();
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: '接口不存在' });
}
