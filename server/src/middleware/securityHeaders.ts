import type { NextFunction, Request, Response } from 'express';

/**
 * 后端安全响应头。
 *
 * 前端 nginx 已经给页面下发了成套安全头，但那只覆盖「前端域名 + 静态文件」。
 * /api 与 /uploads 由 Express 直接应答（生产下经 nginx 反代），此前完全没有
 * 安全头 —— 风险不仅是噪音：
 *  - 浏览器会把 JSON 响应按内容嗅探成 HTML，一旦接口回显了用户文本，
 *    就可能被当成页面渲染（nosniff 是唯一可靠的关闭方式）；
 *  - 缺少 Referrer-Policy 时，带 URL 的请求可能把内部路径泄露给外部站点；
 *  - 老浏览器仍可能容忍 frame 嵌套，给点击劫持留口子。
 * 这里不引入 helmet：规则就这几条，手写没有中间件依赖，行为也更可控。
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // 明确告诉浏览器「按声明的 Content-Type 处理，不要猜」。
  // 对图片接口尤其重要：用户上传的 SVG/HTML 若被嗅探成页面，就是存储型 XSS。
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 接口与图片都不该被任何页面嵌套；前端页面自己由 nginx 下发 SAMEORIGIN。
  res.setHeader('X-Frame-Options', 'DENY');
  // 不外泄 Referer：接口 URL 里带有资源 id、查询参数等内部信息。
  res.setHeader('Referrer-Policy', 'no-referrer');
  // 接口不会用到这些能力，直接全禁，避免被注入脚本后调用。
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  const isApi = req.path.startsWith('/api');
  if (isApi) {
    // 接口响应里全是业务数据（学生姓名、听评课记录），绝不能进浏览器缓存
    // 或中间代理缓存 —— 退出登录后按后退键还能看到别人数据的经典来源。
    res.setHeader('Cache-Control', 'no-store');
    // JSON 接口的 CSP：不需要加载任何资源，也不允许被嵌入。
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }

  // 只有确认走了 HTTPS 才发 HSTS：在 HTTP 环境下发 HSTS 会把用户锁死在
  // 无法访问的状态（浏览器后续强制 https，而服务端只有 http）。
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (req.secure || proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
