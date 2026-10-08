import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * 图片访问鉴权。
 *
 * 背景：`<img src>` 不会携带 Authorization 头，所以图片没法用 JWT 头鉴权。
 * 若把 /uploads 直接交给 express.static，就等于**任何拿到 URL 的人都能看**——
 * 而路径里的 userId 是可枚举的，多用户部署下 A 的照片会暴露给 B 乃至公网。
 *
 * 方案：登录时下发一个 httpOnly 的签名 cookie，访问图片时校验
 * 「签名有效」且「路径中的 userId == 令牌归属」，两者缺一不可。
 */

export const MEDIA_COOKIE = 'tw_media';
export const MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

/** 生成无状态令牌："<userId>.<expiry>.<hmac>" */
export function createMediaToken(userId: number): string {
  const payload = userId + '.' + (Date.now() + MEDIA_TTL_MS);
  return payload + '.' + sign(payload);
}

/** 校验令牌，返回归属用户；非法/过期返回 null */
export function verifyMediaToken(token: string | undefined | null): { userId: number } | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [uidStr, expStr, sig] = parts;
  const payload = uidStr + '.' + expStr;

  // 定长比较，避免时序侧信道
  const provided = Buffer.from(sig);
  const expected = Buffer.from(sign(payload));
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  const expiry = Number(expStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  const userId = Number(uidStr);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  return { userId };
}

/** 从 Cookie 头里取某个值（不引入 cookie-parser 依赖） */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return undefined;
}

/** 下发图片访问 cookie（httpOnly，同源自动携带，无需前端改造） */
export function setMediaCookie(req: Request, res: Response, userId: number): void {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(MEDIA_COOKIE, createMediaToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: MEDIA_TTL_MS,
    path: '/',
  });
}

export function clearMediaCookie(res: Response): void {
  res.clearCookie(MEDIA_COOKIE, { path: '/' });
}

/**
 * 图片路由的鉴权中间件。
 * 挂在 `/uploads/:userId/:filename` 上——依赖 params.userId 做归属校验。
 */
export function requireMediaAuth(req: Request, res: Response, next: NextFunction) {
  const token =
    readCookie(req.headers.cookie, MEDIA_COOKIE) || (typeof req.query.t === 'string' ? req.query.t : undefined);

  const auth = verifyMediaToken(token);
  if (!auth) {
    return res.status(401).json({ error: '未授权访问图片' });
  }

  // 关键：必须是自己目录下的文件，否则 B 能看 A 的图
  const owner = Number(req.params.userId ?? req.params.userId);
  if (Number.isFinite(owner) && owner !== auth.userId) {
    return res.status(403).json({ error: '无权访问该学生的图片' });
  }

  next();
}
