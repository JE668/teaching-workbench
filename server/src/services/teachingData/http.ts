import { REQUEST_TIMEOUT_MS, ALLOWED_HOSTS, SSO_BASE, TEACHING_CALLBACK } from './constants.js';
import { TokenInvalidError } from './errors.js';

export interface CookieJar {
  header(): string;
  capture(response: Response): void;
}

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    header: () => [...cookies].map(([name, value]) => name + '=' + value).join('; '),
    capture(response) {
      const headers = response.headers as Headers & { getSetCookie?: () => string[] };
      const lines = headers.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);
      for (const line of lines) {
        const pair = line.split(';', 1)[0];
        const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

export function assertAllowedUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw new Error('Invalid upstream URL');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Disallowed upstream URL');
  }
  return url;
}

function safeLocation(current: URL, location: string | null): URL {
  if (!location) throw new Error('Redirect without location');
  try {
    return assertAllowedUrl(new URL(location, current));
  } catch {
    throw new Error('Disallowed redirect');
  }
}

export interface ExternalRequest {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  token?: string;
  jar?: CookieJar;
  signal?: AbortSignal;
}

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

/** 不自动跟随重定向，因此浏览器 fetch 不会替我们把请求送到未校验 host。 */
export async function externalRequest(url: URL | string, options: ExternalRequest = {}): Promise<Response> {
  const target = assertAllowedUrl(url);
  const timeout = withTimeout(options.signal);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'Mozilla/5.0 (compatible; TeachingWorkbench/1.0)',
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers['access-token'] = options.token;
  const cookie = options.jar?.header();
  if (cookie) headers.cookie = cookie;
  if (target.origin === SSO_BASE) headers.referer = SSO_BASE + '/';
  try {
    const response = await fetch(target, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
      signal: timeout.signal,
    });
    options.jar?.capture(response);
    // mock/自定义 fetch 也应遵守同一 URL 约束；正常 Response.url 为空时以请求 URL 为准。
    if (response.url) assertAllowedUrl(response.url);
    return response;
  } finally {
    timeout.cancel();
  }
}

export function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

export async function parseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object expected');
    return value as Record<string, unknown>;
  } catch {
    throw new Error('Malformed upstream response');
  }
}

export function isAuthenticate(url: URL): boolean {
  return url.origin === SSO_BASE && url.pathname === '/index/user/authenticate';
}

/** 跟踪 SSO OAuth 链路；authenticate 先进入 2FA，成功则解析最终 URL 的 code。 */
export async function followForCode(jar: CookieJar, initial: string | URL): Promise<{ kind: 'code'; code: string } | { kind: 'twoStep' }> {
  let current = assertAllowedUrl(initial);
  for (let redirects = 0; redirects <= 6; redirects += 1) {
    const response = await externalRequest(current, { jar });
    if (isRedirect(response)) {
      const next = safeLocation(current, response.headers.get('location'));
      if (isAuthenticate(next)) return { kind: 'twoStep' };
      current = next;
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new TokenInvalidError();
      throw new Error('SSO code exchange failed');
    }
    const code = current.searchParams.get('code');
    if (code) return { kind: 'code', code };
    throw new Error('SSO response has no code');
  }
  throw new Error('Too many redirects');
}

export async function exchangeTeachingCode(jar: CookieJar, code: string): Promise<string> {
  let current = assertAllowedUrl(TEACHING_CALLBACK);
  current.searchParams.set('code', code);
  for (let redirects = 0; redirects <= 6; redirects += 1) {
    const response = await externalRequest(current, { jar });
    if (isRedirect(response)) {
      current = safeLocation(current, response.headers.get('location'));
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new TokenInvalidError();
    if (!response.ok) throw new Error('Teaching callback failed');
    const body = await parseObject(response);
    const data = body.data;
    const token = data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)['access-token']
      : undefined;
    if (typeof token !== 'string' || !token) throw new TokenInvalidError();
    return token;
  }
  throw new Error('Too many redirects');
}
