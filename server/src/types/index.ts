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

// 扩展 Express Request
export interface AuthenticatedRequest extends Request {
  userId?: number;
}
