/**
 * 知识图谱服务：从文本/图片中抽取知识点，维护 mastery 动态更新
 */
import { db } from '../../config/database.js';
import { getClient, getAiConfig, withUserAiSlot } from '../ai/index.js';
import { recordAiMetrics } from '../aiMetrics.js';

/**
 * 知识点类别枚举
 */
export type KnowledgePointCategory = 'concept' | 'skill' | 'method' | 'habit';

/**
 * 单个知识点抽取结果
 */
export interface ExtractedKnowledgePoint {
  point_name: string;
  point_category: KnowledgePointCategory;
  evidence: string;
  confidence: number;
  mastery_delta?: number;
}

/**
 * 知识点抽取完整结果
 */
export interface KnowledgeExtractionResult {
  points: ExtractedKnowledgePoint[];
  student_id: number;
  subject: string;
  grade: string;
}

/**
 * JSON Schema：引导模型输出结构化知识点
 */
export const KNOWLEDGE_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point_name: { type: 'string', description: '标准化知识点名称，如：分数通分、一元一次方程求解、读书笔记摘录法' },
          point_category: { type: 'string', enum: ['concept', 'skill', 'method', 'habit'], description: '知识点类别' },
          evidence: { type: 'string', description: '原文片段或图片索引，用于溯源' },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: '抽取置信度' },
          mastery_delta: { type: 'number', minimum: -1, maximum: 1, description: '推测的 mastery 变化，正=掌握增强，负=暴露薄弱' },
        },
        required: ['point_name', 'point_category', 'evidence', 'confidence'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 20,
    },
  },
  required: ['points'],
  additionalProperties: false,
};

/**
 * 构建知识点抽取 prompt
 */
export function buildKnowledgeExtractionPrompt(params: {
  text?: string;
  images?: string[];
  studentName: string;
  subject: string;
  grade: string;
  context?: string;
}): string {
  const { text, images, studentName, subject, grade, context } = params;

  let prompt = `你是一位专业的${subject}学科教研员。请从${context || '教学材料'}中为学生 ${studentName}（${grade}，${subject}）抽取结构化知识点。

`;

  if (text) {
    prompt += `【文本内容】
${text}

`;
  }

  if (images && images.length > 0) {
    prompt += `【上传图片】共 ${images.length} 张，请仔细观察每张图片中的题目、作答、批改痕迹、板书笔记等信息。

`;
  }

  prompt += `请识别以下四类知识点：
1. concept（概念类）：定义、性质、公式、定理、核心概念
2. skill（技能类）：解题技巧、运算能力、作图能力、实验操作
3. method（方法类）：解题路径、思维模型、归纳总结法、错因分析法
4. habit（习惯类）：书写规范、审题习惯、检查习惯、时间管理

输出要求：
- 每个知识点给出标准化名称（便于跨月聚合）、类别、证据片段、置信度、mastery_delta
- mastery_delta：正值表示该次材料体现学生已掌握/进步，负值表示暴露薄弱/失分
- 去重：同一知识点在多处出现只输出一次，取最高置信度，合并证据
- 最多输出 20 个知识点，按置信度降序

示例输出：
{
  "points": [
    {
      "point_name": "分数通分",
      "point_category": "skill",
      "evidence": "第3题通分时漏乘分子，导致结果错误",
      "confidence": 0.92,
      "mastery_delta": -0.3
    },
    {
      "point_name": "应用题建模",
      "point_category": "method",
      "evidence": "第5题未建立等量关系直接列式，步骤跳跃",
      "confidence": 0.85,
      "mastery_delta": -0.2
    },
    {
      "point_name": "书写规范",
      "point_category": "habit",
      "evidence": "卷面整洁，步骤清晰，单位齐全",
      "confidence": 0.9,
      "mastery_delta": 0.1
    }
  ]
}`;

  return prompt;
}

/**
 * 调用模型抽取知识点
 */
export async function extractKnowledgePoints(params: {
  text?: string;
  images?: string[];
  studentName: string;
  subject: string;
  grade: string;
  context?: string;
}): Promise<KnowledgeExtractionResult> {
  // 使用 withUserAiSlot 保证并发控制
  return withUserAiSlot(0, async () => { // userId 为 0 表示无特定用户上下文
    const config = getAiConfig(0);
    const ai = getClient(0, config);
    const start = Date.now();
    let response;
    try {
      // 构建用户内容（复用 multimodal 的逻辑，但不需要 OCR 等额外处理）
      const userContent: any[] = [{ type: 'text', text: buildKnowledgeExtractionPrompt(params) }];

      if (params.images && params.images.length > 0) {
        for (const imagePath of params.images) {
          try {
            userContent.push({
              type: 'image_url',
              image_url: { url: imagePath }, // 简化处理，实际可能需要转 base64
            });
          } catch (error: any) {
            console.warn({ image: imagePath, err: error.message }, '图片加载失败');
          }
        }
      }

      response = await ai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: '你是专业的学科教研员，擅长从教学材料中抽取结构化知识点。只输出 JSON，不要任何额外文字。' },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'knowledge_extraction', schema: KNOWLEDGE_EXTRACTION_SCHEMA, strict: true } },
        temperature: 0.2,
        max_tokens: 3000,
      });

      const content = (response.choices[0]?.message?.content || '').trim();
      // 简单解析 JSON
      let parsed: { points: ExtractedKnowledgePoint[] } = { points: [] };
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { points: [] };
      }

      await recordAiMetrics({
        userId: 0,
        provider: config.provider,
        model: config.model,
        endpoint: 'knowledge_extraction',
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        latencyMs: Date.now() - start,
        status: 'success',
        wordCount: 0,
      });

      return {
        points: parsed.points || [],
        student_id: 0,
        subject: params.subject,
        grade: params.grade,
      };
    } catch (error: any) {
      await recordAiMetrics({
        userId: 0,
        provider: config.provider,
        model: config.model,
        endpoint: 'knowledge_extraction',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  });
}

/**
 * 将抽取的知识点写入数据库，更新 mastery_level
 */
export async function upsertKnowledgePoints(
  userId: number,
  studentId: number,
  subject: string,
  grade: string,
  points: ExtractedKnowledgePoint[],
  reportId?: number
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const point of points) {
    if (point.confidence < 0.6) continue;

    const existing = db.prepare(
      `SELECT id, mastery_level, evidence_count FROM knowledge_points
       WHERE user_id = ? AND student_id = ? AND subject = ? AND point_name = ?`
    ).get(userId, studentId, subject, point.point_name) as
      | { id: number; mastery_level: number; evidence_count: number }
      | undefined;

    const newMastery = Math.max(0, Math.min(1, (existing?.mastery_level || 0) + (point.mastery_delta || 0)));
    const newCount = (existing?.evidence_count || 0) + 1;
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (existing) {
      db.prepare(
        `UPDATE knowledge_points SET mastery_level = ?, evidence_count = ?, last_seen_at = ? WHERE id = ?`
      ).run(newMastery, newCount, now, existing.id);
      updated++;

      if (reportId) {
        db.prepare(
          `INSERT OR REPLACE INTO report_knowledge_points (report_id, point_id, delta, evidence)
           VALUES (?, ?, ?, ?)`
        ).run(reportId, existing.id, point.mastery_delta || 0, point.evidence);
      }
    } else {
      const result = db.prepare(
        `INSERT INTO knowledge_points (user_id, student_id, subject, grade, point_name, point_category, mastery_level, evidence_count, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(userId, studentId, subject, grade, point.point_name, point.point_category, newMastery, 1, now);
      created++;

      if (reportId) {
        db.prepare(
          `INSERT OR REPLACE INTO report_knowledge_points (report_id, point_id, delta, evidence)
           VALUES (?, ?, ?, ?)`
        ).run(reportId, result.lastInsertRowid, point.mastery_delta || 0, point.evidence);
      }
    }
  }

  return { created, updated };
}

/**
 * 获取学生的知识雷达数据：按类别聚合 mastery
 */
export async function getKnowledgeRadar(userId: number, studentId: number, subject: string): Promise<{
  concept: { name: string; mastery: number }[];
  skill: { name: string; mastery: number }[];
  method: { name: string; mastery: number }[];
  habit: { name: string; mastery: number }[];
}> {
  const rows = db.prepare(
    `SELECT point_name, point_category, mastery_level
     FROM knowledge_points
     WHERE user_id = ? AND student_id = ? AND subject = ?
     ORDER BY mastery_level DESC`
  ).all(userId, studentId, subject) as { point_name: string; point_category: KnowledgePointCategory; mastery_level: number }[];

  const result = {
    concept: [] as { name: string; mastery: number }[],
    skill: [] as { name: string; mastery: number }[],
    method: [] as { name: string; mastery: number }[],
    habit: [] as { name: string; mastery: number }[],
  };

  for (const row of rows) {
    const cat = row.point_category;
    if (cat in result) {
      (result[cat] as { name: string; mastery: number }[]).push({ name: row.point_name, mastery: row.mastery_level });
    }
  }

  for (const cat of ['concept', 'skill', 'method', 'habit'] as KnowledgePointCategory[]) {
    result[cat] = result[cat].slice(0, 8);
  }

  return result;
}

/**
 * 获取薄弱点 Top N（mastery 最低且 evidence_count > 0）
 */
export async function getWeakPoints(
  userId: number,
  studentId: number,
  subject: string,
  limit = 5
): Promise<{ point_name: string; point_category: KnowledgePointCategory; mastery_level: number; evidence_count: number }[]> {
  return db.prepare(
    `SELECT point_name, point_category, mastery_level, evidence_count
     FROM knowledge_points
     WHERE user_id = ? AND student_id = ? AND subject = ? AND evidence_count > 0
     ORDER BY mastery_level ASC, evidence_count DESC
     LIMIT ?`
  ).all(userId, studentId, subject, limit) as { point_name: string; point_category: KnowledgePointCategory; mastery_level: number; evidence_count: number }[];
}

/**
 * 基于薄弱点推荐补缺题目（从 course_catalog 匹配）
 */
export async function recommendRemedialExercises(
  userId: number,
  studentId: number,
  subject: string,
  limit = 10
): Promise<{ id: number; content: string; band: string; track: string; seq: number }[]> {
  const weakPoints = await getWeakPoints(userId, studentId, subject, 5);
  if (weakPoints.length === 0) return [];

  const results = [] as { id: number; content: string; band: string; track: string; seq: number }[];

  for (const wp of weakPoints) {
    const matched = db.prepare(
      `SELECT id, content, band, track, seq
       FROM course_catalog
       WHERE user_id = ? AND subject = ?
         AND (content LIKE ? OR band LIKE ? OR track LIKE ?)
       ORDER BY seq
       LIMIT 3`
    ).all(userId, subject, `%${wp.point_name}%`, `%${wp.point_name}%`, `%${wp.point_name}%`) as { id: number; content: string; band: string; track: string; seq: number }[];

    results.push(...matched);
    if (results.length >= limit) break;
  }

  const seen = new Set<number>();
  return results.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).slice(0, limit);
}
