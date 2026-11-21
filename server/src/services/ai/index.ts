import { getAiConfig, AiConfig } from '../../config/settings.js';
import { getClient, getSharedClient } from './client.js';
import {
  buildPrompt,
  buildStructuredPrompt,
  buildMultimodalPrompt,
  FollowUpGenerateParams,
  STRUCTURED_RESPONSE_FORMAT,
  MULTIMODAL_RESPONSE_FORMAT,
  structuredToText,
  parseStructuredOutput,
  parseMultimodalObservations,
} from './prompt.js';
import { getOcrText } from '../ocr.js';
import { imageToBase64DataUrl, countWords } from './utils.js';
import { recordAiMetrics } from '../aiMetrics.js';
import { log } from '../../utils/logger.js';
import { env } from '../../config/env.js';

// Re-export getAiConfig for use by other services (e.g., reportAi.ts)
export { getAiConfig };

// ============ 并发闸门 + 优先级队列 ============
// 老师连点两次「生成」，或两个学生在两个标签页同时生成，就是两个请求一起打出去：
// 双倍计费，而且两份结果会互相覆盖（后返回的把先返回的冲掉）。
// 早期是整站共用一个全局计数（MAX_CONCURRENT_AI=2）：多用户一起用时，后台批量任务
// （目录星级判定会连发几十批）会把槽位长期占满，别人正常的回访/听评课只能排队，
// 最后一起撞上 2 分钟排队超时 —— 一个人卡住全站 AI 不可用。
// 现在按用户分桶：每个用户各自限并发，互不饿死；全局再留一个更高的保护上限，
// 防止多用户叠加把上游供应商的配额打爆。
// 新增：按优先级分队（interactive > batch > background），高优可抢占低优。

/** AI 任务优先级：交互式生成 > 批量任务 > 后台任务 */
export type AiTaskPriority = 'interactive' | 'batch' | 'background';

/** 单个用户同时最多几个 AI 请求 */
export const MAX_CONCURRENT_AI = 2;
/** 全站同时最多几个（多用户叠加时的保护上限，防上游限流/爆预算） */
export const MAX_CONCURRENT_AI_GLOBAL = 8;

/** 优先级对应的并发限制（单用户/全局） */
export const PRIORITY_LIMITS: Record<AiTaskPriority, { user: number; global: number }> = {
  interactive: { user: 2, global: 6 },  // 交互式优先，预留大部分槽位
  batch: { user: 2, global: 4 },        // 批量任务限制更严
  background: { user: 1, global: 2 },   // 后台任务最低优先级
};

/** 没有登录用户上下文的调用（启动时的后台任务、单测）统一算进这个桶 */
const UNBOUND_AI_USER = 0;

interface QueuedTask {
  priority: AiTaskPriority;
  userId: number;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  enqueuedAt: number;
}

/** 当前按优先级分桶的并发计数 */
let aiInFlightByPriority: Record<AiTaskPriority, number> = {
  interactive: 0,
  batch: 0,
  background: 0,
};

/** userId -> 该用户按优先级分桶的并发计数 */
const aiInFlightByUser = new Map<number, Record<AiTaskPriority, number>>();

/** 等待队列（按优先级分组，组内 FIFO） */
const aiWaitersByPriority: Record<AiTaskPriority, QueuedTask[]> = {
  interactive: [],
  batch: [],
  background: [],
};

/** 排队上限：超过就快速失败，而不是无限挂在某个卡死的生成上 */
export const AI_QUEUE_TIMEOUT_MS = 120_000;

export class AiQueueTimeoutError extends Error {
  constructor() {
    super('AI 排队等待超过 2 分钟，前序生成可能已卡住，请稍后重试。');
    this.name = 'AiQueueTimeoutError';
  }
}

/** 归一化用户标识：未登录/非法值都落到匿名桶，绝不因为缺 userId 就跳过限流 */
function bucketOf(userId?: number | null): number {
  return typeof userId === 'number' && Number.isFinite(userId) && userId > 0 ? userId : UNBOUND_AI_USER;
}

function getUserBuckets(userId: number): Record<AiTaskPriority, number> {
  const buckets = aiInFlightByUser.get(userId);
  if (!buckets) {
    const empty: Record<AiTaskPriority, number> = { interactive: 0, batch: 0, background: 0 };
    aiInFlightByUser.set(userId, empty);
    return empty;
  }
  return buckets;
}

/** 该用户在指定优先级是否还有余量 */
function hasRoomForPriority(userId: number, priority: AiTaskPriority): boolean {
  const limits = PRIORITY_LIMITS[priority];
  const userBuckets = getUserBuckets(userId);
  return userBuckets[priority] < limits.user && aiInFlightByPriority[priority] < limits.global;
}

/** 唤醒指定优先级队列中第一个有余量的等待者 */
function wakeNextWaiterForPriority(priority: AiTaskPriority): void {
  const queue = aiWaitersByPriority[priority];
  const idx = queue.findIndex((w) => hasRoomForPriority(w.userId, priority));
  if (idx < 0) return;
  const [next] = queue.splice(idx, 1);
  clearTimeout(next.timer);
  next.resolve();
}

/** 任务完成后唤醒所有优先级队列（高优先级先被唤醒） */
function wakeAllWaiters(): void {
  // 按优先级顺序唤醒：interactive -> batch -> background
  for (const priority of ['interactive', 'batch', 'background'] as AiTaskPriority[]) {
    wakeNextWaiterForPriority(priority);
  }
}

/** 抢占检查：若有 interactive 任务等待且全局/用户槽位满，尝试抢占最旧的低优任务 */
function tryPreemptLowPriority(newPriority: AiTaskPriority): void {
  // 只有 interactive 可以抢占 batch/background
  if (newPriority !== 'interactive') return;

  // 检查是否有 interactive 任务在等待
  if (aiWaitersByPriority.interactive.length === 0) return;

  // 寻找可抢占的低优任务（优先抢占 background，再 batch）
  for (const victimPriority of ['background', 'batch'] as AiTaskPriority[]) {
    // 只有当低优任务占用了本该给 interactive 的全局/用户槽位时才抢占
    if (aiInFlightByPriority[victimPriority] === 0) continue;

    // 找到该优先级中最早入队的任务（最旧的）
    const userEntries = Array.from(aiInFlightByUser.entries());
    let victim: { userId: number; priority: AiTaskPriority } | null = null;
    let oldestEnqueued = Infinity;

    for (const [userId, buckets] of userEntries) {
      if (buckets[victimPriority] > 0) {
        // 找到该用户在该优先级下最旧的等待任务
        for (const task of aiWaitersByPriority[victimPriority]) {
          if (task.userId === userId && task.enqueuedAt < oldestEnqueued) {
            oldestEnqueued = task.enqueuedAt;
            victim = { userId, priority: victimPriority };
          }
        }
      }
    }

    if (victim) {
      // 标记抢占：从等待队列中移除并拒绝
      const victimQueue = aiWaitersByPriority[victim.priority];
      const idx = victimQueue.findIndex((t) => t.userId === victim!.userId && t.priority === victim!.priority);
      if (idx >= 0) {
        const [preempted] = victimQueue.splice(idx, 1);
        clearTimeout(preempted.timer);
        preempted.reject(new Error('AI 任务被高优先级交互式请求抢占，请稍后重试'));
        log.info({ victimPriority: victim.priority, victimUserId: victim.userId }, 'AI 低优任务被抢占');
      }
      return; // 一次只抢占一个槽位
    }
  }
}

/**
 * 占用一个 AI 并发槽（支持优先级）。
 * @param priority 任务优先级，默认 interactive
 * @param timeoutMs 排队上限，超时抛 AiQueueTimeoutError
 * @param userId 按用户分桶的键；不传算匿名桶
 */
export async function acquireAiSlot(
  priority: AiTaskPriority = 'interactive',
  timeoutMs: number = AI_QUEUE_TIMEOUT_MS,
  userId?: number | null
): Promise<void> {
  const bucket = bucketOf(userId);
  const enqueuedAt = Date.now();

  // 抢占检查：interactive 到来时尝试抢占低优任务
  tryPreemptLowPriority(priority);

  // 用循环而不是单次判断：被唤醒时可能刚好被同桶的其他人抢先，重新排队即可
  while (!hasRoomForPriority(bucket, priority)) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = aiWaitersByPriority[priority];
        const k = queue.findIndex((w) => w.timer === timer);
        if (k >= 0) queue.splice(k, 1);
        reject(new AiQueueTimeoutError());
      }, timeoutMs);
      aiWaitersByPriority[priority].push({ priority, userId: bucket, resolve, reject, timer, enqueuedAt });
    });
  }
  aiInFlightByPriority[priority]++;
  getUserBuckets(bucket)[priority]++;
}

/** 释放一个 AI 并发槽（必须传与 acquireAiSlot 相同的 userId 和 priority，否则桶会对不上） */
export function releaseAiSlot(
  userId?: number | null,
  priority: AiTaskPriority = 'interactive'
): void {
  const bucket = bucketOf(userId);
  aiInFlightByPriority[priority] = Math.max(0, aiInFlightByPriority[priority] - 1);
  const userBuckets = getUserBuckets(bucket);
  userBuckets[priority] = Math.max(0, userBuckets[priority] - 1);
  // 清理空桶
  if (userBuckets.interactive === 0 && userBuckets.batch === 0 && userBuckets.background === 0) {
    aiInFlightByUser.delete(bucket);
  }
  wakeAllWaiters();
}

/** 把一次 AI 调用放进并发闸门（支持优先级） */
export async function withAiSlot<T>(
  fn: () => Promise<T>,
  priority: AiTaskPriority = 'interactive',
  userId?: number | null
): Promise<T> {
  await acquireAiSlot(priority, AI_QUEUE_TIMEOUT_MS, userId);
  try {
    return await fn();
  } finally {
    releaseAiSlot(userId, priority);
  }
}

/** 按用户分桶的闸门包装：AI 入口一律用这个，别用无 userId 的 withAiSlot */
export async function withUserAiSlot<T>(
  userId: number,
  fn: () => Promise<T>,
  priority: AiTaskPriority = 'interactive'
): Promise<T> {
  return withAiSlot(fn, priority, userId);
}

/** 当前正在跑的 AI 请求数：不传 priority 返回全站总数 */
export function getAiInFlightCount(priority?: AiTaskPriority | null, userId?: number | null): number {
  if (priority === undefined || priority === null) {
    return aiInFlightByPriority.interactive + aiInFlightByPriority.batch + aiInFlightByPriority.background;
  }
  if (userId === undefined || userId === null) {
    return aiInFlightByPriority[priority];
  }
  return getUserBuckets(bucketOf(userId))[priority];
}

/** 获取队列深度（用于 metrics 监控） */
export function getAiQueueDepth(priority?: AiTaskPriority): number {
  if (priority === undefined || priority === null) {
    return aiWaitersByPriority.interactive.length + aiWaitersByPriority.batch.length + aiWaitersByPriority.background.length;
  }
  return aiWaitersByPriority[priority].length;
}

/** 重置闸门计数（仅供测试） */
export function resetAiGate(): void {
  aiInFlightByPriority = { interactive: 0, batch: 0, background: 0 };
  aiInFlightByUser.clear();
  for (const priority of ['interactive', 'batch', 'background'] as AiTaskPriority[]) {
    for (const w of aiWaitersByPriority[priority]) clearTimeout(w.timer);
    aiWaitersByPriority[priority].length = 0;
  }
}

/** OpenAI 流式 chunk 的最小结构（SDK Stream 泛型收窄用） */
interface ChatStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
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
  stream = false,
  structured = false
): Promise<any> {
  const body: any = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: structured
          ? await buildStructuredPrompt(params, correction, userId)
          : '你是一位专业的1对1教育咨询师，擅长撰写课后回访反馈。输出简洁、专业、有温度。',
      },
      { role: 'user', content: await buildUserContent(params, correction, userId) },
    ],
    max_tokens: 2000,
    temperature: 0.7,
    reasoning_effort: config.reasoningEffort,
  };
  if (stream) body.stream = true;
  if (structured) body.response_format = STRUCTURED_RESPONSE_FORMAT;
  return body;
}

// ============ 生成入口 ============

/** 单次调用（非流式）。供字数重试逻辑复用。 */
export async function generateOnce(
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string,
  endpoint = 'followup_once'
): Promise<StructuredFollowUpResult> {
  return withUserAiSlot(userId, async () => {
    const config = getAiConfig(userId);
    const ai = getClient(userId, config);
    const start = Date.now();
    let response;
    try {
      response = await ai.chat.completions.create(
        await buildRequest(config, userId, params, correction, false, true)
      );
      const content = (response.choices[0].message.content || '').trim();
      const structured = parseStructuredOutput(content);
      const text = structured ? structuredToText(structured) : content;
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
        wordCount: countWords(text),
      });
      return { structured, text, wordCount: countWords(text) };
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

/** 单次调用（流式），逐块产出文本增量。
 *  @param externalSignal 路由层在客户端断开时传进来的 abort 信号；
 *  与内部 watchdog 信号合并后下发给上游，确保客户端断开能立即停止上游请求（释放并发槽、停止计费）。 */
export async function* streamOnce(
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string,
  endpoint = 'followup_stream',
  externalSignal?: AbortSignal
): AsyncGenerator<string> {
  await acquireAiSlot('interactive', AI_QUEUE_TIMEOUT_MS, userId);
  const config = getAiConfig(userId);
  const ai = getClient(userId, config);
  const start = Date.now();
  let fullContent = '';
  let recorded = false;
  const watchdog = startStreamWatchdog();
  // 合并内外信号：任一触发即中止。Node 20+ 支持 AbortSignal.any。
  const mergedSignal = externalSignal
    ? AbortSignal.any([watchdog.signal, externalSignal])
    : watchdog.signal;
  try {
    const stream = (await ai.chat.completions.create(
      await buildRequest(config, userId, params, correction, true, true),
      { signal: mergedSignal }
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
    releaseAiSlot(userId, 'interactive');
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

/** 通用单次调用（流式），逐块产出文本增量。占位到流读完，与 streamOnce 同一套口径。
 *  @param externalSignal 路由层在客户端断开时传进来的 abort 信号（与 streamOnce 同口径）。 */
export async function* streamChat(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions = {},
  externalSignal?: AbortSignal
): AsyncGenerator<string> {
  await acquireAiSlot('interactive', AI_QUEUE_TIMEOUT_MS, userId);
  const watchdog = startStreamWatchdog();
  const mergedSignal = externalSignal
    ? AbortSignal.any([watchdog.signal, externalSignal])
    : watchdog.signal;
  try {
    const ai = getSharedClient(userId);
    const stream = (await ai.chat.completions.create(
      buildChatRequest(userId, messages, opts, true),
      { signal: mergedSignal }
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
    releaseAiSlot(userId, 'interactive');
  }
}

// Re-export utilities
export { countWords, imageToBase64DataUrl, correctionText, MIN_WORDS, MAX_WORDS } from './utils.js';
export { followUpWordRangeForParams, isWordCountOk, MODULE_GUIDANCE, structuredToText, parseStructuredOutput, STRUCTURED_RESPONSE_FORMAT, STRUCTURED_FOLLOWUP_SCHEMA, STRUCTURED_BLOCKS } from './prompt.js';
export type { FollowUpGenerateParams, FollowUpHistoryItem, StructuredBlockKey } from './prompt.js';
export { getSharedClient, getClient } from './client.js';
export { recordAiMetrics } from '../aiMetrics.js';

// ============ 多模态融合：观察结构化提取 ============

export interface MultimodalObservation {
  type: 'question_type' | 'mistake' | 'teacher_mark' | 'handwriting' | 'key_info' | 'other';
  detail: string;
  evidence_image_index: number;
}

export interface MultimodalObservationsResult {
  observations: MultimodalObservation[];
}

/**
 * 从上传的图片中提取结构化观察信息
 * 两步：
 * 1) 调用模型输出 JSON 格式的 observations（使用 response_format json_schema 强制结构化）
 * 2) 解析并校验，返回 MultimodalObservationsResult
 */
export async function extractMultimodalObservations(
  userId: number,
  params: FollowUpGenerateParams,
  endpoint = 'multimodal_observations'
): Promise<MultimodalObservationsResult> {
  return withUserAiSlot(userId, async () => {
    const config = getAiConfig(userId);
    const ai = getClient(userId, config);
    const start = Date.now();
    let response;
    try {
      const body: any = {
        model: config.model,
        messages: [
          {
            role: 'system',
            content: buildMultimodalPrompt(params),
          },
          { role: 'user', content: await buildUserContent(params, undefined, userId) },
        ],
        max_tokens: 2000,
        temperature: 0.3,
        reasoning_effort: config.reasoningEffort,
        response_format: MULTIMODAL_RESPONSE_FORMAT,
      };
      response = await ai.chat.completions.create(body);
      const content = (response.choices[0].message.content || '').trim();
      const parsed = parseMultimodalObservations(content);
      if (!parsed) {
        throw new Error('多模态观察输出解析失败：格式不符合 JSON Schema');
      }
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
        wordCount: 0,
      });
      return parsed;
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

export { parseMultimodalObservations, multimodalObservationsToText, MULTIMODAL_RESPONSE_FORMAT, MULTIMODAL_OBSERVATIONS_SCHEMA } from './prompt.js';

// ============ 知识图谱 ============
export {
  extractKnowledgePoints,
  upsertKnowledgePoints,
  getKnowledgeRadar,
  getWeakPoints,
  recommendRemedialExercises,
  buildKnowledgeExtractionPrompt,
  KNOWLEDGE_EXTRACTION_SCHEMA,
  type ExtractedKnowledgePoint,
  type KnowledgeExtractionResult,
  type KnowledgePointCategory,
} from '../knowledge/graph.js';
// ============ 阶测错因分析 ============
export {
  analyzeExam,
  getExamAnalysis,
  getStudentMistakeTrend,
  buildExamAnalysisPrompt,
  MISTAKE_TAG_TAXONOMY,
  type ExamQuestionAnalysis,
  type ExamAnalysisResult,
  type MistakePrimaryTag,
  type MistakeSecondaryTag,
} from './examAnalysis.js';


// ============ 兼容层：旧路由/测试依赖的导出 ============

// 回访生成的测试注入点
export interface StructuredFollowUpResult {
  structured: Record<string, string> | null;
  text: string;
  wordCount: number;
}

type FollowUpGenerator = (userId: number, params: FollowUpGenerateParams) => Promise<StructuredFollowUpResult>;
type FollowUpStreamer = (userId: number, params: FollowUpGenerateParams) => AsyncGenerator<string>;
type OnceGenerator = (
  userId: number,
  params: FollowUpGenerateParams,
  correction?: string
) => Promise<StructuredFollowUpResult>;

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
export function runFollowUpGeneration(userId: number, params: FollowUpGenerateParams): Promise<StructuredFollowUpResult> {
  return generatorImpl(userId, params);
}

/** 路由统一入口：流式
 *  @param externalSignal 客户端断开时由路由层传入的 abort 信号，透传给底层 streamOnce。 */
export function runStreamGeneration(
  userId: number,
  params: FollowUpGenerateParams,
  externalSignal?: AbortSignal
): AsyncGenerator<string> {
  // 测试注入点保留旧签名；生产实现透传信号
  if (streamerImpl === streamOnce) return streamOnce(userId, params, undefined, 'followup_stream', externalSignal);
  return streamerImpl(userId, params);
}

/** 带纠偏指令的单次调用（流式路由用于字数重试） */
export function retryGeneration(
  userId: number,
  params: FollowUpGenerateParams,
  correction: string
): Promise<StructuredFollowUpResult> {
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

/** 路由统一入口：通用流式。
 *  @param externalSignal 客户端断开时由路由层传入的 abort 信号，透传给底层 streamChat。 */
export function runChatStream(
  userId: number,
  messages: ChatMessage[],
  opts: ChatOptions = {},
  externalSignal?: AbortSignal
): AsyncGenerator<string> {
  // 生产实现透传信号；测试注入点保留旧签名
  if (chatStreamImpl === streamChat) return streamChat(userId, messages, opts, externalSignal);
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