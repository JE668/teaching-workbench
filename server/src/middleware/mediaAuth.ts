import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { db } from '../config/database.js';

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
// 缩短到 24h：7 天的图片访问权在用户改密后仍能继续用，等于改密吊销对图片失效。
// 24h 是可用性折中：<img> 在会话中会自动续期，但被盗 cookie 的存活窗口显著收窄。
export const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

/** 生成无状态令牌："<userId>.<expiry>.<tva>.<hmac>"
 *  tva = token_valid_after（秒级 Unix 时间戳，与 JWT 改密吊销共享同一来源）。
 *  用户改密时 tva 会前进，旧 media cookie 在下次访问时立即失效 —— 与 JWT 吊销同频。 */
export function createMediaToken(userId: number, tvaSeconds: number = 0): string {
  const payload = [userId, Date.now() + MEDIA_TTL_MS, tvaSeconds].join('.');
  return payload + '.' + sign(payload);
}

/** 校验令牌，返回归属用户；非法/过期/被改密吊销返回 null */
export function verifyMediaToken(token: string | undefined | null): { userId: number } | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [uidStr, expStr, tvaStr, sig] = parts;
  const payload = uidStr + '.' + expStr + '.' + tvaStr;

  // 定长比较，避免时序侧信道
  const provided = Buffer.from(sig);
  const expected = Buffer.from(sign(payload));
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  const expiry = Number(expStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  const userId = Number(uidStr);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  // 改密吊销：库里存的 tva 比 cookie 里签发时更新，说明改密后旧 cookie 不再合法。
  // tva 为 0 表示该账号从未改密（默认值），不触发吊销。
  const issuedTva = Number(tvaStr);
  const row = db.prepare('SELECT token_valid_after AS tva FROM users WHERE id = ?').get(userId) as { tva: number } | undefined;
  const currentTva = row?.tva || 0;
  if (Number.isFinite(issuedTva) && currentTva > issuedTva) return null;

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

/** 下发图片访问 cookie（httpOnly，同源自动携带，无需前端改造）。
 *  签发时把当前 token_valid_after 一并写进 payload，改密后旧 cookie 立即失效。 */
export function setMediaCookie(req: Request, res: Response, userId: number): void {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const row = db.prepare('SELECT token_valid_after AS tva FROM users WHERE id = ?').get(userId) as { tva: number } | undefined;
  res.cookie(MEDIA_COOKIE, createMediaToken(userId, row?.tva || 0), {
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
 *
 * 只认 httpOnly cookie，不接受 `?t=` 查询参数：
 * URL 里的令牌会落进访问日志、浏览器历史与分享链接（等于把 7 天图片访问权
 * 泄给出现在 URL 旁的任何人）。同源 <img> 会自动带 cookie，无需查询参数；
 * 历史上支持 ?t= 时前端也从未使用过。
 */
export function requireMediaAuth(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req.headers.cookie, MEDIA_COOKIE);

  const auth = verifyMediaToken(token);
  if (!auth) {
    return res.status(401).json({ error: '未授权访问图片' });
  }

  // 关键：必须是自己目录下的文件，否则 B 能看 A 的图。
  // 目录名可能是【数字 ID】（历史路径）或【账户名】（新路径），两者都要校验。
  // 注意不能只写 Number(owner)：账户名（如 "admin"）会得到 NaN，
  // Number.isFinite 为 false 会把校验整个跳过 —— 等于对用户名目录不设防。
  const owner = String(req.params.owner ?? req.params.userId ?? '');
  const me = db.prepare('SELECT username FROM users WHERE id = ?').get(auth.userId) as { username: string } | undefined;
  const myUsername = me ? String(me.username || '') : '';

  const allowed =
    owner === String(auth.userId) || (myUsername !== '' && owner === myUsername);

  if (!allowed) {
    return res.status(403).json({ error: '无权访问该学生的图片' });
  }

  next();
}
