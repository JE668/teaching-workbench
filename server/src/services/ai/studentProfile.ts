import { db } from '../../config/database.js';
import { log } from '../../utils/logger.js';
import { withAiSlot, AiTaskPriority, getClient, getAiConfig, recordAiMetrics, countWords, imageToBase64DataUrl } from '../ai/index.js';
import { getOcrText } from '../ocr.js';

// 学生画像结构定义
export interface StudentProfile {
  learning_style: 'visual' | 'auditory' | 'kinesthetic' | 'reading_writing';
  weak_points: string[];
  strong_points: string[];
  motivation_drivers: string[];
  pacing_preference: 'fast' | 'steady' | 'slow_deep';
  communication_style: 'concise' | 'detailed' | 'encouraging' | 'strict';
  attention_span_minutes: number;
  homework_compliance: 'high' | 'medium' | 'low';
  parental_involvement: 'high' | 'medium' | 'low';
  updated_at: string;
  confidence: number;
}

// 画像生成所需的数据源聚合（原始查询结果类型）
interface RawProfileSourceData {
  followups: Array<{
    topic: string;
    content: string;
    blocks: string | null;
    overall_grade: string | null;
    observed_at: string;
    images: string | null;
  }>;
  reports: Array<{
    year_month: string;
    created_at: string;
    summary_items: string | null;
    plan_items: string | null;
    exam_items: string | null;
  }>;
  observations: Array<{
    topic: string;
    class_notes: string;
    report: string | null;
    overall_grade: string | null;
    observed_at: string;
    lesson_type: string | null;
  }>;
  knowledge_points: Array<{
    point_name: string;
    point_category: string;
    mastery_level: number;
    evidence_count: number;
    last_seen_at: string;
  }>;
  exam_analyses: Array<{
    question_index: number;
    mistake_tags: string;
    root_cause: string;
    review_actions: string;
    created_at: string;
  }>;
}

// 解析后的数据源类型
interface ParsedProfileSourceData {
  followups: Array<{
    topic: string;
    content: string;
    blocks?: Record<string, string>;
    overall_grade?: string;
    observed_at: string;
    images?: string[];
  }>;
  reports: Array<{
    year_month: string;
    summary_items: Array<{ type: string; content: string }>;
    plan_items: Array<{ type: string; content: string }>;
    exam_items: Array<{ type: string; content: string }>;
    created_at: string;
  }>;
  observations: Array<{
    topic: string;
    class_notes: string;
    report?: string;
    overall_grade?: string;
    observed_at: string;
    lesson_type?: string;
  }>;
  knowledge_points: Array<{
    point_name: string;
    point_category: string;
    mastery_level: number;
    evidence_count: number;
    last_seen_at: string;
  }>;
  exam_analyses: Array<{
    question_index: number;
    mistake_tags: string[];
    root_cause: string;
    review_actions: string[];
    created_at: string;
  }>;
}

/**
 * 聚合某学生的所有数据源
 */
export async function gatherProfileSourceData(
  userId: number,
  studentId: number
): Promise<ParsedProfileSourceData> {
  const [followups, reports, observations, knowledgePoints, examAnalyses] = await Promise.all([
    // 回访记录（最近 6 个月）
    db
      .prepare(
        `SELECT topic, content, blocks, mastery AS overall_grade, created_at AS observed_at, images
           FROM followups
          WHERE user_id = ? AND student_id = ?
            AND created_at >= datetime('now', '-6 months', '+8 hours')
          ORDER BY created_at DESC`
      )
      .all(userId, studentId) as RawProfileSourceData['followups'],
    // 月报（最近 6 个月）
    db
      .prepare(
        `SELECT r.year_month, r.created_at,
                  json_group_array(
                    json_object('type', ri.type, 'content', ri.content)
                  ) FILTER (WHERE ri.kind = 'summary') AS summary_items,
                  json_group_array(
                    json_object('type', ri.type, 'content', ri.content)
                  ) FILTER (WHERE ri.kind = 'plan') AS plan_items,
                  json_group_array(
                    json_object('type', ri.type, 'content', ri.content)
                  ) FILTER (WHERE ri.kind = 'exam') AS exam_items
             FROM monthly_reports r
             LEFT JOIN report_items ri ON ri.report_id = r.id
            WHERE r.user_id = ? AND r.student_id = ?
              AND r.year_month >= strftime('%Y-%m', date('now', '-6 months'))
            GROUP BY r.id
            ORDER BY r.year_month DESC`
      )
      .all(userId, studentId) as RawProfileSourceData['reports'],
    // 听评课记录（最近 6 个月）
    db
      .prepare(
        `SELECT topic, class_notes, report, overall_grade, observed_at, lesson_type
           FROM observations
          WHERE user_id = ? AND student_name = (
            SELECT name FROM students WHERE id = ? AND user_id = ?
          )
            AND observed_at >= date('now', '-6 months')
          ORDER BY observed_at DESC`
      )
      .all(userId, studentId, userId) as RawProfileSourceData['observations'],
    // 知识图谱点
    db
      .prepare(
        `SELECT point_name, point_category, mastery_level, evidence_count, last_seen_at
           FROM knowledge_points
          WHERE user_id = ? AND student_id = ?
          ORDER BY mastery_level ASC, evidence_count DESC`
      )
      .all(userId, studentId) as RawProfileSourceData['knowledge_points'],
    // 阶测错因分析（最近 6 个月）
    db
      .prepare(
        `SELECT question_index, mistake_tags, root_cause, review_actions, created_at
           FROM exam_analysis_details
          WHERE user_id = ? AND student_id = ?
            AND created_at >= date('now', '-6 months')
          ORDER BY created_at DESC`
      )
      .all(userId, studentId) as RawProfileSourceData['exam_analyses'],
  ]);

  // 解析 JSON 字段
  const parsedFollowups = followups.map((f) => ({
    ...f,
    blocks: f.blocks ? JSON.parse(f.blocks) : undefined,
    images: f.images ? JSON.parse(f.images) : undefined,
    overall_grade: f.overall_grade ?? undefined,
  }));

  const parsedReports = reports.map((r) => ({
    ...r,
    summary_items: r.summary_items ? JSON.parse(r.summary_items) : [],
    plan_items: r.plan_items ? JSON.parse(r.plan_items) : [],
    exam_items: r.exam_items ? JSON.parse(r.exam_items) : [],
  }));

  const parsedObservations = observations.map((o) => ({
    ...o,
    report: o.report ?? undefined,
    overall_grade: o.overall_grade ?? undefined,
    lesson_type: o.lesson_type ?? undefined,
  }));

  const parsedExamAnalyses = examAnalyses.map((e) => ({
    ...e,
    mistake_tags: e.mistake_tags ? JSON.parse(e.mistake_tags) : [],
    review_actions: e.review_actions ? JSON.parse(e.review_actions) : [],
  }));

  return {
    followups: parsedFollowups,
    reports: parsedReports,
    observations: parsedObservations,
    knowledge_points: knowledgePoints,
    exam_analyses: parsedExamAnalyses,
  };
}

/**
 * 构建画像生成的系统提示词
 */
function buildProfilePrompt(data: ParsedProfileSourceData, studentName: string): string {
  const followupCount = data.followups.length;
  const reportCount = data.reports.length;
  const observationCount = data.observations.length;
  const examAnalysisCount = data.exam_analyses.length;
  const knowledgePointCount = data.knowledge_points.length;

  // 汇总文本证据
  const followupText = data.followups
    .slice(0, 20)
    .map((f) => `[回访 ${f.observed_at}] ${f.topic}: ${f.blocks ? Object.values(f.blocks).join(' | ') : f.content}`)
    .join('\n');

  const reportText = data.reports
    .slice(0, 10)
    .map((r) =>
      `[月报 ${r.year_month}] 总结: ${r.summary_items.map((i) => i.content).join('; ')}; 规划: ${r.plan_items.map((i) => i.content).join('; ')}`
    )
    .join('\n');

  const observationText = data.observations
    .slice(0, 10)
    .map((o) => `[听评课 ${o.observed_at}] ${o.topic}: ${o.class_notes} ${o.report ? '| 报告: ' + o.report : ''}`)
    .join('\n');

  const knowledgeText = data.knowledge_points
    .slice(0, 30)
    .map((k) => `${k.point_name} (${k.point_category}): mastery=${(k.mastery_level * 100).toFixed(0)}%, count=${k.evidence_count}`)
    .join('\n');

  const examText = data.exam_analyses
    .slice(0, 30)
    .map((e) => `[错题 ${e.question_index}] ${e.root_cause} | 标签: ${e.mistake_tags.join(', ')} | 建议: ${e.review_actions.join('; ')}`)
    .join('\n');

  return `你是一位资深教育心理分析师。请基于以下学生 ${studentName} 的多模态长时序教学数据，生成结构化的学生画像。

【数据来源概览】
- 课后回访: ${followupCount} 条（最近 6 个月）
- 月度总结规划: ${reportCount} 份（最近 6 个月）
- 听评课记录: ${observationCount} 条（最近 6 个月）
- 知识图谱点: ${knowledgePointCount} 个
- 阶测错因分析: ${examAnalysisCount} 道题

【详细证据】

=== 课后回访 ===
${followupText || '（无）'}

=== 月度总结规划 ===
${reportText || '（无）'}

=== 听评课记录 ===
${observationText || '（无）'}

=== 知识图谱掌握度 ===
${knowledgeText || '（无）'}

=== 阶测错因分析 ===
${examText || '（无）'}

【输出要求】
请严格输出以下 JSON，不包含任何额外文本：
{
  "learning_style": "visual|auditory|kinesthetic|reading_writing",
  "weak_points": ["弱点1", "弱点2", "弱点3"],
  "strong_points": ["强项1", "强项2", "强项3"],
  "motivation_drivers": ["驱动因素1", "驱动因素2"],
  "pacing_preference": "fast|steady|slow_deep",
  "communication_style": "concise|detailed|encouraging|strict",
  "attention_span_minutes": <整数 10-120>,
  "homework_compliance": "high|medium|low",
  "parental_involvement": "high|medium|low",
  "confidence": <0-1 之间的小数，表示画像可信度>
}

【推理指引】
- learning_style: 观察回访/月报中是否频繁提及"看图可知""图表""演示"→visual；"听讲""口头解释"→auditory；"动手操作""实验""实物"→kinesthetic；"阅读""笔记""文字"→reading_writing
- weak_points/strong_points: 结合知识图谱 mastery 低/高的知识点 + 阶测错因高频标签 + 回访/月报反复提及的问题/优势
- motivation_drivers: 从月报规划、回访教师评语、听评课表现中推断（竞赛/排名/表扬/奖励/兴趣/内驱力等）
- pacing_preference: 回访中"进度快/慢"、月报规划密度、作业完成情况综合判断
- communication_style: 回访/月报文风、教师评语风格、家长反馈侧写
- attention_span_minutes: 听评课课型时长、作业专注时长、考试易题超时情况估算
- homework_compliance: 回访作业完成情况、月报执行情况、错题整改落实度
- parental_involvement: 回访中家长配合度描述、月报家长沟通记录、家长端阅读率（如有）
- confidence: 数据源丰富度、一致性、时间跨度综合评分  `;
}

/**
 * 把回访图片和已有 OCR 结果真正放进 vision 请求，而不是只在提示词里声称“多模态”。
 * 图片仍逐一做用户归属校验；损坏或失效的图片降级跳过，不阻断文字画像生成。
 */
export async function buildProfileUserContent(userId: number, prompt: string, imagePaths: string[]): Promise<any[]> {
  const boundedPaths = imagePaths.filter((image) => typeof image === 'string' && image.trim()).slice(0, 6);
  const content: any[] = [{ type: 'text', text: prompt }];
  if (!boundedPaths.length) return content;

  const ocrLines = Object.entries(getOcrText(userId, boundedPaths))
    .filter(([, text]) => text.trim())
    .map(([imagePath, text]) => `--- ${imagePath} OCR ---\n${text}`);
  if (ocrLines.length) {
    content.push({ type: 'text', text: '历史回访图片的 OCR 参考（可能有误，需与图片和文字证据交叉核对）：\n' + ocrLines.join('\n') });
  }

  for (const imagePath of boundedPaths) {
    try {
      content.push({
        type: 'image_url',
        image_url: { url: await imageToBase64DataUrl(imagePath, userId) },
      });
    } catch (error: any) {
      log.warn({ userId, imagePath, err: error.message }, '学生画像图片加载失败，跳过该图片');
    }
  }
  content.push({
    type: 'text',
    text: '以上是最近回访中的历史作业、试卷或板书图片。只提取有图像证据支持的长期学习特征；不要猜测模糊内容，也不要把单次表现泛化为稳定结论。',
  });
  return content;
}

/** 调用 LLM 生成学生画像 */
async function callProfileLLM(userId: number, prompt: string, imagePaths: string[]): Promise<StudentProfile> {
  const config = getAiConfig(userId);
  const ai = getClient(userId, config);
  const start = Date.now();

  const userContent = await buildProfileUserContent(userId, prompt, imagePaths);
  const response = await ai.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: '你是一位资深教育心理分析师，擅长从多模态教学数据中提炼学生画像。严格输出 JSON，不添加任何解释。' },
      { role: 'user', content: userContent }
    ],
    temperature: 0.2,
    max_tokens: 1500,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'student_profile',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            learning_style: { type: 'string', enum: ['visual', 'auditory', 'kinesthetic', 'reading_writing'] },
            weak_points: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
            strong_points: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
            motivation_drivers: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
            pacing_preference: { type: 'string', enum: ['fast', 'steady', 'slow_deep'] },
            communication_style: { type: 'string', enum: ['concise', 'detailed', 'encouraging', 'strict'] },
            attention_span_minutes: { type: 'integer', minimum: 10, maximum: 120 },
            homework_compliance: { type: 'string', enum: ['high', 'medium', 'low'] },
            parental_involvement: { type: 'string', enum: ['high', 'medium', 'low'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: [
            'learning_style',
            'weak_points',
            'strong_points',
            'motivation_drivers',
            'pacing_preference',
            'communication_style',
            'attention_span_minutes',
            'homework_compliance',
            'parental_involvement',
            'confidence',
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const content = (response.choices[0].message.content || '').trim();

  await recordAiMetrics({
    userId,
    provider: config.provider,
    model: config.model,
    endpoint: 'student_profile',
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    totalTokens: response.usage?.total_tokens,
    latencyMs: Date.now() - start,
    status: 'success',
    wordCount: countWords(content),
  });

  return JSON.parse(content) as StudentProfile;
}

/**
 * 构建并保存学生画像（离线批量任务，走 background 优先级队列）
 */
export async function buildStudentProfile(
  userId: number,
  studentId: number,
  studentName: string
): Promise<{ profile: StudentProfile; sourceSummary: string }> {
  // 聚合数据源
  const sourceData = await gatherProfileSourceData(userId, studentId);

  const imagePaths = sourceData.followups.flatMap((followup) => followup.images || []).slice(0, 6);
  // 摘要记录实际提供的证据类型，不把“图片路径存在”写成“图片识别必然成功”。
  const sourceSummary = `基于 ${sourceData.followups.length} 条回访、${sourceData.reports.length} 份月报、${sourceData.observations.length} 条听评课、${sourceData.exam_analyses.length} 道错题分析、${sourceData.knowledge_points.length} 个知识点、${imagePaths.length} 张回访图片`;

  // 构建 prompt 并调用 LLM（走 background 优先级队列）
  const prompt = buildProfilePrompt(sourceData, studentName);
  const profile = await withAiSlot(
    async () => callProfileLLM(userId, prompt, imagePaths),
    'background' as AiTaskPriority,
    userId
  );

  // 保存到数据库
  const now = new Date().toISOString();
  // LLM 严格 schema 不含元数据时间；入库前补齐，保证响应中的 generatedAt 可用。
  profile.updated_at = now;
  const stmt = db.prepare(`
    INSERT INTO student_profiles (user_id, student_id, profile_json, source_summary, confidence, generated_at, confirmed_by_teacher, teacher_notes)
    VALUES (?, ?, ?, ?, ?, ?, 0, '')
    ON CONFLICT(student_id) DO UPDATE SET
      profile_json = excluded.profile_json,
      source_summary = excluded.source_summary,
      confidence = excluded.confidence,
      generated_at = excluded.generated_at,
      confirmed_by_teacher = 0,
      teacher_notes = ''
  `);
  stmt.run(userId, studentId, JSON.stringify(profile), sourceSummary, profile.confidence, now);

  log.info({ userId, studentId, confidence: profile.confidence }, '学生画像生成完成');
  return { profile, sourceSummary };
}

/**
 * 获取已保存的学生画像
 */
export function getStudentProfile(userId: number, studentId: number): (StudentProfile & { id: number; source_summary: string; confirmed_by_teacher: boolean; teacher_notes: string }) | null {
  const row = db
    .prepare('SELECT * FROM student_profiles WHERE user_id = ? AND student_id = ?')
    .get(userId, studentId) as { profile_json: string; source_summary: string; confirmed_by_teacher: number; teacher_notes: string; id: number } | undefined;

  if (!row) return null;
  const profile = JSON.parse(row.profile_json) as StudentProfile;
  return {
    id: row.id,
    ...profile,
    source_summary: row.source_summary,
    confirmed_by_teacher: Boolean(row.confirmed_by_teacher),
    teacher_notes: row.teacher_notes,
  };
}

/**
 * 生成主流程使用的容错画像读取：历史脏 JSON 或迁移异常不应阻断回访/月报生成。
 */
export function getStudentProfileForGeneration(userId: number, studentId: number): ReturnType<typeof getStudentProfile> {
  try {
    return getStudentProfile(userId, studentId);
  } catch (error: any) {
    log.warn({ userId, studentId, error: error?.message }, '学生画像读取失败，本次生成不注入画像');
    return null;
  }
}

/**
 * 更新画像（教师确认/微调）
 */
export function updateStudentProfile(
  userId: number,
  studentId: number,
  patch: Partial<StudentProfile> & { confirmed_by_teacher?: boolean; teacher_notes?: string }
): boolean {
  const existing = getStudentProfile(userId, studentId);
  if (!existing) return false;

  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  const { id, source_summary, confirmed_by_teacher, teacher_notes, ...profileFields } = merged;

  const stmt = db.prepare(`
    UPDATE student_profiles
    SET profile_json = ?, confirmed_by_teacher = ?, teacher_notes = ?
    WHERE user_id = ? AND student_id = ?
  `);
  const result = stmt.run(JSON.stringify(profileFields), (patch.confirmed_by_teacher ?? existing.confirmed_by_teacher) ? 1 : 0, patch.teacher_notes ?? existing.teacher_notes, userId, studentId);
  return result.changes > 0;
}

/**
 * 批量为用户的所有学生生成画像（后台任务入口）
 */
export async function buildAllStudentProfiles(userId: number): Promise<Array<{ studentId: number; studentName: string; success: boolean; error?: string }>> {
  const students = db
    .prepare('SELECT id, name FROM students WHERE user_id = ?')
    .all(userId) as Array<{ id: number; name: string }>;

  const results = [];
  for (const s of students) {
    try {
      await buildStudentProfile(userId, s.id, s.name);
      results.push({ studentId: s.id, studentName: s.name, success: true });
    } catch (error: any) {
      log.error({ userId, studentId: s.id, error: error.message }, '学生画像生成失败');
      results.push({ studentId: s.id, studentName: s.name, success: false, error: error.message });
    }
  }
  return results;
}
