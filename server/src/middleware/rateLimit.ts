import { Request, Response, NextFunction } from 'express';

/** 是否信任 X-Real-IP / X-Forwarded-For 代理头（默认开启，标准 nginx 反代部署用）。
 *  服务不经反代直暴（开发/裸端口部署）时设 TRUST_PROXY_HEADERS=0：
 *  此时任何客户端都能伪造这些头，每个请求换一个值即可无限绕过登录限流。 */
const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS !== '0';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  /**
   * 仅统计失败请求（4xx/5xx）。
   * 用于登录场景：只有猜错密码才消耗额度，
   * 避免正常用户在网络抖动下重试登录被误锁。
   */
  countOnlyFailures?: boolean;
}

/**
 * 轻量内存限流器（适用于单实例部署）。
 * 注意：进程重启后计数清零，多实例部署需改用 Redis 等共享存储。
 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, message = '操作过于频繁，请稍后再试', countOnlyFailures = false } = options;
  const buckets = new Map<string, Bucket>();

  // 定期清理过期桶，避免内存泄漏
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  cleaner.unref?.();

  const clientIp = (req: Request): string => {
    // 取「距离后端最近的可信反代」写入的真实客户端 IP。
    //
    // 部署链：浏览器 → Lucky → nginx($proxy_add_x_forwarded_for) → 本服务。
    // nginx 的 $proxy_add_x_forwarded_for 是【追加】：XFF 链第一段是客户端
    // 自己填的、完全不可信（攻击者每个请求带一个随机 XFF 即可伪造无限个
    // 限流桶，让爆破限制形同虚设）——真实 IP 在链的【最后一段】。
    //
    // 优先级（仅在 TRUST_PROXY_HEADERS 开启时才读代理头）：
    //   1) X-Real-IP：nginx.conf 已显式设置（$remote_addr，反代直连客户端），
    //      单一值、无伪造面，最可靠；
    //   2) XFF 最后一段：链上最靠近 nginx 的一跳，多层代理时最准；
    //      【不能取第一段】；
    //   3) TCP 对端地址兜底：反代头不可信/未开启时用 req.socket.remoteAddress ——
    //      这是连接真正来自的地址，无法伪造。不用 req.ip：未设 trust proxy 时
    //      Express 会回退到 socket 地址（等价），但显式用 socket 更直观。
    if (TRUST_PROXY_HEADERS) {
      const realIp = (req.headers['x-real-ip'] as string) || '';
      if (realIp.trim()) return realIp.trim();
      const forwarded = (req.headers['x-forwarded-for'] as string) || '';
      const lastHop = forwarded.split(',').pop()?.trim() || '';
      if (lastHop) return lastHop;
    }
    return req.socket.remoteAddress || req.ip || 'unknown';
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    if (countOnlyFailures) {
      // 响应结束后再决定是否计数：只有失败才消耗额度
      res.on('finish', () => {
        if (res.statusCode >= 400) bucket!.count++;
      });
    } else {
      bucket.count++;
    }

    next();
  };
}
