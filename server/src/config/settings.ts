import { db } from './database.js';
import { env } from './env.js';

/**
 * 应用级设置。
 *
 * 优先级：数据库中的值 > .env > 内置默认。
 * 这样 .env 仍是"出厂配置"，而老师可以在前端设置页随时改，
 * 改完立即生效，不必改 .env 再重启容器。
 */

/** 各设置的兜底来源（.env / 内置默认） */
const FALLBACK: Record<string, () => string> = {
  // AI 服务商：sensenova（默认，键沿用 ai.model/baseUrl/apiKey）| gemini-proxy（自建 Gemini 转发代理）
  'ai.provider': () => 'sensenova',
  'ai.model': () => env.SENSENOVA_MODEL,
  'ai.baseUrl': () => env.SENSENOVA_BASE_URL,
  'ai.apiKey': () => env.SENSENOVA_API_KEY,
  // gemini-proxy 的专属配置（model / baseUrl / apiKey 各自独立，切换服务商互不覆盖）
  'ai.geminiProxy.model': () => env.GEMINI_PROXY_MODEL,
  'ai.geminiProxy.baseUrl': () => env.GEMINI_PROXY_BASE_URL,
  'ai.geminiProxy.apiKey': () => env.GEMINI_PROXY_API_KEY,
  'ai.reasoningEffort': () => env.SENSENOVA_REASONING_EFFORT,
  'ai.timeoutMs': () => String(env.SENSENOVA_TIMEOUT_MS),
  // 回访 prompt 的风格补充。留空 = 用内置默认语气，不追加任何内容。
  'ai.prompt.style': () => '',
};

/** 前端不允许写入的键（防止写入任意内容） */
const WRITABLE = Object.keys(FALLBACK);

export const SETTING_KEYS = WRITABLE;

function readRaw(key: string, userId: number): string | null {
  try {
    const row = db
      .prepare('SELECT value FROM settings_user WHERE user_id = ? AND key = ?')
      .get(userId, key) as any;
    return row ? String(row.value) : null;
  } catch {
    return null; // 表还没建好等情况：退回默认值
  }
}

/**
 * 读取某个账号的设置。userId 缺省时只走 .env / 内置兜底（给 buildPrompt
 * 这类无请求上下文的纯函数复用，同时保证单测不需要数据库）。
 */
export function getSetting(key: string, userId?: number): string {
  const stored = userId != null ? readRaw(key, userId) : null;
  if (stored !== null && stored !== '') return stored;
  return FALLBACK[key]?.() ?? '';
}

export function getAllSettings(userId: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WRITABLE) out[key] = getSetting(key, userId);
  return out;
}

/**
 * 只返回 .env / 内置兜底，不含数据库覆盖。
 *
 * 前端拿它做一件事：判断表单里某个值究竟是「用户自己改过的」还是「只是 .env 的出厂值
 * 被回显上来」。不做这个区分，一次"没改任何东西只点保存"就会把所有出厂值写成覆盖，
 * 从此 .env 怎么改、切服务商怎么切，界面上都还是那份冻结的旧值。
 *
 * 密钥同样只给掩码，不落明文。
 */
export function getFallbackDefaults(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of WRITABLE) {
    const value = FALLBACK[key]?.() ?? '';
    out[key] = key.includes('.apiKey') ? maskSecret(value) : value;
  }
  return out;
}

/** 只返回上一层的显式覆盖值（用于前端回显"是否被自定义过"） */
export function getOverrides(userId: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WRITABLE) {
    const stored = readRaw(key, userId);
    if (stored !== null && stored !== '') out[key] = stored;
  }
  return out;
}

export function setSetting(key: string, value: string, userId: number): void {
  if (!WRITABLE.includes(key)) {
    throw new Error('不支持的设置项: ' + key);
  }

  if (value === '' || value === (FALLBACK[key]?.() ?? '')) {
    // 空值、或「与出厂值完全相同」都清除覆盖：留一份和 .env 一模一样的覆盖没有任何
    // 意义，只会把 .env 冻结住 —— 之后 .env 怎么改、切服务商怎么切，界面上追不上。
    // 这也是前端"没改任何东西却点保存"的后端兜底，两侧都不用互相信任。
    db.prepare('DELETE FROM settings_user WHERE user_id = ? AND key = ?').run(userId, key);
    return;
  }

  db.prepare(
    `INSERT INTO settings_user (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now','+8 hours'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(userId, key, value);
}

export function setSettings(patch: Record<string, string>, userId: number): void {
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) setSetting(k, v, userId);
  });
  tx(Object.entries(patch));
}

// ============ AI 配置快照 ============

export interface AiConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  reasoningEffort: string;
  timeoutMs: number;
}

/** 配置版本号（按账号分桶）：变化时让该账号缓存的 AI 客户端失效 */
const configVersions = new Map<number, number>();
export function getConfigVersion(userId: number): number {
  return configVersions.get(userId) || 0;
}

export function getAiConfig(userId: number): AiConfig {
  const provider = getSetting('ai.provider', userId) || 'sensenova';
  const shared = {
    provider,
    reasoningEffort: getSetting('ai.reasoningEffort', userId) || 'low',
    timeoutMs: Math.max(5000, parseInt(getSetting('ai.timeoutMs', userId), 10) || 60000),
  };
  if (provider === 'gemini-proxy') {
    return {
      ...shared,
      model: getSetting('ai.geminiProxy.model', userId),
      baseUrl: getSetting('ai.geminiProxy.baseUrl', userId),
      apiKey: getSetting('ai.geminiProxy.apiKey', userId),
    };
  }
  return {
    ...shared,
    model: getSetting('ai.model', userId),
    baseUrl: getSetting('ai.baseUrl', userId) || 'https://token.sensenova.cn/v1',
    apiKey: getSetting('ai.apiKey', userId),
  };
}

/** 写入后调用，让该账号的 AI 客户端按新配置重建 */
export function bumpConfigVersion(userId: number): void {
  configVersions.set(userId, (configVersions.get(userId) || 0) + 1);
}

/** 密钥脱敏：只留末 4 位，避免接口把完整 key 回传给前端 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return '••••••••' + value.slice(-4);
}
