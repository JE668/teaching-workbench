import dns from 'dns/promises';
import net from 'net';

/**
 * 出站 URL 白名单校验（防 SSRF）。
 *
 * 背景：AI 的 baseUrl 由用户在设置页填写，服务端会用这个地址发请求
 * （GET {baseUrl}/models，以及把对话内容 POST 过去）。若只校验"以 http(s):// 开头"，
 * 任何登录用户都能把它指向内网服务、云主机元数据（169.254.169.254）、
 * 或本机未做鉴权的管理端口 —— 等于让服务端替攻击者发请求。
 *
 * 策略：
 *   - 只允许 http/https；
 *   - 不允许 URL 内嵌用户名密码（会进日志与审计）；
 *   - 回环 / 私网 / 链路本地 / 保留段一律拒绝；
 *   - 云元数据地址永远拒绝，即使显式允许了内网；
 *   - 生产环境默认禁私网；确需连内网自建网关（Ollama、自建代理）时
 *     显式设 AI_BASEURL_ALLOW_PRIVATE=1；
 *   - 开发/测试默认放行私网（单测与 E2E 的 mock 上游就在 127.0.0.1）。
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface OutboundUrlPolicy {
  allowPrivate?: boolean;
}

/** 无论怎么配置都必须拒绝的主机名（云元数据 / 实例信息服务的常见别名） */
const ALWAYS_BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'instance-data',
  'metadata.google.internal',
  'metadata.goog',
]);

/** 内网/保留 IPv4 网段（cidr 前缀位数） */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** 永远拒绝的地址（云元数据服务） */
const ALWAYS_BLOCKED_V4 = new Set(['169.254.169.254', '100.100.100.200', '0.0.0.0']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/** IPv4 字面量是否属于不该被服务端主动访问的地址 */
export function isBlockedIPv4(ip: string): boolean {
  if (ALWAYS_BLOCKED_V4.has(ip)) return true;
  return BLOCKED_V4.some(([base, bits]) => inCidr(ip, base, bits));
}

/** IPv6 字面量是否属于不该被服务端主动访问的地址 */
export function isBlockedIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');

  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isBlockedIPv4(mapped[1]);

  const nat64 = /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (nat64) return isBlockedIPv4(nat64[1]);

  if (v === '::' || v === '::1') return true;
  if (/^fe[89ab]/.test(v)) return true; // fe80::/10 链路本地
  if (/^f[cd]/.test(v)) return true; // fc00::/7 唯一本地
  if (v.startsWith('ff')) return true; // ff00::/8 组播
  if (v.startsWith('2001:db8:')) return true; // 文档示例
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (ALWAYS_BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  return false;
}

/** 生产默认不放行私网；开发/测试放行（mock 上游在 127.0.0.1） */
export function allowPrivateOutbound(): boolean {
  const flag = String(process.env.AI_BASEURL_ALLOW_PRIVATE || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return (process.env.NODE_ENV || 'development') !== 'production';
}

function allowPrivate(opts?: OutboundUrlPolicy): boolean {
  return opts?.allowPrivate ?? allowPrivateOutbound();
}

/** 校验 URL 形状（不解析 DNS），返回解析后的 URL */
export function assertSafeUrlShape(raw: string, opts?: OutboundUrlPolicy): URL {
  const allow = allowPrivate(opts);
  const text = String(raw || '').trim();
  if (!text) throw new UnsafeUrlError('接口地址不能为空');

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UnsafeUrlError('接口地址格式不正确，请填写完整地址（如 https://api.example.com/v1）');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('接口地址只支持 http(s)://，不能使用 file://、ftp:// 等协议');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('接口地址不能包含用户名或密码');
  }
  if (!url.hostname) throw new UnsafeUrlError('接口地址缺少主机名');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) {
    throw new UnsafeUrlError('不允许把接口地址指向本机或内网主机');
  }

  if (net.isIPv4(host)) {
    if (ALWAYS_BLOCKED_V4.has(host)) throw new UnsafeUrlError('该地址是云主机元数据服务，禁止访问');
    if (!allow && isBlockedIPv4(host)) {
      throw new UnsafeUrlError('不允许把接口地址指向内网/回环地址（如需连内网自建网关，请设置 AI_BASEURL_ALLOW_PRIVATE=1）');
    }
  } else if (net.isIPv6(host)) {
    if (!allow && isBlockedIPv6(host)) {
      throw new UnsafeUrlError('不允许把接口地址指向内网/回环地址');
    }
  }

  return url;
}

/** 同步校验：只看字面量与主机名，不做 DNS。用于同步构造 SDK 客户端时兜底存量脏数据。 */
export function assertSafeOutboundUrlSync(raw: string, opts?: OutboundUrlPolicy): URL {
  return assertSafeUrlShape(raw, opts);
}

/** 完整校验：形状 + DNS 解析出的每个地址都合法。用于用户提交与真正发起请求的入口。 */
export async function assertSafeOutboundUrl(raw: string, opts?: OutboundUrlPolicy): Promise<URL> {
  const allow = allowPrivate(opts);
  const url = assertSafeUrlShape(raw, opts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIPv4(host) || net.isIPv6(host)) return url;

  // 已明确放行私网（开发/测试/自建网关）时不再解析：
  // 自建网关常用内网域名，解析失败只会误伤正常配置。
  if (allow) return url;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError('无法解析该域名，请检查地址是否正确');
  }
  if (!addresses.length) throw new UnsafeUrlError('无法解析该域名，请检查地址是否正确');

  for (const { address } of addresses) {
    if (net.isIPv4(address)) {
      if (ALWAYS_BLOCKED_V4.has(address)) throw new UnsafeUrlError('该地址是云主机元数据服务，禁止访问');
      if (!allow && isBlockedIPv4(address)) {
        throw new UnsafeUrlError('该域名解析到内网/回环地址，已拒绝（如需连内网自建网关，请设置 AI_BASEURL_ALLOW_PRIVATE=1）');
      }
    } else if (net.isIPv6(address) && !allow && isBlockedIPv6(address)) {
      throw new UnsafeUrlError('该域名解析到内网/回环地址，已拒绝');
    }
  }
  return url;
}
