import { Request } from 'express';

/** 课程类型：1对1 或 小组课 */
export type CourseType = 'one_on_one' | 'group';

// 用户类型
export interface User {
  id: number;
  username: string;
  password: string;
  createdAt: string;
}

export interface UserPublic {
  id: number;
  username: string;
  createdAt: string;
}

// 学生类型
export interface Student {
  id: number;
  userId: number;
  name: string;
  grade: string;
  subject: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCreate {
  name: string;
  grade: string;
  subject: string;
  phone?: string;
  notes?: string;
}

export interface StudentUpdate {
  name?: string;
  grade?: string;
  subject?: string;
  phone?: string;
  notes?: string;
}

// 课后回访类型
export interface FollowUp {
  id: number;
  userId: number;
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
  images: string[]; // 图片路径数组（API 层已解析）
  content: string;
  wordCount: number;
  /** 小组课批次 id：同一次小组课拆出的 N 条共享；1对1 为 null */
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpCreate {
  studentId: number | null;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  performance: string;
  mastery: string;
  /** 本次回访涵盖的课次数（1-3），不传按 1 处理 */
  sessionCount?: number;
  /** 课程类型，不传按 1对1 处理 */
  courseType?: CourseType;
  /** 小组课：要归档到的多个学生 id */
  studentIds?: number[];
  /** 自定义称呼；不传则由 studentName 推导 */
  nickname?: string;
  images: string[];
  content: string;
}

// ============ 听评课（独立于课后回访） ============
/** 课型 */
export type LessonType = 'new' | 'review' | 'practice' | 'explain' | 'other';
/** 总体评价等级 */
export type OverallGrade = 'excellent' | 'good' | 'pass' | 'needs_work';

export interface Teacher {
  id: number;
  name: string;
  subject: string | null;
  createdAt: string;
}

export interface Observation {
  id: number;
  userId: number;
  teacherId: number | null;
  /** 被听课老师姓名（关联不到时回退为 '—'） */
  teacherName: string;
  /** 课题（对应 Word 表"课题"栏） */
  topic: string;
  /** 课型（对应 Word 表"课型"栏） */
  lessonType: LessonType;
  /** 听课时间（对应 Word 表"听课时间"栏） */
  observedAt: string | null;
  // —— 以下为 AI 参考输入，不出现在 Word 表 ——
  grade: string | null;
  subject: string | null;
  level: string | null;
  studentName: string | null;
  /** 听课记录 / 课堂实录（AI 评课的依据） */
  classNotes: string;
  /** AI 评课报告（8 项一句话 + 综合评价与建议） */
  report: string;
  reportAt: string | null;
  /** 总体评价等级（对应 Word 表"总体评价等级"栏） */
  overallGrade: OverallGrade | null;
  /** 状态：draft / sent(已反馈) / archived */
  status: string;
  /** 老师对评课的回应（可选，闭环用） */
  teacherReply: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObservationCreate {
  teacherId: number | null;
  topic: string;
  lessonType?: LessonType;
  observedAt?: string | null;
  grade?: string | null;
  subject?: string | null;
  level?: string | null;
  studentName?: string | null;
  classNotes?: string;
  overallGrade?: OverallGrade | null;
  status?: string;
  teacherReply?: string;
}

// 扩展 Express Request
export interface AuthenticatedRequest extends Request {
  userId?: number;
}
