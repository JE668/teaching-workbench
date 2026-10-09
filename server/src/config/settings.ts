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
  'ai.model': () => env.SENSENOVA_MODEL,
  'ai.baseUrl': () => env.SENSENOVA_BASE_URL,
  'ai.apiKey': () => env.SENSENOVA_API_KEY,
  'ai.reasoningEffort': () => env.SENSENOVA_REASONING_EFFORT,
  'ai.timeoutMs': () => String(env.SENSENOVA_TIMEOUT_MS),
};

/** 前端不允许写入的键（防止写入任意内容） */
const WRITABLE = Object.keys(FALLBACK);

export const SETTING_KEYS = WRITABLE;

function readRaw(key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row ? String(row.value) : null;
  } catch {
    return null; // 表还没建好等情况：退回默认值
  }
}

export function getSetting(key: string): string {
  const stored = readRaw(key);
  if (stored !== null && stored !== '') return stored;
  return FALLBACK[key]?.() ?? '';
}

export function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WRITABLE) out[key] = getSetting(key);
  return out;
}

/** 只返回上一层的显式覆盖值（用于前端回显"是否被自定义过"） */
export function getOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WRITABLE) {
    const stored = readRaw(key);
    if (stored !== null && stored !== '') out[key] = stored;
  }
  return out;
}

export function setSetting(key: string, value: string): void {
  if (!WRITABLE.includes(key)) {
    throw new Error('不支持的设置项: ' + key);
  }

  if (value === '') {
    // 空值 = 清除覆盖，回落到 .env
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }

  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value);
}

export function setSettings(patch: Record<string, string>): void {
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) setSetting(k, v);
  });
  tx(Object.entries(patch));
}

// ============ AI 配置快照 ============

export interface AiConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  reasoningEffort: string;
  timeoutMs: number;
}

/** 配置版本号：变化时用于让缓存的 AI 客户端失效 */
let configVersion = 0;
export function getConfigVersion(): number {
  return configVersion;
}

export function getAiConfig(): AiConfig {
  return {
    model: getSetting('ai.model'),
    baseUrl: getSetting('ai.baseUrl') || 'https://token.sensenova.cn/v1',
    apiKey: getSetting('ai.apiKey'),
    reasoningEffort: getSetting('ai.reasoningEffort') || 'low',
    timeoutMs: Math.max(5000, parseInt(getSetting('ai.timeoutMs'), 10) || 60000),
  };
}

/** 写入后调用，让 AI 客户端按新配置重建 */
export function bumpConfigVersion(): void {
  configVersion++;
}

/** 密钥脱敏：只留末 4 位，避免接口把完整 key 回传给前端 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return '••••••••' + value.slice(-4);
}
