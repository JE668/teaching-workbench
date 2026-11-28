import { z } from 'zod';
import type { DepartmentKey, TeachingModel } from './types.js';

const optionalText = z.string().trim().max(200).optional();
const isoDate = z.string().regex(/^d{4}-d{2}-d{2}$/, '日期格式应为 YYYY-MM-DD').refine((value) => {
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '日期无效');

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(512),
});

export const twoStepSendSchema = z.object({
  twoStepId: z.string().trim().min(1).max(80),
  method: z.enum(['sms', 'wx']),
  phone: z.string().trim().max(32).optional(),
}).superRefine((value, ctx) => {
  if (value.method === 'sms' && !value.phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: '短信验证需要手机号' });
  }
});

export const twoStepVerifySchema = z.object({
  twoStepId: z.string().trim().min(1).max(80),
  method: z.enum(['sms', 'wx']),
  code: z.string().trim().min(1).max(64),
});

export const fetchSchema = z.object({
  token: z.string().trim().min(1).max(8192),
  branchId: optionalText,
  branchName: optionalText,
  campusId: optionalText,
  campusName: optionalText,
  modelType: z.enum(['feedback', 'tutorplan', 'evaluate_analysis', 'prepare']),
  dept: z.enum(['math', 'science', 'arts', 'all']),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  schoolYear: z.string().regex(/^d{4}-d{4}$/).optional(),
  term: z.enum(['1', '2', '3', '4']).optional(),
  examType: z.enum(['', '1', '2']).optional(),
  colType: z.enum(['course_num', 'new_stu_course_num', 'must_upload_num', 'total_must_upload_num', 'both']).optional(),
  courseTags: z.array(z.number().int().min(0).max(1000)).max(20).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.modelType === 'evaluate_analysis') {
    if (!value.schoolYear) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schoolYear'], message: '阶段评估需要学年' });
    if (!value.term) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['term'], message: '阶段评估需要学期' });
  } else {
    if (!value.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: '需要开始日期' });
    if (!value.endDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '需要结束日期' });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '结束日期不能早于开始日期' });
  }
  if (value.colType === 'both' && value.modelType !== 'evaluate_analysis') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['colType'], message: '仅阶段评估支持双口径' });
  }
});

export const fetchIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export type ValidatedFetch = z.infer<typeof fetchSchema> & { modelType: TeachingModel; dept: DepartmentKey };
