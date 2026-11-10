import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 显式锁定算法白名单：不写的话 jwt.verify 会接受令牌头里声明的任意算法
    // （纵深防御——当前 HS256 单一密钥下不可直接利用，但把面收掉是零成本的）。
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { userId: number; iat?: number };

    // 改密码吊销：JWT 本身无状态，改密后旧令牌（默认 7 天）依然有效。
    // 用户表存「token_valid_after」（改密时刻的秒级 Unix 时间），
    // 签发时间早于它的令牌一律判过期 —— 改密即全端下线，被盗 token 可止损。
    // 该列是增量补的，历史库默认 0（不拦任何令牌，行为与旧行为一致）。
    if (typeof decoded.iat === 'number') {
      const row = db.prepare('SELECT token_valid_after AS tva FROM users WHERE id = ?').get(decoded.userId) as
        | { tva: number }
        | undefined;
      const validAfter = Number(row?.tva || 0);
      if (validAfter > 0 && decoded.iat < validAfter) {
        return res.status(401).json({
          error: '密码已修改，请重新登录',
          reason: 'invalid',
        });
      }
    }

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
