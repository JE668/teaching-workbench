import { db } from '../../config/database.js';
import { getAiConfig, getSharedClient, withUserAiSlot } from '../ai/index.js';
import { recordAiMetrics } from '../aiMetrics.js';

/** 向量维度（OpenAI text-embedding-3-small 为 1536，text-embedding-ada-002 为 1536） */
export const EMBEDDING_DIM = 1536;

export class KnowledgeError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

/** 单个知识分块 */
export interface KnowledgeChunk {
  id: number;
  user_id: number;
  subject_group: string;
  source_type: 'followup' | 'report' | 'observation';
  source_id: number;
  chunk_text: string;
  embedding: Float32Array | null;
  metadata_json: string | null;
  indexed_at: string;
}

/** 搜索结果 */
export interface SearchResult {
  id: number;
  subject_group: string;
  source_type: string;
  source_id: number;
  chunk_text: string;
  metadata_json: string | null;
  similarity: number;
  indexed_at: string;
  quality_label?: string;
  quality_score?: number;
}

/** 相似学生结果 */
export interface SimilarStudentResult {
  student_id: number;
  student_name: string;
  subject_group: string;
  grade: string;
  similarity: number;
  matching_chunks: SearchResult[];
}

/** 周报摘要结果 */
export interface WeeklyDigestResult {
  subject_group: string;
  period: { start: string; end: string };
  key_topics: string[];
  teacher_insights: string[];
  common_challenges: string[];
  recommendations: string[];
}

/**
 * 生成文本嵌入向量
 * 使用 AI 配置中的模型（通常为 text-embedding-3-small 或兼容模型）
 */
export async function generateEmbedding(text: string, userId: number): Promise<Float32Array> {
  const config = getAiConfig(userId);
  const ai = getSharedClient(userId);

  const response = await ai.embeddings.create({
    model: config.embeddingModel || 'text-embedding-3-small',
    input: text.slice(0, 8000), // 限制输入长度
    encoding_format: 'float',
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Embedding generation returned empty result');
  }

  return new Float32Array(embedding);
}

/**
 * 将 Float32Array 序列化为 Buffer 存储
 */
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * 将 Buffer 反序列化为 Float32Array
 */
export function deserializeEmbedding(buffer: Buffer | Uint8Array | ArrayBuffer | null): Float32Array | null {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) {
    return new Float32Array(buffer);
  }
  if (buffer instanceof Uint8Array) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  }
  // Node.js Buffer - use buffer.buffer, buffer.byteOffset, buffer.byteLength
  const buf = buffer as any;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

type StoredChunk = Omit<KnowledgeChunk, 'embedding'> & { embedding: Buffer | null };

interface KnowledgeScope {
  mode: 'personal' | 'shared';
  groupId?: number;
  ownerWhere: string;
  ownerParams: number[];
}

/** subject_group 只用于过滤，跨用户读取必须另有当前用户已加入群组的授权。 */
function resolveKnowledgeScope(params: { userId: number; subjectGroup: string; groupId?: number }): KnowledgeScope {
  const { userId, subjectGroup, groupId } = params;
  if (groupId === undefined) {
    return { mode: 'personal', ownerWhere: 'user_id = ?', ownerParams: [userId] };
  }
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new KnowledgeError('groupId 必须是正整数');
  const membership = db.prepare(
    `SELECT g.id, g.subject_group
     FROM knowledge_groups g
     JOIN knowledge_group_members m ON m.group_id = g.id
     WHERE g.id = ? AND m.user_id = ?`
  ).get(groupId, userId) as { id: number; subject_group: string } | undefined;
  if (!membership) throw new KnowledgeError('教研组不存在或你不是该组成员', 403);
  if (membership.subject_group !== subjectGroup) throw new KnowledgeError('检索科目与教研组科目不一致', 403);
  return {
    mode: 'shared',
    groupId,
    ownerWhere: `user_id IN (
      SELECT member.user_id FROM knowledge_group_members member WHERE member.group_id = ?
    )`,
    ownerParams: [groupId],
  };
}

function clampLimit(value: number | undefined, fallback: number, maximum = 100): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toSearchResult(row: StoredChunk, similarity: number): SearchResult {
  return {
    id: row.id,
    subject_group: row.subject_group,
    source_type: row.source_type,
    source_id: row.source_id,
    chunk_text: row.chunk_text,
    metadata_json: row.metadata_json,
    similarity,
    indexed_at: row.indexed_at,
  };
}

/**
 * 语义搜索：个人模式只读本人数据，共享模式只读当前组成员数据。
 */
export async function searchKnowledge(params: {
  userId: number;
  subjectGroup: string;
  query: string;
  limit?: number;
  minSimilarity?: number;
  groupId?: number;
}): Promise<SearchResult[]> {
  const { userId, subjectGroup, query, minSimilarity = 0.65 } = params;
  const scope = resolveKnowledgeScope(params);
  const queryEmbedding = await generateEmbedding(query, userId);
  const rows = db.prepare(
    `SELECT id, user_id, subject_group, source_type, source_id, chunk_text, embedding, metadata_json, indexed_at
     FROM group_knowledge_chunks
     WHERE ${scope.ownerWhere} AND subject_group = ? AND embedding IS NOT NULL`
  ).all(...scope.ownerParams, subjectGroup) as StoredChunk[];

  const threshold = Number.isFinite(minSimilarity) ? Math.max(-1, Math.min(1, minSimilarity)) : 0.65;
  const results: SearchResult[] = [];
  for (const row of rows) {
    if (!row.chunk_text?.trim()) continue;
    const embedding = deserializeEmbedding(row.embedding);
    if (!embedding) continue;
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity >= threshold) results.push(toSearchResult(row, similarity));
  }
  results.sort((a, b) => b.similarity - a.similarity || a.id - b.id);
  return results.slice(0, clampLimit(params.limit, 10));
}

/**
 * 寻找相似学生：基于知识画像匹配
 */
export async function findSimilarStudents(params: {
  userId: number;
  subjectGroup: string;
  studentId: number;
  studentProfile: { weak_points: string[]; strong_points: string[]; learning_style: string };
  limit?: number;
  groupId?: number;
}): Promise<SimilarStudentResult[]> {
  const { userId, subjectGroup, studentId, studentProfile } = params;
  const scope = resolveKnowledgeScope(params);
  if (!Number.isSafeInteger(studentId) || studentId <= 0 || !studentProfile ||
      !Array.isArray(studentProfile.weak_points) || !Array.isArray(studentProfile.strong_points) ||
      typeof studentProfile.learning_style !== 'string') {
    throw new KnowledgeError('studentId 或 studentProfile 格式无效');
  }
  // 群组授权不能用来探测其他教师的学生 ID，目标学生仍须属于本人。
  const target = db.prepare('SELECT id FROM students WHERE id = ? AND user_id = ? AND subject = ?')
    .get(studentId, userId, subjectGroup);
  if (!target) throw new KnowledgeError('目标学生不存在或不属于当前教师', 404);

  const clean = (values: unknown[]) => values.filter((value): value is string => typeof value === 'string').slice(0, 30);
  const profileText = `学习风格: ${studentProfile.learning_style.slice(0, 500)}. 强项: ${clean(studentProfile.strong_points).join(', ')}. 弱项: ${clean(studentProfile.weak_points).join(', ')}.`;
  const queryEmbedding = await generateEmbedding(profileText, userId);
  const rows = db.prepare(
    `SELECT id, user_id, subject_group, source_type, source_id, chunk_text, embedding, metadata_json, indexed_at
     FROM group_knowledge_chunks
     WHERE ${scope.ownerWhere} AND subject_group = ? AND embedding IS NOT NULL`
  ).all(...scope.ownerParams, subjectGroup) as StoredChunk[];

  type Candidate = { row: StoredChunk; similarity: number };
  const studentMap = new Map<string, { studentId: number; ownerId: number; chunks: Candidate[] }>();
  for (const row of rows) {
    if (!row.chunk_text?.trim()) continue;
    const metadata = parseMetadata(row.metadata_json);
    const sid = Number(metadata.student_id);
    // 不再把 source_id 猜成 student_id；缺失合法关联的片段不能冒充学生证据。
    if (!Number.isSafeInteger(sid) || sid <= 0 || sid === studentId) continue;
    const embedding = deserializeEmbedding(row.embedding);
    if (!embedding) continue;
    const key = `${row.user_id}:${sid}`;
    if (!studentMap.has(key)) studentMap.set(key, { studentId: sid, ownerId: row.user_id, chunks: [] });
    studentMap.get(key)!.chunks.push({ row, similarity: cosineSimilarity(queryEmbedding, embedding) });
  }

  const results: SimilarStudentResult[] = [];
  for (const data of studentMap.values()) {
    if (!data.chunks.length) continue;
    const student = db.prepare('SELECT id, name, grade FROM students WHERE id = ? AND user_id = ? AND subject = ?')
      .get(data.studentId, data.ownerId, subjectGroup) as { id: number; name: string; grade: string } | undefined;
    if (!student) continue;
    const similarity = data.chunks.reduce((sum, item) => sum + item.similarity, 0) / data.chunks.length;
    if (similarity < 0.5) continue;
    const matching = [...data.chunks]
      .sort((a, b) => b.similarity - a.similarity || a.row.id - b.row.id)
      .slice(0, 3)
      .map(item => toSearchResult(item.row, item.similarity));
    results.push({
      student_id: student.id,
      student_name: student.name,
      subject_group: subjectGroup,
      grade: student.grade,
      similarity,
      matching_chunks: matching,
    });
  }
  results.sort((a, b) => b.similarity - a.similarity || a.student_id - b.student_id);
  return results.slice(0, clampLimit(params.limit, 5, 50));
}

function digestStrings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) throw new KnowledgeError('周报模型返回结构无效', 502);
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, maximum);
}

export function parseWeeklyDigestContent(
  content: string,
  subjectGroup: string,
  startDate: string,
  endDate: string,
): WeeklyDigestResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new KnowledgeError('周报模型未返回有效 JSON，摘要生成失败', 502);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KnowledgeError('周报模型返回结构无效', 502);
  }
  const record = value as Record<string, unknown>;
  return {
    subject_group: subjectGroup,
    period: { start: startDate, end: endDate },
    key_topics: digestStrings(record.key_topics, 5),
    teacher_insights: digestStrings(record.teacher_insights, 3),
    common_challenges: digestStrings(record.common_challenges, 3),
    recommendations: digestStrings(record.recommendations, 3),
  };
}

/**
 * 生成教研组周报摘要
 */
export async function generateWeeklyDigest(params: {
  userId: number;
  subjectGroup: string;
  startDate: string;
  endDate: string;
  groupId?: number;
}): Promise<WeeklyDigestResult> {
  const { userId, subjectGroup, startDate, endDate } = params;
  const scope = resolveKnowledgeScope(params);

  // 获取周期内的所有分块
  const rows = db.prepare(
    `SELECT chunk_text, metadata_json, source_type, source_id
     FROM group_knowledge_chunks
     WHERE ${scope.ownerWhere} AND subject_group = ?
       AND indexed_at >= ? AND indexed_at <= ?
     ORDER BY indexed_at DESC
     LIMIT 200`
  ).all(...scope.ownerParams, subjectGroup, startDate, endDate) as { chunk_text: string; metadata_json: string | null; source_type: string; source_id: number }[];

  if (rows.length === 0) {
    return {
      subject_group: subjectGroup,
      period: { start: startDate, end: endDate },
      key_topics: [],
      teacher_insights: [],
      common_challenges: [],
      recommendations: [],
    };
  }

  // 构建摘要 prompt
  const chunksText = rows.map((r, i) => `${i + 1}. [${r.source_type}#${r.source_id}] ${r.chunk_text.slice(0, 500)}`).join('\n');

  const prompt = `你是教研组助手。请基于以下 ${rows.length} 条教学片段（${startDate} 至 ${endDate}），生成一份结构化周报摘要：

[${chunksText}]

请输出 JSON 格式：
{
  "key_topics": ["本周核心教学话题 1", "话题 2", "话题 3"],
  "teacher_insights": ["教师 A 的教学心得", "教师 B 的创新做法"],
  "common_challenges": ["全组共同面临的难点 1", "难点 2"],
  "recommendations": ["建议全组采取的行动 1", "建议 2"]
}

要求：
- key_topics 最多 5 个，提炼核心知识点
- teacher_insights 最多 3 个，体现个体亮点
- common_challenges 最多 3 个，关注共性问题
- recommendations 最多 3 个，可落地执行`;

  return withUserAiSlot(userId, async () => {
    const config = getAiConfig(userId);
    const ai = getSharedClient(userId);
    const start = Date.now();

    try {
      const response = await ai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: '你是专业的教研组助手，擅长从碎片化教学记录中提炼结构化洞察。只输出 JSON，不要任何额外文字。' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = (response.choices[0]?.message?.content || '').trim();
      // 解析或结构校验失败会抛出，外层记录 error，绝不返回空数组伪装成功。
      const parsed = parseWeeklyDigestContent(content, subjectGroup, startDate, endDate);

      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint: 'weekly_digest',
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        latencyMs: Date.now() - start,
        status: 'success',
        wordCount: 0,
      });

      return parsed;
    } catch (error: any) {
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint: 'weekly_digest',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  });
}

/**
 * 获取高分范例：搜索特定主题下的优质教学片段
 */
export async function getHighQualityExamples(params: {
  userId: number;
  subjectGroup: string;
  topic: string;
  limit?: number;
  groupId?: number;
}): Promise<SearchResult[]> {
  const candidates = await searchKnowledge({
    userId: params.userId,
    subjectGroup: params.subjectGroup,
    query: params.topic,
    limit: 100,
    minSimilarity: 0.6,
    groupId: params.groupId,
  });
  const examples: SearchResult[] = [];
  for (const candidate of candidates) {
    const metadata = parseMetadata(candidate.metadata_json);
    const qualityScore = typeof metadata.quality_score === 'number' && Number.isFinite(metadata.quality_score)
      ? metadata.quality_score
      : null;
    let qualityLabel = '';
    if (metadata.overall_grade === 'excellent') qualityLabel = '听评课总体评价：优秀';
    else if (metadata.quality === 'high') qualityLabel = '显式标记：高质量';
    else if (qualityScore !== null && qualityScore >= 80 && qualityScore <= 100) {
      qualityLabel = `显式质量评分：${qualityScore}/100`;
    }
    // 语义相似度只负责候选排序，不能冒充“高分”质量证据。
    if (!qualityLabel) continue;
    examples.push({
      ...candidate,
      quality_label: qualityLabel,
      ...(qualityScore === null ? {} : { quality_score: qualityScore }),
    });
    if (examples.length >= clampLimit(params.limit, 5, 20)) break;
  }
  return examples;
}

export function getKnowledgeStats(params: { userId: number; subjectGroup: string; groupId?: number }) {
  const { subjectGroup } = params;
  const scope = resolveKnowledgeScope(params);
  const total = db.prepare(
    `SELECT COUNT(*) AS count FROM group_knowledge_chunks WHERE ${scope.ownerWhere} AND subject_group = ?`
  ).get(...scope.ownerParams, subjectGroup) as { count: number };
  const bySource = db.prepare(
    `SELECT source_type, COUNT(*) AS count FROM group_knowledge_chunks
     WHERE ${scope.ownerWhere} AND subject_group = ? GROUP BY source_type`
  ).all(...scope.ownerParams, subjectGroup) as { source_type: string; count: number }[];
  const latest = db.prepare(
    `SELECT MAX(indexed_at) AS latest FROM group_knowledge_chunks WHERE ${scope.ownerWhere} AND subject_group = ?`
  ).get(...scope.ownerParams, subjectGroup) as { latest: string | null };
  const uniqueStudents = db.prepare(
    `SELECT COUNT(DISTINCT CASE WHEN json_valid(metadata_json)
       THEN json_extract(metadata_json, '$.student_id') END) AS count
     FROM group_knowledge_chunks WHERE ${scope.ownerWhere} AND subject_group = ? AND metadata_json IS NOT NULL`
  ).get(...scope.ownerParams, subjectGroup) as { count: number };
  return {
    subject_group: subjectGroup,
    scope: scope.mode,
    ...(scope.groupId === undefined ? {} : { group_id: scope.groupId }),
    total_chunks: total.count,
    by_source_type: bySource,
    latest_indexed: latest.latest,
    unique_students: uniqueStudents.count,
  };
}
