import { Student, FollowUp, UserPublic, Teacher, Observation, FollowUpModule } from '../types/index.js';

/**
 * 数据库行 (snake_case) → API 响应 (camelCase)
 * 统一前后端字段命名契约，避免前端拿到 undefined
 */

export function mapUser(row: any): UserPublic {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
  };
}

export function mapStudent(row: any): Student {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    grade: row.grade,
    subject: row.subject,
    phone: row.phone ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapStudents(rows: any[]): Student[] {
  return rows.map(mapStudent);
}

export function mapFollowUp(row: any): FollowUp {
  return {
    id: row.id,
    userId: row.user_id,
    studentId: row.student_id ?? null,
    studentName: row.student_name,
    grade: row.grade,
    subject: row.subject,
    topic: row.topic,
    performance: row.performance,
    mastery: row.mastery,
    sessionCount: normalizeSessionCount(row.session_count),
    courseType: normalizeCourseType(row.course_type),
    module: normalizeFollowUpModule(row.module),
    images: parseImages(row.images),
    content: row.content,
    wordCount: row.word_count,
    batchId: row.batch_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFollowUps(rows: any[]): FollowUp[] {
  return rows.map(mapFollowUp);
}

/** 课次数归一化：非法/缺失一律按 1 处理，并限制在 1-3 */
/** 课程类型归一化：非法值一律按 1对1 处理 */
export function normalizeCourseType(value: any): 'one_on_one' | 'group' {
  return value === 'group' ? 'group' : 'one_on_one';
}

/**
 * 流程打卡类型归一化。非法/缺失一律按「课堂总结」处理——
 * 这是存量数据（module 列新增前的记录）的默认归类，也符合「常规类」里最常用的打卡场景。
 */
export const FOLLOWUP_MODULES: FollowUpModule[] = [
  'class_summary',
  'first_lesson',
  'preview',
  'homework_review',
  'mistake_drill',
  'grade_analysis',
  'stage_test',
  'makeup_plan',
];

export const DEFAULT_FOLLOWUP_MODULE: FollowUpModule = 'class_summary';

export function normalizeFollowUpModule(value: any): FollowUpModule {
  return FOLLOWUP_MODULES.includes(value) ? value : DEFAULT_FOLLOWUP_MODULE;
}

/**
 * 打卡类型的分组元信息（后端只用于统计，文案在前端 FOLLOWUP_MODULE_GROUPS）。
 * 常规类 5 种是每周的配额分母；非常规类按需打卡，不计入配额。
 */
export const FOLLOWUP_TYPES: { value: FollowUpModule; label: string; group: 'regular' | 'unusual' }[] = [
  { value: 'class_summary', label: '课堂总结', group: 'regular' },
  { value: 'first_lesson', label: '新生首课', group: 'regular' },
  { value: 'preview', label: '预习资料', group: 'regular' },
  { value: 'homework_review', label: '作业批改', group: 'regular' },
  { value: 'mistake_drill', label: '错题专练', group: 'regular' },
  { value: 'grade_analysis', label: '成绩分析', group: 'unusual' },
  { value: 'stage_test', label: '阶测反馈', group: 'unusual' },
  { value: 'makeup_plan', label: '补课安排', group: 'unusual' },
];

/** 每周流程打卡的配额：常规类共 5 种，全部覆盖即为达标 */
export const WEEKLY_FOLLOWUP_QUOTA = FOLLOWUP_TYPES.filter((t) => t.group === 'regular').length;

export function normalizeSessionCount(value: any): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, n));
}

/** 安全解析 images 字段（数据库存 JSON 字符串，可能为空或损坏） */
export function parseImages(value: any): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ============ 听评课 ============

/** 课型：代码 → 中文（对应 Word 表"课型"栏） */
export const LESSON_TYPE_LABELS: Record<string, string> = {
  new: '新授课',
  review: '复习课',
  practice: '练习课',
  explain: '讲评课',
  other: '其他',
};

/** 总体评价等级：代码 → 中文（对应 Word 表"总体评价等级"栏） */
export const OVERALL_GRADE_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  pass: '合格',
  needs_work: '有待提高',
};

export function normalizeLessonType(value: any): 'new' | 'review' | 'practice' | 'explain' | 'other' {
  return value === 'new' || value === 'review' || value === 'practice' || value === 'explain'
    ? value
    : 'other';
}

export function normalizeOverallGrade(value: any): 'excellent' | 'good' | 'pass' | 'needs_work' | null {
  return value === 'excellent' || value === 'good' || value === 'pass' || value === 'needs_work'
    ? value
    : null;
}

export function mapTeacher(row: any): Teacher {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject ?? null,
    createdAt: row.created_at,
  };
}

export function mapTeachers(rows: any[]): Teacher[] {
  return rows.map(mapTeacher);
}

/**
 * 可空 id 入参 → 正整数或 null。
 *
 * course_id 走这条口径：0 / 负数 / 小数 / 'abc' / '' / null 全落 null，
 * 不把脏值写进库。目录课时的 id 是目录自己的主键，跨用户传同一个值也没意义，
 * 所以只校验「是不是合法正整数」，不校验归属。
 */
export function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function mapObservation(row: any, teacherName?: string | null): Observation {
  return {
    id: row.id,
    userId: row.user_id,
    teacherId: row.teacher_id ?? null,
    teacherName: teacherName ?? '—',
    topic: row.topic,
    courseId: numOrNull(row.course_id),
    lessonType: normalizeLessonType(row.lesson_type),
    observedAt: row.observed_at ?? null,
    grade: row.grade ?? null,
    subject: row.subject ?? null,
    level: row.level ?? null,
    studentName: row.student_name ?? null,
    classNotes: row.class_notes ?? '',
    report: row.report ?? '',
    reportAt: row.report_at ?? null,
    overallGrade: normalizeOverallGrade(row.overall_grade),
    status: row.status || 'draft',
    teacherReply: row.teacher_reply ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapObservations(rows: any[]): Observation[] {
  return rows.map((r) => mapObservation(r, r.teacher_name ?? null));
}
