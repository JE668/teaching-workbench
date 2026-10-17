// 用户类型
export interface User {
  id: number;
  username: string;
  createdAt: string;
}

// 学生类型
export interface Student {
  id: number;
  name: string;
  grade: string;
  subject: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// 回访类型
export interface FollowUp {
  id: number;
  studentId: number | null;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  /** 本次回访涵盖的课次数（1-3） */
  sessionCount: number;
  /** 课程类型：1对1 或 小组课 */
  courseType: CourseType;
  images: string[];
  content: string;
  wordCount: number;
  /** 小组课批次 id：同一次小组课拆出的 N 条共享；1对1 为 null */
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
}

// 学生年级列表
export const GRADES = [
  '幼儿园',
  '小学一年级',
  '小学二年级',
  '小学三年级',
  '小学四年级',
  '小学五年级',
  '小学六年级',
  '初一',
  '初二',
  '初三',
  '高一',
  '高二',
  '高三',
];

// 学科列表
export const SUBJECTS = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '历史',
  '地理',
  '政治',
  '科学',
  '编程',
  '其他',
];

// 课程类型
export type CourseType = 'one_on_one' | 'group';

export const COURSE_TYPES: { value: CourseType; label: string; hint: string }[] = [
  { value: 'one_on_one', label: '1对1', hint: '面向单个学生，文案中会使用学生称呼' },
  { value: 'group', label: '小组课', hint: '面向全班，文案不含任何学生姓名，可同时归档给多名学生' },
];

// 单次回访可涵盖的课次数
export const SESSION_COUNTS = [1, 2, 3];

// 掌握程度列表
export const MASTERY_LEVELS = [
  { value: 'excellent', label: '优秀' },
  { value: 'good', label: '良好' },
  { value: 'average', label: '一般' },
  { value: 'needs_improvement', label: '需加强' },
];

// ============ 听评课（独立于课后回访） ============
export type LessonType = 'new' | 'review' | 'practice' | 'explain' | 'other';
export type OverallGrade = 'excellent' | 'good' | 'pass' | 'needs_work';

/** 课型（对应 Word 表"课型"栏） */
export const LESSON_TYPES: { value: LessonType; label: string }[] = [
  { value: 'new', label: '新授课' },
  { value: 'review', label: '复习课' },
  { value: 'practice', label: '练习课' },
  { value: 'explain', label: '讲评课' },
  { value: 'other', label: '其他' },
];

/** 总体评价等级（对应 Word 表"总体评价等级"栏） */
export const OVERALL_GRADES: { value: OverallGrade; label: string }[] = [
  { value: 'excellent', label: '优秀' },
  { value: 'good', label: '良好' },
  { value: 'pass', label: '合格' },
  { value: 'needs_work', label: '有待提高' },
];

export const OBSERVATION_STATUS: { value: string; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'sent', label: '已反馈' },
  { value: 'archived', label: '已归档' },
];

export interface Teacher {
  id: number;
  name: string;
  subject: string | null;
  createdAt: string;
}

export interface Observation {
  id: number;
  teacherId: number | null;
  /** 被听课老师姓名（关联不到时为 "—"） */
  teacherName: string;
  /** 课题 */
  topic: string;
  lessonType: LessonType;
  /** 听课时间 */
  observedAt: string | null;
  // 以下为 AI 参考输入（不进 Word 表）
  grade: string | null;
  subject: string | null;
  level: string | null;
  studentName: string | null;
  /** 听课记录 / 课堂实录（AI 评课依据） */
  classNotes: string;
  /** AI 评课报告（8 项一句话 + 综合评价与建议） */
  report: string;
  reportAt: string | null;
  /** 总体评价等级 */
  overallGrade: OverallGrade | null;
  /** draft / sent / archived */
  status: string;
  /** 老师对评课的回应（可选） */
  teacherReply: string;
  createdAt: string;
  updatedAt: string;
}

export function lessonTypeLabel(v: string): string {
  return LESSON_TYPES.find((x) => x.value === v)?.label ?? '其他';
}
export function overallGradeLabel(v: string | null): string {
  if (!v) return '';
  return OVERALL_GRADES.find((x) => x.value === v)?.label ?? '';
}

/** 按被听课老师聚合的统计（老师统计看板用） */
export interface TeacherStat {
  teacherId: number;
  teacherName: string;
  subject: string | null;
  obsCount: number;
  lastObservedAt: string | null;
  grades: {
    excellent: number;
    good: number;
    pass: number;
    needs_work: number;
    ungraded: number;
  };
}
