import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  generateAndStoreParentView,
  getParentViewByToken,
  markParentViewRead,
  submitParentFeedback,
  ParentViewData,
} from '../services/ai/parentSummary.js';
import { sendParentWechatPush } from '../services/wechatPush.js';
import { log } from '../utils/logger.js';

const router = Router();

function respondInternalError(res: Response, error: unknown, publicMessage: string): void {
  log.error({ err: error }, publicMessage);
  res.status(500).json({ error: publicMessage });
}

interface GeneratedParentView {
  id: number;
  accessToken: string;
  viewData: ParentViewData;
}

/** 可选 OpenID 只用于显式推送；非法值在调用 AI 前直接拒绝。 */
function validateParentOpenId(req: Request, res: Response, next: NextFunction) {
  const value = req.body?.parentOpenId;
  if (value === undefined || value === null) {
    next();
    return;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) {
    res.status(400).json({ error: 'parentOpenId must be a non-empty string of at most 128 characters' });
    return;
  }
  req.body.parentOpenId = value.trim();
  next();
}

/** 生成统一响应；传入 OpenID 时推送，但推送失败不会让已生成的链接失效。 */
export async function buildParentViewResponse(
  result: GeneratedParentView,
  parentOpenId?: string,
  push: typeof sendParentWechatPush = sendParentWechatPush
) {
  const viewUrl = `/parent-view/${result.accessToken}`;
  const recipientOpenId = parentOpenId?.trim();
  if (!recipientOpenId) {
    return { id: result.id, accessToken: result.accessToken, viewUrl, viewData: result.viewData };
  }

  const parentView = await getParentViewByToken(result.accessToken);
  if (!parentView) throw new Error('Generated parent view could not be loaded for WeChat push');
  const pushResult = await push({
    recipientOpenId,
    parentUrl: viewUrl,
    studentName: parentView.studentName,
    summary: result.viewData.key_progress.join('；').slice(0, 180),
  });
  return { id: result.id, accessToken: result.accessToken, viewUrl, viewData: result.viewData, pushResult };
}

// 教师生成链接需登录；token 查看、已读和反馈面向家长公开。
// POST /api/parent-view/followup/:id - 为回访生成家长视图
router.post('/followup/:id', authMiddleware, validateParentOpenId, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const followupId = parseInt(req.params.id, 10);
    const expiresDays = req.body.expiresDays || 30;

    if (isNaN(followupId)) {
      return res.status(400).json({ error: 'Invalid followup ID' });
    }

    const result = await generateAndStoreParentView(userId, 'followup', followupId, expiresDays);
    const data = await buildParentViewResponse(result, req.body?.parentOpenId);
    res.json({ success: true, data });
  } catch (error: any) {
    respondInternalError(res, error, 'Failed to generate parent view');
  }
});

// POST /api/parent-view/report/:id - 为月报生成家长视图
router.post('/report/:id', authMiddleware, validateParentOpenId, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const reportId = parseInt(req.params.id, 10);
    const expiresDays = req.body.expiresDays || 30;

    if (isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }

    const result = await generateAndStoreParentView(userId, 'report', reportId, expiresDays);
    const data = await buildParentViewResponse(result, req.body?.parentOpenId);
    res.json({ success: true, data });
  } catch (error: any) {
    respondInternalError(res, error, 'Failed to generate parent view');
  }
});

// GET /api/parent-view/:token - 通过 token 获取家长视图（无需登录，公开访问）
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const result = await getParentViewByToken(token);

    if (!result) {
      return res.status(404).json({ error: 'Parent view not found or expired' });
    }

    res.json({
      success: true,
      data: {
        studentName: result.studentName,
        subject: result.subject,
        sourceType: result.sourceType,
        sourceId: result.sourceId,
        createdAt: result.createdAt,
        viewData: result.viewData,
        readAt: result.readAt,
        parentFeedback: result.parentFeedback,
      },
    });
  } catch (error: any) {
    respondInternalError(res, error, 'Failed to get parent view');
  }
});

// POST /api/parent-view/:token/read - 家长标记已读
router.post('/:token/read', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const updated = await markParentViewRead(token);
    if (!updated) {
      return res.status(404).json({ error: 'Parent view not found or expired' });
    }
    res.json({ success: true });
  } catch (error: any) {
    respondInternalError(res, error, 'Failed to mark as read');
  }
});

// POST /api/parent-view/:token/feedback - 家长提交反馈（我有疑问）
router.post('/:token/feedback', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { feedback } = req.body;

    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      return res.status(400).json({ error: 'Feedback content is required' });
    }

    if (feedback.length > 1000) {
      return res.status(400).json({ error: 'Feedback too long (max 1000 characters)' });
    }

    const updated = await submitParentFeedback(token, feedback.trim());
    if (!updated) {
      return res.status(404).json({ error: 'Parent view not found or expired' });
    }
    res.json({ success: true });
  } catch (error: any) {
    respondInternalError(res, error, 'Failed to submit feedback');
  }
});

export default router;
