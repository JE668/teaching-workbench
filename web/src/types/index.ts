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
