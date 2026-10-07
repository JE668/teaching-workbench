import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 轻量内存限流器（适用于单实例部署）。
 * 注意：进程重启后计数清零，多实例部署需改用 Redis 等共享存储。
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max, message = '操作过于频繁，请稍后再试' } = options;
  const buckets = new Map<string, Bucket>();

  // 定期清理过期桶，避免内存泄漏
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  cleaner.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    // 优先取反向代理传递的真实 IP
    const forwarded = (req.headers['x-forwarded-for'] as string) || '';
    const ip = forwarded.split(',')[0].trim() || req.ip || 'unknown';
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }

    bucket.count++;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message,
        retryAfter,
      });
    }

    next();
  };
}
