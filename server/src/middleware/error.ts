import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: '接口不存在' });
}
