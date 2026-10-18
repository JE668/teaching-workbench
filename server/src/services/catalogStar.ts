import { getSharedClient, describeAiError } from './ai.js';
import { getAiConfig } from '../config/settings.js';
import { log } from '../utils/logger.js';
import {
  STAR_BATCH_SIZE,
  buildStarPrompt,
  chunk,
  parseStarResponse,
  type StarCourseInput,
  type StarDecision,
  type StarScope,
} from '../utils/catalogStar.js';

/**
 * 掌握星级 AI 初评：分批让模型给课程定档，每批回调给上层落库。
 *
 * 逐批提交而不是攒到最后一次性写——中途超时或断线时，已完成的批次还在库里，
 * 用户再点一次「AI 定档」就会只补剩下的（onlyEmpty），天然可续跑。
 */

export interface StarSuggestResult {
  total: number;
  batches: number;
  updated: number;
  model: string;
}

export interface StarSuggestProgress {
  batch: number;
  totalBatches: number;
  updated: number;
  total: number;
}

/** 每批完成后回调：decisions 是该批有效决策，供上层立即落库 */
export type StarBatchCallback = (
  batch: number,
  totalBatches: number,
  decisions: StarDecision[]
) => void;

type StarGenerator = (prompt: string) => Promise<string>;

let generatorImpl: StarGenerator = callModel;

async function callModel(prompt: string): Promise<string> {
  const ai = getSharedClient();
  const config = getAiConfig();
  const body: any = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          '你是教研课程顾问，擅长依据期末考分值占比、学习难度和课程类型判断一门课的掌握要求档位。只输出要求的 JSON。',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4000,
    temperature: 0.2,
    reasoning_effort: config.reasoningEffort,
  };
  const res = await ai.chat.completions.create(body);
  return (res.choices[0]?.message?.content || '').trim();
}

/** 替换模型调用（仅供测试） */
export function setStarGenerator(fn: StarGenerator): void {
  generatorImpl = fn;
}

export function resetStarGenerator(): void {
  generatorImpl = callModel;
}

/**
 * 给一批课程定档。
 *
 * @returns 汇总信息；`updated` 是实际产生决策的课程数（不含脏数据被丢弃的）
 */
export async function suggestMasteryStars(
  courses: StarCourseInput[],
  onBatch: StarBatchCallback,
  scope: StarScope = {}
): Promise<StarSuggestResult> {
  const model = getAiConfig().model;
  if (!courses.length) {
    return { total: 0, batches: 0, updated: 0, model };
  }

  const groups = chunk(courses, STAR_BATCH_SIZE);
  const validIds = new Set(courses.map((c) => c.id));
  let updated = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const prompt = buildStarPrompt(group, scope);
    let text: string;
    try {
      text = await generatorImpl(prompt);
    } catch (error: any) {
      // 翻译失败原因再抛，让上层给用户看得懂的中文提示
      throw Object.assign(new Error(describeAiError(error).message), {
        batch: i + 1,
        cause: error,
      });
    }

    const decisions = parseStarResponse(text, validIds).filter((d) => group.some((c) => c.id === d.id));
    updated += decisions.length;
    onBatch(i + 1, groups.length, decisions);

    log.info(
      { batch: i + 1, totalBatches: groups.length, groupSize: group.length, decisions: decisions.length },
      '掌握星级第 ' + (i + 1) + ' 批完成'
    );
  }

  return { total: courses.length, batches: groups.length, updated, model };
}
