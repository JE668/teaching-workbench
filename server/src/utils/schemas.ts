import { z } from 'zod';

/**
 * 各路由的请求体 schema。
 *
 * 设计原则：
 *  - 只校验「字段存在 + 基本类型 + 非空」，不做过度强转（coerce）——
 *    sessionCount / courseType 这类字段的归一化仍交给 mappers 里的
 *    normalize* 函数，保持行为不变。
 *  - 一律 .passthrough()，保留 handler 可能用到的额外字段。
 *  - 错误信息用中文，与现有 400 提示一致。
 */

const reqd = (msg = '该项为必填项') => z.string().trim().min(1, msg);

// ============ 学生 ============
export const studentCreateSchema = z
  .object({
    name: reqd('姓名、年级、学科为必填项'),
    grade: reqd('姓名、年级、学科为必填项'),
    subject: reqd('姓名、年级、学科为必填项'),
    phone: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  })
  .passthrough();

export const studentUpdateSchema = z
  .object({
    name: z.string().trim().optional(),
    grade: z.string().trim().optional(),
    subject: z.string().trim().optional(),
    phone: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  })
  .passthrough();

// ============ 小组课分组 ============
export const groupCreateSchema = z
  .object({
    name: reqd('请填写分组名称'),
    studentIds: z.array(z.union([z.number(), z.coerce.number()])).optional(),
  })
  .passthrough();

export const groupUpdateSchema = z
  .object({
    name: z.string().trim().optional(),
    studentIds: z.array(z.union([z.number(), z.coerce.number()])).optional(),
  })
  .passthrough();

// ============ 回访（AI 生成 / 创建 / 更新） ============
// 必填的 5 个课堂信息字段（年级/学科/主题/表现/掌握程度）
export const followUpGenerateSchema = z
  .object({
    grade: reqd('年级、学科、课程主题、课堂表现、掌握程度均为必填项'),
    subject: reqd('年级、学科、课程主题、课堂表现、掌握程度均为必填项'),
    topic: reqd('年级、学科、课程主题、课堂表现、掌握程度均为必填项'),
    performance: reqd('年级、学科、课程主题、课堂表现、掌握程度均为必填项'),
    mastery: reqd('年级、学科、课程主题、课堂表现、掌握程度均为必填项'),
    // 其余字段（studentName / courseType / sessionCount / nickname / images）
    // 由 handler 里的 validateGenerateInput 做条件校验，这里不重复约束。
  })
  .passthrough();

export const followUpCreateSchema = z
  .object({
    grade: reqd('年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项'),
    subject: reqd('年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项'),
    topic: reqd('年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项'),
    performance: reqd('年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项'),
    mastery: reqd('年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项'),
    content: reqd('年级、学科、课程主题、课堂表现、掌握程度、回访内容均为必填项'),
    images: z.array(z.string()).optional(),
  })
  .passthrough();

export const followUpUpdateSchema = z
  .object({
    grade: z.string().trim().optional(),
    subject: z.string().trim().optional(),
    topic: z.string().trim().optional(),
    performance: z.string().trim().optional(),
    mastery: z.string().trim().optional(),
    content: z.string().optional(),
    images: z.array(z.string()).optional(),
    /** 小组课：true 时把本次修改同步到整批 N 条，保持一致 */
    syncBatch: z.boolean().optional(),
  })
  .passthrough();

// ============ 听评课（独立于回访） ============
export const teacherCreateSchema = z
  .object({
    name: reqd('请填写老师姓名'),
    subject: z.string().trim().optional().nullable(),
  })
  .passthrough();

export const observationCreateSchema = z
  .object({
    topic: reqd('请填写课题'),
    // courseId：故意不收窄。课题手输、目录里查不到时留空，用户填错了不该连整张评课表都存不了，
    // 所以这里先全收，交给 numOrNull 统一归一成「正整数或 null」。
    courseId: z.unknown().optional(),
    teacherId: z.union([z.number(), z.coerce.number(), z.null()]).optional(),
    lessonType: z.string().optional(),
    observedAt: z.string().trim().optional().nullable(),
    grade: z.string().trim().optional().nullable(),
    subject: z.string().trim().optional().nullable(),
    level: z.string().trim().optional().nullable(),
    studentName: z.string().trim().optional().nullable(),
    classNotes: z.string().optional(),
    overallGrade: z.string().optional().nullable(),
    status: z.string().optional(),
    teacherReply: z.string().optional(),
  })
  .passthrough();

export const observationUpdateSchema = z
  .object({
    topic: z.string().trim().optional(),
    // courseId：故意不收窄。课题手输、目录里查不到时留空，用户填错了不该连整张评课表都存不了，
    // 所以这里先全收，交给 numOrNull 统一归一成「正整数或 null」。
    courseId: z.unknown().optional(),
    teacherId: z.union([z.number(), z.coerce.number(), z.null()]).optional(),
    lessonType: z.string().optional(),
    observedAt: z.string().trim().optional().nullable(),
    grade: z.string().trim().optional().nullable(),
    subject: z.string().trim().optional().nullable(),
    level: z.string().trim().optional().nullable(),
    studentName: z.string().trim().optional().nullable(),
    classNotes: z.string().optional(),
    overallGrade: z.string().optional().nullable(),
    status: z.string().optional(),
    teacherReply: z.string().optional(),
  })
  .passthrough();

// ============ 认证 ============
export const registerSchema = z
  .object({
    username: z.string().trim().min(2, '用户名长度需在 2-32 位之间').max(32, '用户名长度需在 2-32 位之间'),
    password: z.string().min(6, '密码长度至少6位'),
  })
  .passthrough();

export const loginSchema = z
  .object({
    username: z.string().min(1, '用户名和密码为必填项'),
    password: z.string().min(1, '用户名和密码为必填项'),
  })
  .passthrough();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '请填写当前密码与新密码'),
    newPassword: z.string().min(6, '新密码长度至少 6 位'),
  })
  .passthrough();
