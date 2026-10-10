import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../types/index.js';

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: number };
    req.userId = decoded.userId;
    next();
  } catch (error) {
    // 区分两种失败，给出可操作的提示：
    // - 过期：正常现象，重新登录即可
    // - 签名不匹配：多半是 JWT_SECRET 变了（.env 被改/重建过），
    //   旧令牌从此永久失效，也必须重新登录 —— 但要说明原因，否则
    //   用户会以为是密码错或系统坏了。
    const expired = error instanceof jwt.TokenExpiredError;
    return res.status(401).json({
      error: expired ? '登录已过期，请重新登录' : '登录状态已失效，请重新登录',
      reason: expired ? 'expired' : 'invalid',
    });
  }
}
