import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../types/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { log } from '../utils/logger.js';
import {
  compareRenewalReports,
  listRiskFollowups,
  RenewalActionError,
  upsertRiskFollowup,
} from './actionService.js';

export { initRenewalActions } from './actionService.js';
export const actionRouter = Router();

type ActionHandler = (req: AuthenticatedRequest, res: Response) => void | Promise<void>;

/** 已知的输入/业务错误可读；数据库等未知异常只记录日志并返回固定文案。 */
function handle(publicError: string, handler: ActionHandler) {
  return asyncHandler(async (req, res) => {
    try {
      await handler(req as AuthenticatedRequest, res);
    } catch (error) {
      if (error instanceof RenewalActionError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      log.error({ err: error, path: req.path, method: req.method }, publicError);
      res.status(500).json({ error: publicError });
    }
  });
}

function reportIdOf(raw: unknown, field = 'reportId'): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new RenewalActionError(`${field} 必须是正整数`);
  }
  const reportId = Number(raw);
  if (!Number.isSafeInteger(reportId)) throw new RenewalActionError(`${field} 必须是正整数`);
  return reportId;
}

function tabOf(raw: unknown): string {
  if (raw === undefined) return 'stage';
  if (typeof raw !== 'string') throw new RenewalActionError('未知的统计表 tab');
  return raw;
}

function userIdOf(req: AuthenticatedRequest): number {
  const userId = req.userId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new RenewalActionError('用户身份无效', 401);
  }
  return userId;
}

actionRouter.get('/compare', handle('获取续费批次对比失败', (req, res) => {
  const reportId = reportIdOf(req.query.reportId);
  const compareReportId = reportIdOf(req.query.compareReportId, 'compareReportId');
  const comparison = compareRenewalReports(reportId, compareReportId, userIdOf(req), tabOf(req.query.tab));
  res.json(comparison);
}));

actionRouter.get('/risk-followups', handle('获取风险跟进失败', (req, res) => {
  const reportId = reportIdOf(req.query.reportId);
  res.json({ reportId, records: listRiskFollowups(reportId, userIdOf(req)) });
}));

actionRouter.put('/risk-followups/:studentKey', handle('保存风险跟进失败', (req, res) => {
  const reportId = reportIdOf(req.query.reportId);
  const record = upsertRiskFollowup(
    reportId,
    req.params.studentKey,
    req.body,
    userIdOf(req),
  );
  res.json({ record });
}));

// 根代理调用：initRenewalDb() 后调用 initRenewalActions()，再把本 router 挂到已有鉴权链下。
export default actionRouter;
