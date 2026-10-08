import { Student, FollowUp, UserPublic } from '../types/index.js';

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
    images: parseImages(row.images),
    content: row.content,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFollowUps(rows: any[]): FollowUp[] {
  return rows.map(mapFollowUp);
}

/** 课次数归一化：非法/缺失一律按 1 处理，并限制在 1-3 */
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
