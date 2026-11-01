import OpenAI from 'openai';
import { getAiConfig, getConfigVersion, AiConfig } from '../../config/settings.js';
import { log } from '../../utils/logger.js';

// ============ SenseNova 客户端（OpenAI 兼容） ============
// 配置可在前端设置页修改，因此客户端要能按版本号重建，
// 否则改了模型/密钥还得重启容器才生效。
// per-user 客户端缓存：每个账号一份设置，各用各的模型与密钥
const clients = new Map<number, { client: OpenAI; version: number }>();

export function getClient(userId: number, config: AiConfig): OpenAI {
  const cached = clients.get(userId);
  if (!cached || cached.version !== getConfigVersion(userId)) {
    if (!config.apiKey) {
      const keyName = config.provider === 'gemini-proxy' ? 'GEMINI_PROXY_API_KEY' : 'SENSENOVA_API_KEY';
      throw new Error(`未配置 ${keyName}，请在「设置」页或 .env 中填写`);
    }
    // gemini-proxy 层已实现重试/降级，这里关闭 SDK 重试避免双重重试导致延迟叠加
    const sdkRetries = config.provider === 'gemini-proxy' ? 0 : 1;
    const entry = {
      client: new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        maxRetries: sdkRetries,
      }),
      version: getConfigVersion(userId),
    };
    clients.set(userId, entry);
  }
  return clients.get(userId)!.client;
}

/**
 * 取当前配置的共享客户端（供回访之外的其它 AI 能力复用，如听评课）。
 * 与 followup 走同一个模型/密钥/超时，无需各自维护。
 */
export function getSharedClient(userId: number): OpenAI {
  return getClient(userId, getAiConfig(userId));
}