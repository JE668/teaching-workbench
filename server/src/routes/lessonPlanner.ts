import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types/index.js';
import { describeAiError } from '../services/ai/index.js';
import { log } from '../utils/logger.js';
import {
  LessonPlannerInputError,
  cloneLessonPlan,
  deleteLessonPlan,
  generateAndSaveLessonPlan,
  getLessonPlanById,
  lessonPlanSchema,
  listLessonPlans,
  updateLessonPlan,
} from '../services/ai/lessonPlanner.js';

const router = Router();

function respondInternalError(res: Response, error: unknown, publicMessage: string): void {
  log.error({ err: error }, publicMessage);
  res.status(500).json({ error: publicMessage });
}

const generateSchema = z.object({
  studentId: z.number().int().positive().nullish(),
  courseId: z.number().int().positive().nullish(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  durationMinutes: z.number().int().min(15).max(240).optional(),
  weekCount: z.number().int().min(1).max(8).optional(),
  requirements: z.string().trim().max(2000).optional(),
}).strict();

const cloneSchema = z.object({
  studentId: z.number().int().positive().nullish(),
}).strict();

const listSchema = z.object({
  studentId: z.coerce.number().int().positive().optional(),
  courseId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  scope: z.enum(['mine', 'group']).default('mine'),
}).strict();

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  durationMinutes: z.number().int().min(15).max(240).optional(),
  requirements: z.string().trim().max(2000).optional(),
  status: z.enum(['draft', 'confirmed']).optional(),
  plan: z.unknown(),
}).strict();

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validationError(res: Response, result: { error: z.ZodError }) {
  return res.status(400).json({ error: '参数校验失败', details: result.error.issues });
}

router.post('/generate', async (req: AuthenticatedRequest, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  try {
    const plan = await generateAndSaveLessonPlan(req.userId!, parsed.data);
    return res.status(201).json({ plan });
  } catch (error: any) {
    if (error instanceof LessonPlannerInputError) return res.status(error.statusCode).json({ error: error.message });
    const described = describeAiError(error, req.userId!);
    if (described.httpStatus === 500) return respondInternalError(res, error, '生成教案失败');
    return res.status(described.httpStatus).json({ error: described.message });
  }
});

router.post('/:id/clone', (req: AuthenticatedRequest, res) => {
  const id = numericId(req.params.id);
  if (!id) return res.status(400).json({ error: '教案 ID 必须为正整数' });
  const parsed = cloneSchema.safeParse(req.body === undefined ? {} : req.body);
  if (!parsed.success) return validationError(res, parsed);
  try {
    const plan = cloneLessonPlan(req.userId!, id, parsed.data);
    if (!plan) return res.status(404).json({ error: '教案不存在或无权克隆' });
    return res.status(201).json({ plan });
  } catch (error: any) {
    return respondInternalError(res, error, '克隆教案失败');
  }
});

router.get('/', (req: AuthenticatedRequest, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed);
  try {
    return res.json(listLessonPlans(req.userId!, parsed.data));
  } catch (error: any) {
    return respondInternalError(res, error, '获取教案列表失败');
  }
});

router.get('/:id', (req: AuthenticatedRequest, res) => {
  const id = numericId(req.params.id);
  if (!id) return res.status(400).json({ error: '教案 ID 必须为正整数' });
  try {
    const plan = getLessonPlanById(req.userId!, id);
    if (!plan) return res.status(404).json({ error: '教案不存在' });
    return res.json({ plan });
  } catch (error: any) {
    return respondInternalError(res, error, '获取教案详情失败');
  }
});

router.put('/:id', (req: AuthenticatedRequest, res) => {
  const id = numericId(req.params.id);
  if (!id) return res.status(400).json({ error: '教案 ID 必须为正整数' });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const document = lessonPlanSchema.safeParse(parsed.data.plan);
  if (!document.success) {
    return res.status(400).json({ error: '教案结构校验失败', details: document.error.issues });
  }
  try {
    const plan = updateLessonPlan(req.userId!, id, { ...parsed.data, plan: document.data });
    if (!plan) return res.status(404).json({ error: '教案不存在' });
    return res.json({ plan });
  } catch (error: any) {
    if (error instanceof LessonPlannerInputError) return res.status(error.statusCode).json({ error: error.message });
    return respondInternalError(res, error, '保存教案失败');
  }
});

router.delete('/:id', (req: AuthenticatedRequest, res) => {
  const id = numericId(req.params.id);
  if (!id) return res.status(400).json({ error: '教案 ID 必须为正整数' });
  try {
    if (!deleteLessonPlan(req.userId!, id)) return res.status(404).json({ error: '教案不存在' });
    return res.json({ success: true });
  } catch (error: any) {
    return respondInternalError(res, error, '删除教案失败');
  }
});

export default router;
