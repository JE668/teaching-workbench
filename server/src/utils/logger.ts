import pino from 'pino';
import { env } from '../config/env.js';

/**
 * 全局结构化日志器（pino）。
 *
 * - 生产（Docker）：JSON 输出到 stdout，容器日志收集器直接解析
 * - 测试：级别 silent，避免刷屏
 * - 开发：默认 info，可通过 LOG_LEVEL=debug 打开
 *
 * 用法：
 *   import { log } from '../utils/logger.js';
 *   log.info({ userId }, '用户登录');
 *   log.warn({ path }, '图片加载失败');
 *   log.error({ status, err }, 'AI 生成失败');
 */
const level = process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info');

export const log = pino({ level });
