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
    return res.status(401).json({ error: '认证令牌无效或已过期' });
  }
}
