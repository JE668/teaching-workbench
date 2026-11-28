import { Router, type Request, type Response } from 'express';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../types/index.js';
import {
  DEFAULT_CAMPUS, MAX_PAGES, PAGE_SIZE, RETRY_TIMES,
} from '../services/teachingData/constants.js';
import { asTeachingDataError } from '../services/teachingData/errors.js';
import { login, sendTwoStepCode, verifyTwoStepCode } from '../services/teachingData/auth.js';
import { fetchAndStore, getStoredFetch } from '../services/teachingData/fetch.js';
import { contentDisposition, createWorkbookBuffer } from '../services/teachingData/excel.js';
import {
  fetchIdSchema, fetchSchema, loginSchema, twoStepSendSchema, twoStepVerifySchema,
} from '../services/teachingData/schemas.js';

const router = Router();

function userId(req: Request): number {
  const id = (req as AuthenticatedRequest).userId;
  if (typeof id !== 'number') throw new Error('Authenticated user missing');
  return id;
}

function parse<T>(schema: ZodType<T>, value: unknown, res: Response): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  res.status(400).json({
    error: '请求参数校验失败。',
    code: 'validation_error',
    details: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
  return undefined;
}

function sendError(res: Response, error: unknown, fallback?: string): void {
  const safe = asTeachingDataError(error, fallback);
  res.status(safe.status).json({ error: safe.message, code: safe.code, ...safe.details });
}

router.get('/config', (_req, res) => {
  res.json({ campus: DEFAULT_CAMPUS, pageSize: PAGE_SIZE, maxPages: MAX_PAGES, retryTimes: RETRY_TIMES });
});

router.post('/login', async (req, res) => {
  const body = parse(loginSchema, req.body, res);
  if (!body) return;
  try {
    res.json(await login(body.username, body.password, userId(req)));
  } catch (error) {
    sendError(res, error, 'SSO 暂时不可用，请稍后重试。');
  }
});

router.post('/two-step/send', async (req, res) => {
  const body = parse(twoStepSendSchema, req.body, res);
  if (!body) return;
  try {
    res.json(await sendTwoStepCode(body.twoStepId, body.method, body.phone, userId(req)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/two-step/verify', async (req, res) => {
  const body = parse(twoStepVerifySchema, req.body, res);
  if (!body) return;
  try {
    res.json(await verifyTwoStepCode(body.twoStepId, body.method, body.code, userId(req)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/fetch', async (req, res) => {
  const body = parse(fetchSchema, req.body, res);
  if (!body) return;
  try {
    res.json(await fetchAndStore(body, userId(req)));
  } catch (error) {
    sendError(res, error, '教学数据抓取失败，请稍后重试。');
  }
});

router.get('/download/:fetchId', async (req, res) => {
  const fetchId = parse(fetchIdSchema, req.params.fetchId, res);
  if (!fetchId) return;
  try {
    const stored = getStoredFetch(fetchId, userId(req));
    const buffer = await createWorkbookBuffer(stored);
    res.status(200)
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', contentDisposition(stored))
      .setHeader('Content-Length', buffer.length)
      .setHeader('Cache-Control', 'private, no-store')
      .send(buffer);
  } catch (error) {
    sendError(res, error, '导出失败，请稍后重试。');
  }
});

export default router;
