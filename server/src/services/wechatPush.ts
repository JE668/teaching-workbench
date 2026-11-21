const WECHAT_API_BASE = 'https://api.weixin.qq.com';
const DEFAULT_TIMEOUT_MS = 5000;
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

export interface ParentWechatPushInput {
  /** 家长在公众号内的 OpenID。 */
  recipientOpenId: string;
  /** 家长视图完整链接，或 /parent-view/:token 相对链接。 */
  parentUrl: string;
  studentName: string;
  /** 写入模板 keyword2 的简短学习摘要。 */
  summary: string;
}

export interface WechatPushOptions {
  /** 测试或特殊运行时可替换 fetch；默认使用 globalThis.fetch。 */
  fetchImpl?: typeof globalThis.fetch;
  /** token 与模板发送各自适用的超时，默认 5000ms。 */
  timeoutMs?: number;
  /** 默认读取 process.env；测试可传入隔离环境。 */
  env?: NodeJS.ProcessEnv;
  /** 默认 Date.now，用于测试 token 过期。 */
  now?: () => number;
}

export type WechatPushResult =
  | { status: 'sent'; messageId: number | null }
  | {
      status: 'skipped';
      reason: 'not_configured';
      missing: Array<'WECHAT_APP_ID' | 'WECHAT_APP_SECRET' | 'WECHAT_PARENT_TEMPLATE_ID'>;
    }
  | {
      status: 'failed';
      reason: 'invalid_input' | 'http_error' | 'wechat_error' | 'invalid_response' | 'timeout' | 'network_error';
      message: string;
      errcode?: number;
    };

interface ResolvedConfig {
  appId: string;
  appSecret: string;
  templateId: string;
  miniProgramAppId?: string;
  miniProgramPagePath?: string;
}

interface RequestContext {
  fetchImpl: typeof globalThis.fetch;
  timeoutMs: number;
  sensitiveValues: string[];
}

interface AccessTokenCacheEntry {
  appId: string;
  appSecret: string;
  accessToken: string;
  expiresAt: number;
}

let accessTokenCache: AccessTokenCacheEntry | null = null;

class WechatRequestError extends Error {
  constructor(
    public readonly reason: 'http_error' | 'wechat_error' | 'invalid_response' | 'timeout' | 'network_error',
    message: string,
    public readonly errcode?: number
  ) {
    super(message);
    this.name = 'WechatRequestError';
  }
}

/** 清空内存 token；凭据轮换及测试隔离时使用。 */
export function clearWechatAccessTokenCache(): void {
  accessTokenCache = null;
}

/**
 * 发送家长学习反馈公众号模板消息。
 * 网络、HTTP 和微信业务错误都转换为 failed，不阻断家长视图生成主流程。
 * 可选 WECHAT_MINIPROGRAM_APP_ID / WECHAT_MINIPROGRAM_PAGE_PATH 用于小程序跳转。
 */
export async function sendParentWechatPush(
  input: ParentWechatPushInput,
  options: WechatPushOptions = {}
): Promise<WechatPushResult> {
  const env = options.env ?? process.env;
  const config = resolveConfig(env);
  if (Array.isArray(config)) {
    return { status: 'skipped', reason: 'not_configured', missing: config };
  }

  const cleanInput = validateInput(input);
  if (typeof cleanInput === 'string') {
    return { status: 'failed', reason: 'invalid_input', message: cleanInput };
  }

  const context: RequestContext = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    timeoutMs: normalizeTimeout(options.timeoutMs),
    sensitiveValues: [config.appSecret],
  };
  const now = options.now ?? Date.now;

  try {
    const accessToken = await getAccessToken(config, context, now);
    context.sensitiveValues.push(accessToken);

    const payload: Record<string, unknown> = {
      touser: cleanInput.recipientOpenId,
      template_id: config.templateId,
      url: cleanInput.parentUrl,
      data: {
        first: { value: `${cleanInput.studentName}的学习反馈已生成` },
        keyword1: { value: cleanInput.studentName },
        keyword2: { value: cleanInput.summary },
        remark: { value: '点击查看详情，可与老师沟通学习情况。' },
      },
    };

    if (config.miniProgramAppId) {
      payload.miniprogram = {
        appid: config.miniProgramAppId,
        pagepath: buildMiniProgramPath(cleanInput.parentUrl, config.miniProgramPagePath),
      };
    }

    const response = await requestWechatJson(
      `${WECHAT_API_BASE}/cgi-bin/message/template/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      context
    );

    return {
      status: 'sent',
      messageId: typeof response.msgid === 'number' ? response.msgid : null,
    };
  } catch (error) {
    if (error instanceof WechatRequestError) {
      return {
        status: 'failed',
        reason: error.reason,
        message: error.message,
        ...(error.errcode === undefined ? {} : { errcode: error.errcode }),
      };
    }
    // 不回传原始异常：异常文本或堆栈可能带请求 URL（含 access_token）。
    return { status: 'failed', reason: 'network_error', message: '微信推送请求失败' };
  }
}

function resolveConfig(env: NodeJS.ProcessEnv): ResolvedConfig | Array<'WECHAT_APP_ID' | 'WECHAT_APP_SECRET' | 'WECHAT_PARENT_TEMPLATE_ID'> {
  const appId = env.WECHAT_APP_ID?.trim() || '';
  const appSecret = env.WECHAT_APP_SECRET?.trim() || '';
  const templateId = env.WECHAT_PARENT_TEMPLATE_ID?.trim() || '';
  const missing: Array<'WECHAT_APP_ID' | 'WECHAT_APP_SECRET' | 'WECHAT_PARENT_TEMPLATE_ID'> = [];
  if (!appId) missing.push('WECHAT_APP_ID');
  if (!appSecret) missing.push('WECHAT_APP_SECRET');
  if (!templateId) missing.push('WECHAT_PARENT_TEMPLATE_ID');
  if (missing.length > 0) return missing;

  return {
    appId,
    appSecret,
    templateId,
    miniProgramAppId: env.WECHAT_MINIPROGRAM_APP_ID?.trim() || undefined,
    miniProgramPagePath: env.WECHAT_MINIPROGRAM_PAGE_PATH?.trim() || undefined,
  };
}

function validateInput(input: ParentWechatPushInput): ParentWechatPushInput | string {
  const clean = {
    recipientOpenId: input.recipientOpenId?.trim() || '',
    parentUrl: input.parentUrl?.trim() || '',
    studentName: input.studentName?.trim() || '',
    summary: input.summary?.trim() || '',
  };
  if (!clean.recipientOpenId) return '缺少家长 OpenID';
  if (!clean.parentUrl) return '缺少家长视图链接';
  if (!clean.studentName) return '缺少学生姓名';
  if (!clean.summary) return '缺少学习摘要';
  try {
    // 相对链接也要支持；这里仅验证格式，不发起该 URL 的请求。
    new URL(clean.parentUrl, 'https://parent-view.local');
  } catch {
    return '家长视图链接格式无效';
  }
  return clean;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : DEFAULT_TIMEOUT_MS;
}

async function getAccessToken(
  config: ResolvedConfig,
  context: RequestContext,
  now: () => number
): Promise<string> {
  if (
    accessTokenCache &&
    accessTokenCache.appId === config.appId &&
    accessTokenCache.appSecret === config.appSecret &&
    accessTokenCache.expiresAt > now()
  ) {
    return accessTokenCache.accessToken;
  }

  const query = new URLSearchParams({
    grant_type: 'client_credential',
    appid: config.appId,
    secret: config.appSecret,
  });
  const response = await requestWechatJson(`${WECHAT_API_BASE}/cgi-bin/token?${query}`, { method: 'GET' }, context);
  if (typeof response.access_token !== 'string' || !response.access_token.trim()) {
    throw new WechatRequestError('invalid_response', '微信 access token 响应缺少 access_token');
  }

  const accessToken = response.access_token.trim();
  const expiresInSeconds = typeof response.expires_in === 'number' && response.expires_in > 0
    ? response.expires_in
    : 7200;
  accessTokenCache = {
    appId: config.appId,
    appSecret: config.appSecret,
    accessToken,
    // 提前 5 分钟过期；极短 token 至少保留 1 秒，避免负数有效期。
    expiresAt: now() + Math.max(expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS, 1000),
  };
  return accessToken;
}

async function requestWechatJson(
  url: string,
  init: RequestInit,
  context: RequestContext
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  let response: Response;
  try {
    response = await context.fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new WechatRequestError('timeout', `微信请求超时（${context.timeoutMs}ms）`);
    }
    throw new WechatRequestError('network_error', '微信接口网络请求失败');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new WechatRequestError('http_error', `微信接口 HTTP 错误（${response.status}）`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WechatRequestError('invalid_response', '微信接口返回了无效 JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new WechatRequestError('invalid_response', '微信接口返回格式无效');
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.errcode === 'number' && body.errcode !== 0) {
    const detail = redactSecrets(
      typeof body.errmsg === 'string' && body.errmsg.trim() ? body.errmsg.trim() : '未知微信错误',
      context.sensitiveValues
    );
    throw new WechatRequestError('wechat_error', `微信接口错误 ${body.errcode}：${detail}`, body.errcode);
  }
  return body;
}

function buildMiniProgramPath(parentUrl: string, configuredPath?: string): string {
  const url = new URL(parentUrl, 'https://parent-view.local');
  const match = /\/parent-view\/([^/]+)/.exec(url.pathname);
  const token = match?.[1] ? decodeURIComponent(match[1]) : '';
  const basePath = (configuredPath || 'pages/parent-view/parent-view').replace(/^\/+/, '');
  if (!token || /(?:^|[?&])token=/.test(basePath)) return basePath;
  return `${basePath}${basePath.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function redactSecrets(text: string, secrets: string[]): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[已隐藏]');
  }
  return safe.slice(0, 200);
}
