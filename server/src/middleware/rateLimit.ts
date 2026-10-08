import { Request, Response, NextFunction } from 'express';

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
    // 优先取反向代理传递的真实 IP
    const forwarded = (req.headers['x-forwarded-for'] as string) || '';
    return forwarded.split(',')[0].trim() || req.ip || 'unknown';
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
