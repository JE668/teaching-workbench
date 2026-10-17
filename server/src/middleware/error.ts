import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger.js';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  log.error({ err: err.stack, path: req.path, method: req.method }, '请求处理异常');
  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: '接口不存在' });
}
