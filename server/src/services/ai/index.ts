import { getAiConfig, AiConfig } from '../../config/settings.js';
import { getClient, getSharedClient } from './client.js';
import { buildPrompt, FollowUpGenerateParams } from './prompt.js';
import { getOcrText } from '../ocr.js';
import { imageToBase64DataUrl, countWords } from './utils.js';
import { recordAiMetrics } from '../aiMetrics.js';
import { log } from '../../utils/logger.js';
import { env } from '../../config/env.js';

// Re-export getAiConfig for use by other services (e.g., reportAi.ts)
export { getAiConfig };

// ============ 并发闸门 ============
// 老师连点两次「生成」，或两个学生在两个标签页同时生成，就是两个请求一起打出去：
// 双倍计费，而且两份结果会互相覆盖（后返回的把先返回的冲掉）。
// 早期是整站共用一个全局计数（MAX_CONCURRENT_AI=2）：多用户一起用时，后台批量任务
// （目录星级判定会连发几十批）会把槽位长期占满，别人正常的回访/听评课只能排队，
// 最后一起撞上 2 分钟排队超时 —— 一个人卡住全站 AI 不可用。
// 现在按用户分桶：每个用户各自限并发，互不饿死；全局再留一个更高的保护上限，
// 防止多用户叠加把上游供应商的配额打爆。
/** 单个用户同时最多几个 AI 请求 */
export const MAX_CONCURRENT_AI = 2;
/** 全站同时最多几个（多用户叠加时的保护上限，防上游限流/爆预算） */
export const MAX_CONCURRENT_AI_GLOBAL = 8;

/** 没有登录用户上下文的调用（启动时的后台任务、单测）统一算进这个桶 */
const UNBOUND_AI_USER = 0;

interface AiWaiter {
  userId: number;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let aiInFlight = 0;
/** userId -> 该用户正在跑的 AI 请求数（归零即删键，不会无限增长） */
const aiInFlightByUser = new Map<number, number>();
const aiWaiters: AiWaiter[] = [];

/** 排队上限：超过就快速失败，而不是无限挂在某个卡死的生成上 */
export const AI_QUEUE_TIMEOUT_MS = 120_000;

export class AiQueueTimeoutError extends Error {
  constructor() {
    super('AI 排队等待超过 2 分钟，前序生成可能已卡住，请稍后重试。');
    this.name = 'AiQueueTimeoutError';
  }
}

/** OpenAI 流式 chunk 的最小结构（SDK Stream 泛型收窄用） */
interface ChatStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

/** 归一化用户标识：未登录/非法值都落到匿名桶，绝不因为缺 userId 就跳过限流 */
function bucketOf(userId?: number | null): number {
  return typeof userId === 'number' && Number.isFinite(userId) && userId > 0 ? userId : UNBOUND_AI_USER;
}

function inFlightOf(userId: number): number {
  return aiInFlightByUser.get(userId) ?? 0;
}

/** 该用户是否还有余量（同时受用户上限和全局上限约束） */
function hasRoom(userId: number): boolean {
  return inFlightOf(userId) < MAX_CONCURRENT_AI && aiInFlight < MAX_CONCURRENT_AI_GLOBAL;
}

/** 唤醒队首中「自己的桶与全局都还有余量」的第一个等待者 */
function wakeNextWaiter(): void {
  const idx = aiWaiters.findIndex((w) => hasRoom(w.userId));
  if (idx < 0) return;
  const [next] = aiWaiters.splice(idx, 1);
  clearTimeout(next.timer);
  next.resolve();
}

/**
 * 占用一个 AI 并发槽。
 * @param timeoutMs 排队上限，超时抛 AiQueueTimeoutError（首位参数保持旧签名，老调用不受影响）
 * @param userId 按用户分桶的键；不传算匿名桶
 */
export async function acquireAiSlot(
  timeoutMs: number = AI_QUEUE_TIMEOUT_MS,
  userId?: number | null
): Promise<void> {
  const bucket = bucketOf(userId);
  // 用循环而不是单次判断：被唤醒时可能刚好被同桶的其他人抢先，重新排队即可
  while (!hasRoom(bucket)) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const k = aiWaiters.findIndex((w) => w.timer === timer);
        if (k >= 0) aiWaiters.splice(k, 1);
        reject(new AiQueueTimeoutError());
      }, timeoutMs);
      aiWaiters.push({ userId: bucket, resolve, reject, timer });
    });
  }
  aiInFlight++;
  aiInFlightByUser.set(bucket, inFlightOf(bucket) + 1);
}

/** 释放一个 AI 并发槽（必须传与 acquireAiSlot 相同的 userId，否则桶会对不上） */
export function releaseAiSlot(userId?: number | null): void {
  const bucket = bucketOf(userId);
  aiInFlight = Math.max(0, aiInFlight - 1);
  const left = inFlightOf(bucket) - 1;
  if (left > 0) aiInFlightByUser.set(bucket, left);
  else aiInFlightByUser.delete(bucket);
  wakeNextWaiter();
}

/** 把一次 AI 调用放进并发闸门（fn 里若还要拿 userId，注意别把桶传错） */
export async function withAiSlot<T>(fn: () => Promise<T>, userId?: number | null): Promise<T> {
  await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, userId);
  try {
    return await fn();
  } finally {
    releaseAiSlot(userId);
  }
}

/** 按用户分桶的闸门包装：AI 入口一律用这个，别用无 userId 的 withAiSlot */
export async function withUserAiSlot<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  return withAiSlot(fn, userId);
}

/** 当前正在跑的 AI 请求数：不传 userId 返回全站总数（仅供测试断言） */
export function getAiInFlightCount(userId?: number | null): number {
  return userId === undefined || userId === null ? aiInFlight : inFlightOf(bucketOf(userId));
}

/** 重置闸门计数（仅供测试） */
export function resetAiGate(): void {
  aiInFlight = 0;
  aiInFlightByUser.clear();
  for (const w of aiWaiters) clearTimeout(w.timer);
  aiWaiters.length = 0;
}

// ============ 流式空闲中断 ============
// SDK 的 timeout 只覆盖连接/首响应；流式生成中途上游挂住（不发 chunk 也不关连接）
// 时，for await 循环会永久挂起，把并发闸门的槽永久占死（finally 只在循环退出时
// 执行，而循环永不退出）—— 后续所有 AI 请求排队到熔断，单实例下拖垮全部 AI 能力。
// 这里用 AbortController + 「相邻 chunk 最大间隔」定时器：每收到一个 chunk 就复位，
// 空闲超过阈值就 abort，循环随即抛错、finally 释放槽。正在正常产出的慢生成不受影响。
export class AiStreamIdleError extends Error {
  constructor() {
    super('AI 流式生成中断：超过 ' + Math.round(env.AI_STREAM_IDLE_TIMEOUT_MS / 1000) + ' 秒没有收到新内容，已中止本次生成。请重试。');
    this.name = 'AiStreamIdleError';
  }
}

interface StreamWatchdog {
  signal: AbortSignal;
  /** 每收到一个 chunk 调用，复位空闲定时器 */
  kick(): void;
  /** 流结束/出错后调用，清理定时器 */
  done(): void;
}

export function startStreamWatchdog(): StreamWatchdog {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new AiStreamIdleError()), env.AI_STREAM_IDLE_TIMEOUT_MS);
    timer.unref?.();
  };
  arm();
  return {
    signal: controller.signal,
    kick: arm,
    done: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// ============ 请求构建 ============

/** 组装 user 消息内容块：提示词 + 图片（Base64 Data URL） + OCR 文本 */
async function buildUserContent(
  params: FollowUpGenerateParams,
  correction?: string,
  userId?: number
): Promise<any[]> {
  const userContent: any[] = [{ type: 'text', text: buildPrompt(params, correction, userId) }];

  // OCR 文本：若上传了图片，读取已识别的文本作为额外上下文
  if (userId && params.images.length > 0) {
    const ocrMap = getOcrText(userId, params.images);
    const ocrLines = Object.entries(ocrMap)
      .filter(([, text]) => text.trim())
      .map(([path, text]) => `--- 图片 ${path} OCR 文本 ---\n${text}\n`);
    if (ocrLines.length > 0) {
      userContent.push({
        type: 'text',
        text:
          '以下是上传图片的 OCR 识别文本（供参考，可能包含识别错误，以实际图片为准）：\n\n' +
          ocrLines.join('\n') +
          '\n请结合 OCR 文本与图片视觉信息综合判断，不要盲目照抄 OCR 结果。',
      });
    }
  }

  for (const imagePath of params.images) {
    try {
      // 传 userId 做归属校验：只允许读自己暂存/归档目录里的图
      userContent.push({
        type: 'image_url',
        image_url: { url: await imageToBase64DataUrl(imagePath, userId) },
      });
    } catch (error: any) {
      log.warn({ image: imagePath, err: error.message }, '图片加载失败');
    }
  }

  if (params.images.length > 0) {
    userContent.push({
      type: 'text',
      text: [
        '以上是与本次课程相关的图片（作业、试卷、板书等）。',
        '',
        '请先仔细观察图片，识别：题目类型、学生的作答情况、出错位置、书写规范程度、老师批改痕迹。',
        '',
        '然后在【学生收获】或【课后任务】中，结合你实际观察到的细节来写。',
        '例如写成"第3题在通分时漏乘分子导致失分"，而不是笼统地说"看图有进步"。',
        '',
        '如果图片与本次课程主题关联不大、或内容模糊无法辨识，请以文字信息为准，',
        '不要凭空编造图片里并不存在的内容。',
      ].join('\n'),
    });
  }

  return userContent;
}

/** 构造请求体 */
async function buildRequest(
  config: AiConfig,
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string,
  stream = false
): Promise<any> {
  const body: any = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: '你是一位专业的1对1教育咨询师，擅长撰写课后回访反馈。输出简洁、专业、有温度。',
      },
      { role: 'user', content: await buildUserContent(params, correction, userId) },
    ],
    max_tokens: 2000,
    temperature: 0.7,
    reasoning_effort: config.reasoningEffort,
  };
  if (stream) body.stream = true;
  return body;
}

// ============ 生成入口 ============

/** 单次调用（非流式）。供字数重试逻辑复用。 */
export async function generateOnce(
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string,
  endpoint = 'followup_once'
): Promise<string> {
  return withUserAiSlot(userId, async () => {
    const config = getAiConfig(userId);
    const ai = getClient(userId, config);
    const start = Date.now();
    let response;
    try {
      response = await ai.chat.completions.create(
        await buildRequest(config, userId, params, correction)
      );
      const content = (response.choices[0].message.content || '').trim();
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        latencyMs: Date.now() - start,
        status: 'success',
        wordCount: countWords(content),
      });
      return content;
    } catch (error: any) {
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint,
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  });
}

/** 单次调用（流式），逐块产出文本增量 */
export async function* streamOnce(
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string,
  endpoint = 'followup_stream'
): AsyncGenerator<string> {
  await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, userId);
  const config = getAiConfig(userId);
  const ai = getClient(userId, config);
  const start = Date.now();
  let fullContent = '';
  let recorded = false;
  const watchdog = startStreamWatchdog();
  try {
    const stream = (await ai.chat.completions.create(
      await buildRequest(config, userId, params, correction, true),
      { signal: watchdog.signal }
    )) as unknown as AsyncIterable<ChatStreamChunk>;
    for await (const chunk of stream) {
      watchdog.kick();
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : null;
      if (delta) {
        fullContent += delta;
        yield delta as string;
      }
    }
    recorded = true;
    await recordAiMetrics({
      userId,
      provider: config.provider,
      model: config.model,
      endpoint,
      latencyMs: Date.now() - start,
      status: 'success',
      wordCount: countWords(fullContent),
    });
  } catch (error: any) {
    if (!recorded) {
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint,
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
    }
    throw error;
  } finally {
    watchdog.done();
    releaseAiSlot(userId);
  }
}

// ============ 通用聊天能力（月度总结 / 课程规划 / 听评课等） ============

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

function buildChatRequest(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions,
  stream: boolean
): any {
  const config = getAiConfig(userId);
  const base = {
    model: config.model,
    messages,
    max_tokens: opts.maxTokens ?? 1600,
    temperature: opts.temperature ?? 0.7,
    stream,
  };
  // gemini-proxy (Google OpenAI 兼容层) 不支持 reasoning_effort 字段
  if (config.provider !== 'gemini-proxy') {
    return { ...base, reasoning_effort: config.reasoningEffort };
  }
  return base;
}

/** 通用单次调用（非流式）。进闸门，与回访的 generateOnce 同口径 */
export async function generateChatOnce(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  return withUserAiSlot(userId, async () => {
    const ai = getSharedClient(userId);
    const response = await ai.chat.completions.create(buildChatRequest(userId, messages, opts, false));
    return (response.choices[0].message.content || '').trim();
  });
}

/** 通用单次调用（流式），逐块产出文本增量。占位到流读完，与 streamOnce 同一套口径 */
export async function* streamChat(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<string> {
  await acquireAiSlot(AI_QUEUE_TIMEOUT_MS, userId);
  const watchdog = startStreamWatchdog();
  try {
    const ai = getSharedClient(userId);
    const stream = (await ai.chat.completions.create(
      buildChatRequest(userId, messages, opts, true),
      { signal: watchdog.signal }
    )) as unknown as AsyncIterable<ChatStreamChunk>;
    for await (const chunk of stream) {
      watchdog.kick();
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : null;
      if (delta) yield delta as string;
    }
  } finally {
    watchdog.done();
    releaseAiSlot(userId);
  }
}

// Re-export utilities
export { countWords, imageToBase64DataUrl, correctionText, MIN_WORDS, MAX_WORDS } from './utils.js';
export { followUpWordRangeForParams, isWordCountOk, MODULE_GUIDANCE } from './prompt.js';
export type { FollowUpGenerateParams, FollowUpHistoryItem } from './prompt.js';
export { getSharedClient, getClient } from './client.js';

// ============ 兼容层：旧路由/测试依赖的导出 ============

// 回访生成的测试注入点
type FollowUpGenerator = (userId: number, params: FollowUpGenerateParams) => Promise<string>;
type FollowUpStreamer = (userId: number, params: FollowUpGenerateParams) => AsyncGenerator<string>;
type OnceGenerator = (
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string
) => Promise<string>;

let generatorImpl: FollowUpGenerator = generateOnce;
let streamerImpl: FollowUpStreamer = streamOnce;
let onceImpl: OnceGenerator = (userId, params, correction) => generateOnce(userId, params, correction);

/** 替换非流式生成实现（仅供测试） */
export function setFollowUpGenerator(fn: FollowUpGenerator): void {
  generatorImpl = fn;
  onceImpl = async (userId, params) => fn(userId, params);
}

/** 替换流式生成实现（仅供测试） */
export function setFollowUpStreamer(fn: FollowUpStreamer): void {
  streamerImpl = fn;
}

/** 恢复为真实的模型调用 */
export function resetFollowUpGenerator(): void {
  generatorImpl = generateOnce;
  streamerImpl = streamOnce;
  onceImpl = (userId, params, correction) => generateOnce(userId, params, correction);
}

/** 路由统一入口：非流式（含字数重试） */
export function runFollowUpGeneration(userId: number, params: FollowUpGenerateParams): Promise<string> {
  return generatorImpl(userId, params);
}

/** 路由统一入口：流式 */
export function runStreamGeneration(
  userId: number,
  params: FollowUpGenerateParams
): AsyncGenerator<string> {
  return streamerImpl(userId, params);
}

/** 带纠偏指令的单次调用（流式路由用于字数重试） */
export function retryGeneration(
  userId: number,
  params: FollowUpGenerateParams,
  correction: string
): Promise<string> {
  return onceImpl(userId, params, correction);
}

// ============ 通用通道的测试注入点（月度总结 / 课程规划） ============
type ChatGenerator = (userId: number, messages: ChatMessage[], opts: ChatOptions) => Promise<string>;
type ChatStreamer = (
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions
) => AsyncGenerator<string>;

let chatOnceImpl: ChatGenerator = generateChatOnce;
let chatStreamImpl: ChatStreamer = streamChat;

/** 替换通用非流式实现（仅供测试） */
export function setChatGenerator(fn: ChatGenerator): void {
  chatOnceImpl = fn;
}

/** 替换通用流式实现（仅供测试） */
export function setChatStreamer(fn: ChatStreamer): void {
  chatStreamImpl = fn;
}

/** 恢复为真实的模型调用 */
export function resetChatGenerator(): void {
  chatOnceImpl = generateChatOnce;
  chatStreamImpl = streamChat;
}

/** 路由统一入口：通用非流式 */
export function runChatOnce(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  return chatOnceImpl(userId, messages, opts);
}

/** 路由统一入口：通用流式 */
export function runChatStream(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<string> {
  return chatStreamImpl(userId, messages, opts);
}

// 错误描述（面向前端）
export function describeAiError(
  error: any,
  userId = 0
): { httpStatus: number; message: string } {
  const name = error?.name || '';
  const raw = error?.message || '';
  const status = error?.status;

  // 排队超时：前序生成把闸门占死了，快速失败并提示（区别于单次调用超时）
  if (name === 'AiQueueTimeoutError') {
    return { httpStatus: 503, message: raw };
  }

  // 流式空闲中断：上游中途挂住不发 chunk，watchdog abort 释放并发槽
  if (name === 'AiStreamIdleError') {
    return { httpStatus: 504, message: raw };
  }

  if (name === 'APIConnectionTimeoutError' || /timed?\s*out/i.test(raw)) {
    return {
      httpStatus: 504,
      message: 'AI 生成超时（' +
        Math.round(getAiConfig(userId).timeoutMs / 1000) +
        '秒）。可稍后重试，或把 reasoning_effort 调为 none 以加快速度。',
    };
  }

  if (name === 'APIConnectionError') {
    return {
      httpStatus: 502,
      message: '无法连接到 AI 服务，请检查服务器网络或 BASE_URL 配置。',
    };
  }

  if (status === 401 || status === 403) {
    return {
      httpStatus: 502,
      message: 'API Key 无效或无权限，请在设置页中检查。',
    };
  }

  if (status === 429) {
    return {
      httpStatus: 429,
      message: '请求过于频繁或额度不足，请稍后重试。',
    };
  }

  if (status === 400) {
    return { httpStatus: 502, message: '请求被模型拒绝：' + raw };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      httpStatus: 502,
      message: 'AI 服务暂时不可用（HTTP ' + status + '），请稍后重试。',
    };
  }

  if (/API_KEY 未配置/.test(raw)) {
    return { httpStatus: 500, message: raw };
  }

  return { httpStatus: 500, message: raw || '未知错误' };
}