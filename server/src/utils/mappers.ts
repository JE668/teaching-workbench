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
    module: normalizeFollowUpModules(row.module)[0],
    modules: normalizeFollowUpModules(row.module),
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
  'preview',
  'homework_review',
  'class_content',
  'class_performance',
  'note_trace',
  'mistake_drill',
  'homework_assign',
  'accumulation',
  'exam_prep',
  'grade_analysis',
  'stage_test',
  'plan_adjust',
  'student_request',
  'academic_assist',
  'extra_class',
  'makeup_plan',
];

export const DEFAULT_FOLLOWUP_MODULE: FollowUpModule = 'class_content';

/**
 * 拆「课堂总结」之前的老值。DB 默认值和存量数据里都是 `class_summary`，
 * 这里把它映射到新值，避免动 database.ts 的 schema 默认值（改默认值对存量列无效）。
 */
const LEGACY_FOLLOWUP_MODULE: Partial<Record<string, FollowUpModule>> = {
  class_summary: 'class_content',
};

export function normalizeFollowUpModule(value: any): FollowUpModule {
  if (FOLLOWUP_MODULES.includes(value)) return value;
  if (typeof value === 'string' && LEGACY_FOLLOWUP_MODULE[value]) {
    return LEGACY_FOLLOWUP_MODULE[value]!;
  }
  return DEFAULT_FOLLOWUP_MODULE;
}

/**
 * 本次回访覆盖的板块清单归一化。
 * 列里存的是 JSON 数组串（如 '["preview","class_summary"]'），
 * 存量数据是单个模块串（'class_summary'），也兼容直接传数组。
 * 非法值**直接丢弃**（不回落默认值，否则一个乱值会凭空多出一个板块），
 * 全部丢弃后才回落单板块课堂总结。
 */
export function normalizeFollowUpModules(value: any): FollowUpModule[] {
  let raw: any = value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = undefined;
    }
  }
  const arr: any[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  // 先过一遍老值映射，再判合法——否则 JSON 数组里的 class_summary 会被当乱值丢掉
  const migrated = arr.map((v) =>
    typeof v === 'string' && LEGACY_FOLLOWUP_MODULE[v] ? LEGACY_FOLLOWUP_MODULE[v] : v
  );
  const valid = migrated.filter(
    (m): m is FollowUpModule => typeof m === 'string' && FOLLOWUP_MODULES.includes(m as FollowUpModule)
  );
  const deduped = valid.filter((m, i, a) => a.indexOf(m) === i);
  return deduped.length > 0 ? deduped : [DEFAULT_FOLLOWUP_MODULE];
}

/** 板块清单序列化落库 */
export function serializeFollowUpModules(modules: FollowUpModule[]): string {
  return JSON.stringify(modules);
}

/**
 * 打卡类型的分组元信息（后端只用于统计，文案在前端 FOLLOWUP_MODULE_GROUPS）。
 * 常规类 9 种是日常回访的主体；非常规类 7 种是特殊情况的沟通。
 * 板块命名：class_content 现叫「课程主题」，class_performance 现叫「课堂总结」（内容 + 表现的综合）。
 */
export const FOLLOWUP_TYPES: { value: FollowUpModule; label: string; group: 'regular' | 'unusual' }[] = [
  { value: 'preview', label: '预习资料', group: 'regular' },
  { value: 'homework_review', label: '作业批改', group: 'regular' },
  { value: 'class_content', label: '课程主题', group: 'regular' },
  { value: 'class_performance', label: '课堂总结', group: 'regular' },
  { value: 'note_trace', label: '笔记/解题痕迹', group: 'regular' },
  { value: 'mistake_drill', label: '错题专练', group: 'regular' },
  { value: 'homework_assign', label: '作业布置', group: 'regular' },
  { value: 'accumulation', label: '积累打卡', group: 'regular' },
  { value: 'exam_prep', label: '备考资料', group: 'regular' },
  { value: 'grade_analysis', label: '成绩分析', group: 'unusual' },
  { value: 'stage_test', label: '阶测反馈', group: 'unusual' },
  { value: 'plan_adjust', label: '规划调整', group: 'unusual' },
  { value: 'student_request', label: '学生要求', group: 'unusual' },
  { value: 'academic_assist', label: '学管协助', group: 'unusual' },
  { value: 'extra_class', label: '加课沟通', group: 'unusual' },
  { value: 'makeup_plan', label: '补课安排', group: 'unusual' },
];

/**
 * 每周流程打卡的配额：覆盖 5 种以上打卡类型即达标。
 * 常规类与非常规类**合并**统计——任何 5 种各打过一次就算达标。
 * 不写成常量推导：常规类现在是 8 种，从分组数量推导会得到 8，与学校的 5 项不符。
 */
// 「每周 5 项流程打卡」是学校的口径要求，已在表单侧用软提示实现
// （少于 5 个板块照常生成，只 toast 提醒）。看板不再按周统计覆盖率，
// 所以这里不再导出周配额常量。

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
