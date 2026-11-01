import sharp from 'sharp';
import { env } from '../../config/env.js';
import path from 'path';
import fs from 'fs';
import { log } from '../../utils/logger.js';

/** 中文字符计数（不含标点与空白），用于字数门禁 */
export function countWords(text: string): number {
  return (text || '').replace(/[\s\p{P}]/gu, '').length;
}

/** 图片转 Base64 Data URL（供 OpenAI vision 输入） */
export async function imageToBase64DataUrl(relPath: string): Promise<string> {
  const absPath = path.resolve(env.UPLOAD_DIR, relPath.replace(/^_staging\//, ''));
  const buffer = await sharp(absPath).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).toBuffer();
  const mime = (() => {
    const ext = path.extname(absPath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
  })();
  return 'data:' + mime + ';base64,' + buffer.toString('base64');
}

/** 模板片段填充：把 {变量} 替换成实际值，缺省留空 */
export function fill(tpl: string, vars: Record<string, string> = {}): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

/** 字数纠偏指令：首轮字数不达标时，追加给模型的二轮提示 */
export function correctionText(actual: number, range: { min: number; max: number }): string {
  if (actual < range.min) {
    return `【字数不足】当前 ${actual} 字，目标区间 ${range.min}-${range.max} 字，还差 ${range.min - actual} 字。请在不编造事实的前提下，补充更多具体细节（如：哪道题怎么错的、哪个知识点没接住、作业具体哪几题、大概花多少分钟），把内容写充实。`;
  }
  if (actual > range.max) {
    return `【字数超标】当前 ${actual} 字，目标区间 ${range.min}-${range.max} 字，超出 ${actual - range.max} 字。请删减冗余表达、合并相似句子、去掉空话套话，只保留最关键的具体细节，压缩到区间内。`;
  }
  return `【字数达标】当前 ${actual} 字，目标区间 ${range.min}-${range.max} 字。请在区间内微调表达，保持关键细节完整。`;
}

export const MIN_WORDS = 150;
export const MAX_WORDS = 280;