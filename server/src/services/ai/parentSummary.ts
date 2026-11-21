import { db } from '../../config/database.js';
import { getAiConfig, getSharedClient, withUserAiSlot } from '../ai/index.js';
import { recordAiMetrics } from '../aiMetrics.js';
import { recordChangeEvent } from '../content/references.js';
import crypto from 'crypto';

/** 家长视图结构 */
export interface ParentViewData {
  key_progress: string[];
  focus_areas: string[];
  action_for_parent: string;
  teacher_note: string;
}

/** 生成家长视图的源数据 */
interface ParentViewSourceData {
  type: 'followup' | 'report';
  id: number;
  studentName: string;
  subject: string;
  content: string;
  structuredData?: {
    knowledge_gain?: string;
    class_performance?: string;
    homework_assign?: string;
    next_plan?: string;
    teacher_remark?: string;
  };
  createdAt: string;
}

/**
 * 生成家长版结构化摘要
 * 将专业教学记录转换为家长易懂的关键进展、关注点、行动建议
 */
export async function generateParentView(
  userId: number,
  sourceType: 'followup' | 'report',
  sourceId: number
): Promise<ParentViewData> {
  // 1. 获取源数据
  const sourceData = await getSourceData(userId, sourceType, sourceId);
  if (!sourceData) {
    throw new Error('Source data not found');
  }

  // 2. 构建 prompt
  const prompt = buildParentViewPrompt(sourceData);

  // 3. 调用 LLM 生成家长视图（走 background 队列）
  const viewData = await withUserAiSlot(userId, async () => {
    const config = getAiConfig(userId);
    const ai = getSharedClient(userId);
    const start = Date.now();

    try {
      const response = await ai.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: `你是一位专业的1对1教育咨询师，擅长将教学专业记录转化为家长易懂的结构化摘要。

输出要求：
- 只输出 JSON，不要任何额外文字
- key_progress: 恰好 3 条具体的进展点（用"已/已掌握/已提升"等结果导向语言）
- focus_areas: 恰好 2 条需要家长重点配合的领域（具体可执行，避免模糊词汇）
- action_for_parent: 1 条下周关注与家庭行动（含具体教材页码/练习册/时间节点；源数据没有页码时不得编造）
- teacher_note: 1 句温暖鼓励的话（体现老师对学生的关注）`
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 800,
      });

      const content = (response.choices[0]?.message?.content || '').trim();
      let parsed: ParentViewData;

      try {
        parsed = normalizeParentViewData(JSON.parse(content), sourceData);
      } catch {
        // 兜底解析
        parsed = getFallbackParentView(sourceData);
      }

      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint: 'parent_view',
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        latencyMs: Date.now() - start,
        status: 'success',
        wordCount: content.length,
      });

      return parsed;
    } catch (error: any) {
      await recordAiMetrics({
        userId,
        provider: config.provider,
        model: config.model,
        endpoint: 'parent_view',
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  });

  return viewData;
}

/** 获取源数据（回访或月报） */
async function getSourceData(
  userId: number,
  sourceType: 'followup' | 'report',
  sourceId: number
): Promise<ParentViewSourceData | null> {
  if (sourceType === 'followup') {
    const row = db.prepare(
      `SELECT f.*, s.name as student_name
       FROM followups f
       JOIN students s ON f.student_id = s.id
       WHERE f.id = ? AND f.user_id = ?`
    ).get(sourceId, userId) as any;

    if (!row) return null;

    return {
      type: 'followup',
      id: row.id,
      studentName: row.student_name,
      subject: row.subject || '',
      content: row.content || '',
      structuredData: {
        knowledge_gain: row.knowledge_gain,
        class_performance: row.class_performance,
        homework_assign: row.homework_assign,
        next_plan: row.next_plan,
        teacher_remark: row.teacher_remark,
      },
      createdAt: row.created_at,
    };
  } else {
    const row = db.prepare(
      `SELECT r.*, s.name as student_name
       FROM monthly_reports r
       JOIN students s ON r.student_id = s.id
       WHERE r.id = ? AND r.user_id = ?`
    ).get(sourceId, userId) as any;

    if (!row) return null;

    // 获取报告条目
    const items = db.prepare(
      `SELECT kind, content FROM report_items WHERE report_id = ? ORDER BY sort, seq, id`
    ).all(sourceId) as { kind: string; content: string }[];

    const summaryItems = items.filter(i => i.kind === 'summary').map(i => i.content).join('\n');
    const planItems = items.filter(i => i.kind === 'plan').map(i => i.content).join('\n');
    const examItems = items.filter(i => i.kind === 'exam').map(i => i.content).join('\n');

    return {
      type: 'report',
      id: row.id,
      studentName: row.student_name,
      subject: row.subject || '',
      content: `【总结】\n${summaryItems}\n\n【规划】\n${planItems}\n\n【阶测】\n${examItems}`,
      structuredData: undefined,
      createdAt: row.created_at,
    };
  }
}

/** 构建生成家长视图的 prompt */
function buildParentViewPrompt(data: ParentViewSourceData): string {
  const typeLabel = data.type === 'followup' ? '课后回访' : '月度总结规划';
  const structured = data.structuredData
    ? `
【结构化板块】
- 知识收获: ${data.structuredData.knowledge_gain || '无'}
- 课堂表现: ${data.structuredData.class_performance || '无'}
- 作业布置: ${data.structuredData.homework_assign || '无'}
- 下步计划: ${data.structuredData.next_plan || '无'}
- 教师评价: ${data.structuredData.teacher_remark || '无'}
`
    : '';

  return `请基于以下 ${typeLabel} 记录，为学生 ${data.studentName} (${data.subject}) 生成家长版结构化摘要：

${structured}

【原文内容】
${data.content.slice(0, 3000)}

要求输出 JSON：
{
  "key_progress": ["进展点1（具体结果）", "进展点2", "进展点3"],
  "focus_areas": ["关注领域1（具体可执行）", "关注领域2"],
  "action_for_parent": "下周请监督完成《具体教材/练习册》第X-Y页，周X前完成；无来源页码时不要编造",
  "teacher_note": "一句温暖鼓励的话，体现老师关注"
}

约束：
- key_progress 必须是具体结果（如"第3题通分漏乘分子→已纠正"），避免"有进步"等空话
- focus_areas 必须具体到知识点/习惯/技能（如"应用题建模仍需练习"）
- action_for_parent 是唯一的下周关注事项，必须可落地执行；源数据提供教材页码时才引用，禁止编造
- teacher_note 温暖、具体、有个性`;
}

/**
 * 对模型输出做确定性规则校验：3 条进步、2 条重点配合、1 条下周关注。
 * 缺项、类型错误或空内容时整体回退，避免把半份摘要推送给家长。
 */
export function normalizeParentViewData(value: unknown, data: ParentViewSourceData): ParentViewData {
  if (!value || typeof value !== 'object') return getFallbackParentView(data);
  const candidate = value as Record<string, unknown>;
  const cleanList = (input: unknown, count: number): string[] | null => {
    if (!Array.isArray(input)) return null;
    const items = input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 300))
      .filter(Boolean);
    return items.length >= count ? items.slice(0, count) : null;
  };
  const keyProgress = cleanList(candidate.key_progress, 3);
  const focusAreas = cleanList(candidate.focus_areas, 2);
  const action = typeof candidate.action_for_parent === 'string'
    ? candidate.action_for_parent.trim().slice(0, 600)
    : '';
  const teacherNote = typeof candidate.teacher_note === 'string'
    ? candidate.teacher_note.trim().slice(0, 300)
    : '';
  if (!keyProgress || !focusAreas || !action || !teacherNote) {
    return getFallbackParentView(data);
  }
  return {
    key_progress: keyProgress,
    focus_areas: focusAreas,
    action_for_parent: action,
    teacher_note: teacherNote,
  };
}

/** 兜底家长视图 */
function getFallbackParentView(data: ParentViewSourceData): ParentViewData {
  return {
    key_progress: ['本周完成既定学习任务', '作业按时提交', '课堂专注度良好'],
    focus_areas: ['继续巩固基础知识', '培养独立检查习惯'],
    action_for_parent: '下周请监督完成日常作业，周五前检查错题整理',
    teacher_note: data.studentName + '本周表现稳定，继续加油！',
  };
}

/** 创建或更新家长视图（含生成 access_token） */
export async function createOrUpdateParentView(
  userId: number,
  sourceType: 'followup' | 'report',
  sourceId: number,
  viewData: ParentViewData,
  expiresDays: number = 30
): Promise<{ id: number; accessToken: string }> {
  const accessToken = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();

  const existing = db.prepare(
    'SELECT id FROM parent_views WHERE user_id = ? AND source_type = ? AND source_id = ?'
  ).get(userId, sourceType, sourceId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE parent_views SET view_json = ?, access_token = ?, expires_at = ?, read_at = NULL, parent_feedback = NULL
       WHERE id = ?`
    ).run(JSON.stringify(viewData), accessToken, expiresAt, existing.id);
    return { id: existing.id, accessToken };
  } else {
    const result = db.prepare(
      `INSERT INTO parent_views (user_id, source_type, source_id, view_json, access_token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, sourceType, sourceId, JSON.stringify(viewData), accessToken, expiresAt);
    return { id: Number(result.lastInsertRowid), accessToken };
  }
}

/** 通过 access_token 获取家长视图（无需登录） */
export async function getParentViewByToken(accessToken: string): Promise<{
  viewData: ParentViewData;
  sourceType: string;
  sourceId: number;
  studentName: string;
  subject: string;
  createdAt: string;
  readAt: string | null;
  parentFeedback: string | null;
} | null> {
  const row = db.prepare(
    `SELECT pv.*,
        CASE WHEN pv.source_type = 'followup' THEN f.student_id ELSE r.student_id END as student_id,
        CASE WHEN pv.source_type = 'followup' THEN f.subject ELSE r.subject END as subject
       FROM parent_views pv
       LEFT JOIN followups f ON pv.source_type = 'followup' AND pv.source_id = f.id
       LEFT JOIN monthly_reports r ON pv.source_type = 'report' AND pv.source_id = r.id
       WHERE pv.access_token = ?
         AND (pv.expires_at IS NULL OR pv.expires_at > datetime('now', '+8 hours'))`
  ).get(accessToken) as any;

  if (!row) return null;

  // 获取学生姓名
  const student = db.prepare('SELECT name FROM students WHERE id = ?').get(row.student_id) as { name: string } | undefined;

  return {
    viewData: JSON.parse(row.view_json),
    sourceType: row.source_type,
    sourceId: row.source_id,
    studentName: student?.name || '未知学生',
    subject: row.subject || '',
    createdAt: row.created_at,
    readAt: row.read_at,
    parentFeedback: row.parent_feedback,
  };
}

/** 家长标记已读 */
export async function markParentViewRead(accessToken: string): Promise<boolean> {
  const result = db.prepare(
    `UPDATE parent_views SET read_at = datetime('now', '+8 hours')
     WHERE access_token = ? AND read_at IS NULL
       AND (expires_at IS NULL OR expires_at > datetime('now', '+8 hours'))`
  ).run(accessToken);
  if (result.changes > 0) return true;
  // 已读是幂等操作；有效链接即使已有 read_at 也返回成功。
  const existing = db.prepare(
    `SELECT 1 FROM parent_views
     WHERE access_token = ? AND (expires_at IS NULL OR expires_at > datetime('now', '+8 hours'))`
  ).get(accessToken);
  return Boolean(existing);
}

/** 家长提交反馈（我有疑问） */
export async function submitParentFeedback(accessToken: string, feedback: string): Promise<boolean> {
  const result = db.prepare(
    `UPDATE parent_views SET parent_feedback = ?
     WHERE access_token = ? AND (expires_at IS NULL OR expires_at > datetime('now', '+8 hours'))`
  ).run(feedback, accessToken);
  return result.changes > 0;
}

/** 生成并存储家长视图（一站式调用） */
export async function generateAndStoreParentView(
  userId: number,
  sourceType: 'followup' | 'report',
  sourceId: number,
  expiresDays: number = 30
): Promise<{ id: number; accessToken: string; viewData: ParentViewData }> {
  const viewData = await generateParentView(userId, sourceType, sourceId);
  const { id, accessToken } = await createOrUpdateParentView(userId, sourceType, sourceId, viewData, expiresDays);

  // 记录变更事件
  recordChangeEvent('parent_view', id, ['created'], 1, userId);

  return { id, accessToken, viewData };
}
