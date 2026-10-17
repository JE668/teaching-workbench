import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';

/**
 * 请求体校验中间件工厂。
 *
 * 用法：
 *   router.post('/', validateBody(studentCreateSchema), handler);
 *
 * 成功：用「校验 + 清洗后」的值替换 req.body，后续 handler 拿到的是安全值。
 * 失败：返回 400，error 字段取第一条 issue 的中文信息（保持现有 API 契约）。
 *
 * 注意：schema 一律用 .passthrough()，避免误删 handler 依赖的额外字段。
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const message = (result.error as ZodError).issues[0]?.message || '参数错误';
      return res.status(400).json({ error: message });
    }
    req.body = result.data;
    next();
  };
}
