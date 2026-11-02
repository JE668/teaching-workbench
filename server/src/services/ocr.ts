/**
 * OCR 服务：上传图片时自动识别文本，供 AI 生成时作为额外上下文。
 *
 * - 使用 tesseract.js（纯 JS，无需系统依赖）
 * - 支持中英混合识别
 * - 识别结果存入数据库，关联图片路径
 * - 失败不阻塞主流程，仅记录日志
 */

import { createWorker } from 'tesseract.js';
import { db } from '../config/database.js';
import { log } from '../utils/logger.js';
import { env } from '../config/env.js';

// 全局 worker 单例（懒加载）
let workerPromise: Promise<any> | null = null;

// 测试环境一律跳过真实 OCR：worker 初始化要拉取 ~10MB+ 的 chi_sim 语言数据，
// CI 里这条链路（下载/解压/加载）曾整批卡死测试直到 15 分钟超时。
// 测试只关心图片生命周期与 OCR 结果的入库/读取路径，不校验识别文本本身。
const OCR_DISABLED_IN_TEST = process.env.NODE_ENV === 'test';

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // 显式指定语言数据路径，避免 CI 中相对路径问题
      const langPath = env.TESSDATA_PREFIX || process.env.TESSDATA_PREFIX;
      const worker = await createWorker('chi_sim+eng', 1, {
        logger: (m) => log.debug({ ocr: m.status, progress: m.progress }, 'OCR 进度'),
        langPath: langPath, // 关键：显式指定语言数据目录
      });
      return worker;
    })();
  }
  return workerPromise;
}

/**
 * 对单张图片做 OCR 识别。
 * @param imagePath 图片绝对路径
 * @returns 识别出的纯文本（去首尾空白），失败返回空串
 */
export async function ocrImage(imagePath: string): Promise<string> {
  if (OCR_DISABLED_IN_TEST) return '';
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imagePath);
    return (data.text || '').trim();
  } catch (error: any) {
    log.warn({ image: imagePath, err: error.message }, 'OCR 识别失败');
    return '';
  }
}

/**
 * 批量识别多张图片。
 * @param imagePaths 图片绝对路径数组
 * @returns { path: string, text: string }[]，识别失败的 text 为空串
 */
export async function ocrImages(imagePaths: string[]): Promise<Array<{ path: string; text: string }>> {
  const results = await Promise.all(
    imagePaths.map(async (p) => ({ path: p, text: await ocrImage(p) }))
  );
  return results;
}

/**
 * 将 OCR 结果写入数据库（关联图片相对路径）。
 * 供上传路由在保存暂存图后调用。
 */
export async function saveOcrResults(userId: number, results: Array<{ path: string; text: string }>): Promise<void> {
  if (!results.length) return;
  const stmt = db.prepare(
    `INSERT INTO image_ocr (user_id, image_path, text, created_at)
     VALUES (?, ?, ?, datetime('now','+8 hours'))
     ON CONFLICT(user_id, image_path) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`
  );
  const tx = db.transaction((entries: Array<[number, string, string]>) => {
    for (const [uid, path, text] of entries) stmt.run(uid, path, text);
  });
  tx(results.map((r) => [userId, r.path, r.text]));
  log.debug({ count: results.length }, 'OCR 结果已入库');
}

/**
 * 读取图片的 OCR 文本（供 AI 生成时调用）。
 */
export function getOcrText(userId: number, imagePaths: string[]): Record<string, string> {
  if (!imagePaths.length) return {};
  const placeholders = imagePaths.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT image_path, text FROM image_ocr WHERE user_id = ? AND image_path IN (${placeholders})`)
    .all(userId, ...imagePaths) as Array<{ image_path: string; text: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.image_path] = r.text;
  return map;
}

/** 关闭 worker（进程退出时调用） */
export async function closeOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}