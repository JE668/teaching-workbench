import { Request } from 'express';

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
  images: string; // JSON array of image paths
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
  images: string[];
  content: string;
}

// 扩展 Express Request
export interface AuthenticatedRequest extends Request {
  userId?: number;
}
