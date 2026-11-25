/**
 * 教学复盘仪表盘（方向 M / Task-14）。
 *
 * 面向教师本人：把「已经做过的事」折成可回答的问题，而不是再堆一屏数字。
 * 三条主线：
 *   1. 工作量 —— 本月写了多少回访/月报/听评课，哪些学生被冷落
 *   2. 质量   —— AI 生成的失败/含重试调用比例、字数目标达成情况
 *   3. 成长   —— 当前知识点快照与月报记录的原始 delta（不冒充历史掌握度）
 *
 * 全部指标**实时聚合**自既有表，不落新表：
 *   一旦落表，口径就会随时间漂移，教师看到的「进步」其实是公式变了。
 *
 * 口径注意：
 *   - followups.mastery 是枚举（excellent/good/average/needs_improvement），
 *     不是连续分，所以掌握度只给分布，不等于分数，不能求平均。
 *   - report_items.scheduled_at 是计划日期，不等于实际上课日期；
 *     出勤按 attendance 字段算，不按日期。
 *   - observations 只有 draft/final 两个状态，课时统计用 status = 'final'。
 */
import { Router, type Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { log } from '../utils/logger.js';
import { STRUCTURED_BLOCKS } from '../services/ai/prompt.js';

const router = Router();

/** 未知异常只写服务端日志；客户端始终收到稳定的公共错误。 */
function respondInternalError(res: Response, error: unknown, publicMessage: string): void {
  log.error({ err: error }, publicMessage);
  res.status(500).json({ error: publicMessage });
}

/** 掌握程度枚举 → 中文标签；与 services/export.ts 保持一致 */
const MASTERY_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  average: '一般',
  needs_improvement: '需加强',
};

/** 出勤枚举 → 是否到场 */
// 与 reportAi.ts 的 classifyAttendance 对齐：✅ 正常、请假、补；'/' 和其它值不计入出勤分母。
function classifyReviewAttendance(value: string | null | undefined): 'present' | 'leave' | 'makeup' | null {
  const text = String(value || '').trim();
  if (text.includes('✅')) return 'present';
  if (text.includes('请假')) return 'leave';
  if (text === '补' || text.includes('补')) return 'makeup';
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 解析 'YYYY-MM'，非法返回 null */
function parseMonth(raw: unknown): { year: number; month: number } | null {
  const s = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim();
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

/** 'YYYY-MM' → 下月 'YYYY-MM' */
function nextMonth(year: number, month: number): string {
  return month === 12 ? year + 1 + '-01' : year + '-' + pad2(month + 1);
}

/** 近 N 个月的 'YYYY-MM' 列表，从早到晚 */
function recentMonths(n: number, endMonth?: string): string[] {
  const out: string[] = [];
  const parsedEnd = endMonth ? parseMonth(endMonth) : null;
  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric',
  }).formatToParts(new Date());
  const currentYear = Number(nowParts.find((part) => part.type === 'year')?.value);
  const currentMonth = Number(nowParts.find((part) => part.type === 'month')?.value);
  let y = parsedEnd?.year ?? currentYear;
  let m = parsedEnd?.month ?? currentMonth;
  for (let i = 0; i < n; i++) {
    out.unshift(y + '-' + pad2(m));
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** 安全解析 JSON 数组列 */
function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface CountRow {
  [key: string]: unknown;
  n: number;
}

interface EndpointAggRow {
  endpoint: string;
  calls: number;
  successCalls: number;
  errorCalls: number;
  retryCalls: number;
  avgLatencyMs: number | null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function pct(part: number, whole: number): number {
  return whole ? round2((part / whole) * 100) : 0;
}

function nullablePct(part: number, whole: number): number | null {
  return whole ? pct(part, whole) : null;
}

function hasCompleteStructuredBlocks(content: string): boolean {
  const markers = STRUCTURED_BLOCKS.map((block) => ({
    marker: `【${block.label}】`,
    start: content.indexOf(`【${block.label}】`),
  }));
  return markers.every(({ marker, start }) => {
    if (start < 0) return false;
    const valueStart = start + marker.length;
    const nextStarts = markers.map((item) => item.start).filter((position) => position >= valueStart);
    const valueEnd = nextStarts.length ? Math.min(...nextStarts) : content.length;
    return content.slice(valueStart, valueEnd).trim().length > 0;
  });
}

function getFollowupQuality(userId: number, monthStart: string, monthEnd: string) {
  const rows = db.prepare(
    'SELECT id, content, word_count AS wordCount, images FROM followups WHERE user_id = ? AND created_at >= ? AND created_at < ?'
  ).all(userId, monthStart, monthEnd) as Array<{ id: number; content: string; wordCount: number; images: string }>;
  const total = rows.length;
  const structured = rows.filter((row) => hasCompleteStructuredBlocks(row.content || '')).length;
  const withImages = rows.filter((row) => parseJsonArray(row.images).some((path) => path.trim().length > 0)).length;
  const avgWordCount = total ? Math.round(rows.reduce((sum, row) => sum + (row.wordCount || 0), 0) / total) : null;
  const referenced = (db.prepare(
    `SELECT COUNT(DISTINCT f.id) AS n FROM followups f
     JOIN content_references cr ON cr.source_type = 'followup' AND cr.source_id = f.id
     WHERE f.user_id = ? AND f.created_at >= ? AND f.created_at < ?`
  ).get(userId, monthStart, monthEnd) as CountRow).n;
  const parent = db.prepare(
    `SELECT COUNT(*) AS shared,
       SUM(CASE WHEN pv.read_at IS NOT NULL THEN 1 ELSE 0 END) AS read
     FROM parent_views pv
     JOIN followups f ON f.id = pv.source_id AND f.user_id = pv.user_id
     WHERE pv.user_id = ? AND pv.source_type = 'followup' AND f.created_at >= ? AND f.created_at < ?`
  ).get(userId, monthStart, monthEnd) as { shared: number; read: number | null };
  return {
    total,
    avgWordCount,
    structured,
    structuredRate: nullablePct(structured, total),
    withImages,
    imageRecordRate: nullablePct(withImages, total),
    referenced,
    historicalReferenceRate: nullablePct(referenced, total),
    parentShared: parent.shared || 0,
    parentRead: parent.read || 0,
    parentReadRate: nullablePct(parent.read || 0, parent.shared || 0),
  };
}

function getGroupComparisons(userId: number, month: string, monthStart: string, monthEnd: string) {
  const groups = db.prepare('SELECT id, name, student_ids AS studentIds FROM groups WHERE user_id = ? ORDER BY id').all(userId) as Array<{
    id: number; name: string; studentIds: string;
  }>;
  return groups.map((group) => {
    let rawIds: unknown[] = [];
    try {
      const parsed = JSON.parse(group.studentIds || '[]');
      if (Array.isArray(parsed)) rawIds = parsed;
    } catch {
      // 损坏的分组定义没有可验证的样本，不能伪装成 0 人小组进入对标。
      return null;
    }
    const requestedIds = [...new Set(rawIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!requestedIds.length) {
      return { groupId: group.id, groupName: group.name, studentCount: 0, masteryStudentCount: 0, deltaStudentCount: 0, avgMastery: null, avgMasteryDelta: null, deltaEvidenceCount: 0, followupCovered: 0, followupCoverageRate: null };
    }
    const placeholders = requestedIds.map(() => '?').join(',');
    const students = db.prepare(`SELECT id FROM students WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...requestedIds) as Array<{ id: number }>;
    const ids = students.map((student) => student.id);
    if (!ids.length) {
      return { groupId: group.id, groupName: group.name, studentCount: 0, masteryStudentCount: 0, deltaStudentCount: 0, avgMastery: null, avgMasteryDelta: null, deltaEvidenceCount: 0, followupCovered: 0, followupCoverageRate: null };
    }
    const ownPlaceholders = ids.map(() => '?').join(',');
    const mastery = db.prepare(
      `SELECT COUNT(*) AS studentCount, AVG(studentAvg) AS value FROM (
         SELECT student_id, AVG(mastery_level) AS studentAvg FROM knowledge_points
         WHERE user_id = ? AND student_id IN (${ownPlaceholders}) GROUP BY student_id
       )`
    ).get(userId, ...ids) as { studentCount: number; value: number | null };
    const delta = db.prepare(
      `SELECT COUNT(rkp.point_id) AS evidenceCount,
        COUNT(DISTINCT kp.student_id) AS studentCount,
        COALESCE(SUM(rkp.delta), 0) AS totalDelta
       FROM monthly_reports r
       JOIN report_knowledge_points rkp ON rkp.report_id = r.id
       JOIN knowledge_points kp ON kp.id = rkp.point_id AND kp.user_id = r.user_id
       WHERE r.user_id = ? AND r.year_month = ? AND kp.student_id IN (${ownPlaceholders})`
    ).get(userId, month, ...ids) as { evidenceCount: number; studentCount: number; totalDelta: number };
    const covered = (db.prepare(
      `SELECT COUNT(DISTINCT student_id) AS n FROM followups
       WHERE user_id = ? AND created_at >= ? AND created_at < ? AND student_id IN (${ownPlaceholders})`
    ).get(userId, monthStart, monthEnd, ...ids) as CountRow).n;
    return {
      groupId: group.id,
      groupName: group.name,
      studentCount: ids.length,
      masteryStudentCount: mastery.studentCount,
      deltaStudentCount: delta.studentCount,
      avgMastery: mastery.value == null ? null : round2(mastery.value),
      // 无月报 delta 的学生是“无记录”，不是 0；只在有证据的学生内平均。
      avgMasteryDelta: delta.studentCount ? round2(delta.totalDelta / delta.studentCount) : null,
      deltaEvidenceCount: delta.evidenceCount,
      followupCovered: covered,
      followupCoverageRate: nullablePct(covered, ids.length),
    };
  }).filter((group) => group !== null);
}


/** 教学主管账号白名单；ADMIN_USERNAMES 作为兼容回退。未配置时不开放任何跨教师读取。 */
function isTeachingSupervisor(userId: number): boolean {
  const configured = (process.env.TEACHING_SUPERVISOR_USERNAMES || process.env.ADMIN_USERNAMES || '').trim();
  if (!configured) return false;
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  return !!row && configured.split(',').map((name) => name.trim()).filter(Boolean).includes(row.username);
}

/** 本人始终只能看自己；主管可用 teacherId 下钻，且目标必须是实际存在的教师账户。 */
function resolveReviewUserId(req: AuthenticatedRequest, res: any): number | null {
  const raw = String(Array.isArray(req.query.teacherId) ? req.query.teacherId[0] : req.query.teacherId || '').trim();
  if (!raw) return req.userId!;
  if (!isTeachingSupervisor(req.userId!)) {
    res.status(403).json({ error: '仅教学主管可以查看其他教师复盘' });
    return null;
  }
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    res.status(400).json({ error: 'teacherId 必须为正整数' });
    return null;
  }
  const teacherId = Number(raw);
  const teacher = db.prepare('SELECT id FROM users WHERE id = ?').get(teacherId);
  if (!teacher) {
    res.status(404).json({ error: '教师账户不存在' });
    return null;
  }
  return teacherId;
}

/** 主管访问能力与全组工作量健康度；不计算缺乏统一口径的“综合健康分”。 */
router.get('/access', (req: AuthenticatedRequest, res) => {
  res.json({ canViewTeam: isTeachingSupervisor(req.userId!) });
});

router.get('/team', (req: AuthenticatedRequest, res) => {
  if (!isTeachingSupervisor(req.userId!)) {
    return res.status(403).json({ error: '仅教学主管可以查看全组复盘' });
  }
  const parsed = parseMonth(req.query.month);
  if (!parsed) return res.status(400).json({ error: 'month 必须为 YYYY-MM 格式' });
  const month = parsed.year + '-' + pad2(parsed.month);
  const monthStart = month + '-01';
  const monthEnd = nextMonth(parsed.year, parsed.month) + '-01';
  const teachers = (db.prepare(`
    SELECT u.id, u.username,
      (SELECT COUNT(*) FROM students s WHERE s.user_id = u.id) AS students,
      (SELECT COUNT(*) FROM followups f WHERE f.user_id = u.id AND f.created_at >= ? AND f.created_at < ?) AS followups,
      (SELECT COUNT(*) FROM monthly_reports r WHERE r.user_id = u.id AND r.year_month = ?) AS reports,
      (SELECT COUNT(*) FROM observations o WHERE o.user_id = u.id AND o.observed_at >= ? AND o.observed_at < ?) AS observations,
      (SELECT COUNT(*) FROM lesson_plans p WHERE p.user_id = u.id AND p.month = ?) AS lessonPlans,
      (SELECT COUNT(*) FROM ai_metrics a WHERE a.user_id = u.id AND a.created_at >= ? AND a.created_at < ?) AS aiCalls,
      (SELECT COUNT(*) FROM ai_metrics a WHERE a.user_id = u.id AND a.created_at >= ? AND a.created_at < ? AND a.status = 'success') AS aiSuccessCalls
    FROM users u ORDER BY u.username COLLATE NOCASE ASC, u.id ASC
  `).all(monthStart, monthEnd, month, monthStart, monthEnd, month, monthStart, monthEnd, monthStart, monthEnd) as Array<Record<string, any>>).map((teacher) => ({
    teacherId: Number(teacher.id),
    username: String(teacher.username),
    students: Number(teacher.students),
    followups: Number(teacher.followups),
    reports: Number(teacher.reports),
    observations: Number(teacher.observations),
    lessonPlans: Number(teacher.lessonPlans),
    aiCalls: Number(teacher.aiCalls),
    aiSuccessRate: teacher.aiCalls ? nullablePct(Number(teacher.aiSuccessCalls), Number(teacher.aiCalls)) : null,
  }));
  res.json({ month, teachers, semantics: 'raw_workload_and_ai_call_rates_no_composite_health_score' });
});

/**
 * GET /api/teaching-review/summary?month=YYYY-MM
 * 复盘总览：工作量、质量、成长一次给全，前端只渲染不计算。
 */
router.get('/summary', (req: AuthenticatedRequest, res) => {
  try {
    const userId = resolveReviewUserId(req, res);
    if (userId === null) return;
    const parsed = parseMonth(req.query.month);
    if (!parsed) {
      return res.status(400).json({ error: 'month 必须为 YYYY-MM 格式' });
    }
    const month = parsed.year + '-' + pad2(parsed.month);
    const monthStart = month + '-01';
    const monthEnd = nextMonth(parsed.year, parsed.month) + '-01';

    // ---- 工作量 ----
    const followupRow = db
      .prepare('SELECT COUNT(*) AS n FROM followups WHERE user_id = ? AND created_at >= ? AND created_at < ?')
      .get(userId, monthStart, monthEnd) as CountRow;
    const reportRow = db
      .prepare('SELECT COUNT(*) AS n FROM monthly_reports WHERE user_id = ? AND year_month = ?')
      .get(userId, month) as CountRow;
    const observationRow = db
      .prepare("SELECT COUNT(*) AS n FROM observations WHERE user_id = ? AND observed_at >= ? AND observed_at < ?")
      .get(userId, monthStart, monthEnd) as CountRow;
    const lessonPlanRow = db
      .prepare('SELECT COUNT(*) AS n FROM lesson_plans WHERE user_id = ? AND month = ?')
      .get(userId, month) as CountRow;
    const confirmedLessonPlanRow = db
      .prepare("SELECT COUNT(*) AS n FROM lesson_plans WHERE user_id = ? AND month = ? AND status = 'confirmed'")
      .get(userId, month) as CountRow;
    const studentRow = db
      .prepare('SELECT COUNT(*) AS n FROM students WHERE user_id = ?')
      .get(userId) as CountRow;

    const workload = {
      followups: followupRow.n,
      reports: reportRow.n,
      observations: observationRow.n,
      lessonPlans: lessonPlanRow.n,
      lessonPlansConfirmed: confirmedLessonPlanRow.n,
      students: studentRow.n,
      total: followupRow.n + reportRow.n + observationRow.n + lessonPlanRow.n,
    };

    // ---- 质量：AI 调用成功率与延迟 ----
    const aiRows = db
      .prepare(
        'SELECT endpoint,' +
          ' COUNT(*) AS calls,' +
          " SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCalls," +
          " SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorCalls," +
          " SUM(CASE WHEN status = 'retry' OR retry_count > 0 THEN 1 ELSE 0 END) AS retryCalls," +
          ' AVG(latency_ms) AS avgLatencyMs' +
          ' FROM ai_metrics' +
          ' WHERE user_id = ? AND created_at >= ? AND created_at < ?' +
          ' GROUP BY endpoint ORDER BY calls DESC'
      )
      .all(userId, monthStart, monthEnd) as EndpointAggRow[];

    // 总计直接聚合原始行，避免按 endpoint 的平均值再次加权时把重试/空延迟算错。
    const aiTotals = db.prepare(
      `SELECT COUNT(*) AS calls,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCalls,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorCalls,
        SUM(CASE WHEN status = 'retry' OR retry_count > 0 THEN 1 ELSE 0 END) AS retryCalls,
        COALESCE(SUM(retry_count), 0) AS retryAttempts,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        AVG(latency_ms) AS avgLatencyMs,
        SUM(CASE WHEN status = 'success' AND word_count IS NOT NULL
          AND word_range_min IS NOT NULL AND word_range_max IS NOT NULL THEN 1 ELSE 0 END) AS wordMeasured,
        SUM(CASE WHEN status = 'success' AND word_count IS NOT NULL
          AND word_range_min IS NOT NULL AND word_range_max IS NOT NULL
          AND word_count >= word_range_min AND word_count <= word_range_max THEN 1 ELSE 0 END) AS wordInRange
       FROM ai_metrics WHERE user_id = ? AND created_at >= ? AND created_at < ?`
    ).get(userId, monthStart, monthEnd) as {
      calls: number; successCalls: number; errorCalls: number; retryCalls: number;
      retryAttempts: number; totalTokens: number; avgLatencyMs: number | null;
      wordMeasured: number; wordInRange: number;
    };
    const aiCalls = aiTotals.calls || 0;
    const wordMeasured = aiTotals.wordMeasured || 0;
    const latencyWordCount = db.prepare(
      `SELECT endpoint, latency_ms AS latencyMs, word_count AS wordCount
       FROM ai_metrics
       WHERE user_id = ? AND created_at >= ? AND created_at < ?
         AND status = 'success' AND word_count IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 200`
    ).all(userId, monthStart, monthEnd);

    const quality = {
      aiCalls,
      aiSuccessRate: aiCalls ? pct(aiTotals.successCalls || 0, aiCalls) : null,
      aiErrorCount: aiTotals.errorCalls || 0,
      aiRetryCount: aiTotals.retryCalls || 0,
      aiRetryRate: aiCalls ? pct(aiTotals.retryCalls || 0, aiCalls) : null,
      retryAttempts: aiTotals.retryAttempts || 0,
      totalTokens: aiTotals.totalTokens || 0,
      avgLatencyMs: aiTotals.avgLatencyMs != null ? Math.round(aiTotals.avgLatencyMs) : null,
      wordTarget: {
        measured: wordMeasured,
        inRange: aiTotals.wordInRange || 0,
        rate: wordMeasured ? pct(aiTotals.wordInRange || 0, wordMeasured) : null,
      },
      // 这是调用质量漏斗，不包含未被数据模型记录的“教师采纳/保存”。
      funnel: [
        { key: 'calls', label: '发起调用', value: aiCalls },
        { key: 'success', label: '生成成功', value: aiTotals.successCalls || 0 },
        { key: 'measured', label: '成功且有字数目标', value: wordMeasured },
        { key: 'inRange', label: '字数达标', value: aiTotals.wordInRange || 0 },
      ],
      latencyWordCount,
      byEndpoint: aiRows.map((row) => ({
        endpoint: row.endpoint,
        calls: row.calls,
        successRate: pct(row.successCalls || 0, row.calls),
        retryCount: row.retryCalls || 0,
        retryRate: pct(row.retryCalls || 0, row.calls),
        avgLatencyMs: row.avgLatencyMs != null ? Math.round(row.avgLatencyMs) : null,
      })),
    };

    // ---- 质量：掌握程度分布（枚举，不是分数）----
    const masteryRows = db
      .prepare(
        "SELECT mastery AS k, COUNT(*) AS n FROM followups" +
          " WHERE user_id = ? AND created_at >= ? AND created_at < ? AND COALESCE(mastery, '') <> ''" +
          ' GROUP BY mastery'
      )
      .all(userId, monthStart, monthEnd) as Array<{ k: string; n: number }>;
    const masteryTotal = masteryRows.reduce((s, row) => s + row.n, 0);
    const masteryDistribution = masteryRows
      .map((row) => ({
        key: row.k,
        label: MASTERY_LABELS[row.k] || row.k,
        count: row.n,
        percent: pct(row.n, masteryTotal),
      }))
      .sort((a, b) => b.count - a.count);

    // ---- 工作节奏：本月每天写了多少 ----
    const dayRows = db
      .prepare(
        'SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM followups' +
          ' WHERE user_id = ? AND created_at >= ? AND created_at < ?' +
          ' GROUP BY day ORDER BY day'
      )
      .all(userId, monthStart, monthEnd) as Array<{ day: string; n: number }>;

    // ---- 成长：知识点掌握情况 ----
    // 当前快照先在「学生 × 类别」内平均，再对学生等权平均，避免知识点多的学生支配总均值。
    // 该值不是月末历史 mastery；历史月末快照目前未采集。
    const knowledgeRows = db
      .prepare(
        `SELECT category, SUM(total) AS total, SUM(solid) AS solid, SUM(weak) AS weak,
          AVG(studentAvgMastery) AS avgMastery
         FROM (
           SELECT student_id, point_category AS category, COUNT(*) AS total,
             SUM(CASE WHEN mastery_level >= 0.7 THEN 1 ELSE 0 END) AS solid,
             SUM(CASE WHEN mastery_level < 0.4 THEN 1 ELSE 0 END) AS weak,
             AVG(mastery_level) AS studentAvgMastery
           FROM knowledge_points WHERE user_id = ?
           GROUP BY student_id, point_category
         ) GROUP BY category`
      )
      .all(userId) as Array<{
      category: string;
      total: number;
      solid: number;
      weak: number;
      avgMastery: number | null;
    }>;

    const growth = knowledgeRows.map((row) => ({
      category: row.category,
      total: row.total,
      solid: row.solid || 0,
      weak: row.weak || 0,
      avgMastery: row.avgMastery != null ? Math.round(row.avgMastery * 10000) / 10000 : 0,
    }));
    const monthlyKnowledgeDelta = db.prepare(
      `SELECT kp.point_category AS category, SUM(rkp.delta) AS delta, COUNT(*) AS evidenceCount
       FROM report_knowledge_points rkp
       JOIN monthly_reports r ON r.id = rkp.report_id AND r.user_id = ?
       JOIN knowledge_points kp ON kp.id = rkp.point_id AND kp.user_id = r.user_id
       WHERE r.year_month = ? GROUP BY kp.point_category`
    ).all(userId, month) as Array<{ category: string; delta: number; evidenceCount: number }>;

    // ---- 出勤：report_items.attendance ----
    const attendRows = db
      .prepare(
        "SELECT ri.attendance AS k, COUNT(*) AS n FROM report_items ri" +
          ' JOIN monthly_reports r ON r.id = ri.report_id AND r.user_id = ri.user_id' +
          " WHERE ri.user_id = ? AND r.year_month = ? AND COALESCE(ri.attendance, '') <> ''" +
          ' GROUP BY ri.attendance'
      )
      .all(userId, month) as Array<{ k: string; n: number }>;
    let sessionsTotal = 0;
    let sessionsPresent = 0;
    let sessionsLeave = 0;
    let sessionsMakeup = 0;
    let sessionsUnclassified = 0;
    for (const row of attendRows) {
      const category = classifyReviewAttendance(row.k);
      if (!category) {
        sessionsUnclassified += row.n;
        continue;
      }
      sessionsTotal += row.n;
      if (category === 'present') sessionsPresent += row.n;
      if (category === 'leave') sessionsLeave += row.n;
      if (category === 'makeup') {
        sessionsMakeup += row.n;
        // 补课是实际到课的课次，纳入到课率分子，同时单独展示。
        sessionsPresent += row.n;
      }
    }

    res.json({
      month,
      workload,
      quality,
      masteryDistribution,
      dailyActivity: dayRows,
      growth,
      growthSemantics: 'current_snapshot_student_weighted',
      monthlyKnowledgeDelta: monthlyKnowledgeDelta.map((row) => ({
        category: row.category,
        delta: round2(row.delta || 0),
        evidenceCount: row.evidenceCount,
        semantics: 'sum_of_report_deltas_not_historical_mastery',
      })),
      followupQuality: getFollowupQuality(userId, monthStart, monthEnd),
      groupComparisons: getGroupComparisons(userId, month, monthStart, monthEnd),
      attendance: {
        sessions: sessionsTotal,
        present: sessionsPresent,
        leave: sessionsLeave,
        makeup: sessionsMakeup,
        unclassified: sessionsUnclassified,
        rate: nullablePct(sessionsPresent, sessionsTotal),
        semantics: 'present_plus_makeup_over_classified_sessions',
      },
      limitations: [
        '成长雷达是当前知识快照，不是所选月末的历史掌握度；月度曲线使用月报记录的原始 delta。',
        '班级对标仅统计当前教师创建的小组；跨教师查看仅开放给 TEACHING_SUPERVISOR_USERNAMES 或 ADMIN_USERNAMES 白名单账户。',
        '作业完成字段是自由文本，未折算为正式完成率；态度维度也没有独立结构化数据。',
        '出勤率只统计 ✅/请假/补 等已定义取值，补课计入到课分子；/ 和未知值不进入分母。',
        'AI 采纳率、教师修改幅度、完整保存漏斗和流式中断率尚无可靠事件来源，因此不展示估算值。',
        '图片指标表示回访含非空图片路径，不代表文件可用性或多模态识别成功率。',
        '家长阅读率按当前分享链接是否已有 read_at 计算，不保留历史多次阅读次数。',
        '小组掌握度和月报 delta 只覆盖有对应记录的学生，卡片标注样本数；无记录不当作 0。',
      ],
    });
  } catch (error: any) {
    respondInternalError(res, error, '获取复盘总览失败');
  }
});


/**
 * GET /api/teaching-review/students?month=YYYY-MM&limit=20
 * 学生覆盖度：本月写了几个学生、谁被冷落了、谁在连续多月缺席。
 * 只给「排序后的前 N 个」，不铺满全校，避免一屏几百行没人看。
 */
router.get('/students', (req: AuthenticatedRequest, res) => {
  try {
    const userId = resolveReviewUserId(req, res);
    if (userId === null) return;
    const parsed = parseMonth(req.query.month);
    if (!parsed) {
      return res.status(400).json({ error: 'month 必须为 YYYY-MM 格式' });
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 20;
    const month = parsed.year + '-' + pad2(parsed.month);
    const monthStart = month + '-01';
    const monthEnd = nextMonth(parsed.year, parsed.month) + '-01';

    const rows = db
      .prepare(
        'SELECT s.id AS student_id, s.name AS student_name, s.grade, s.subject,' +
          ' COUNT(f.id) AS cnt, MAX(f.created_at) AS last_at' +
          ' FROM students s' +
          ' LEFT JOIN followups f ON f.student_id = s.id AND f.user_id = s.user_id' +
          '   AND f.created_at >= ? AND f.created_at < ?' +
          ' WHERE s.user_id = ?' +
          ' GROUP BY s.id' +
          ' ORDER BY cnt ASC, last_at ASC, s.id ASC' +
          ' LIMIT ?'
      )
      .all(monthStart, monthEnd, userId, limit) as Array<{
      student_id: number;
      student_name: string;
      grade: string | null;
      subject: string | null;
      cnt: number;
      last_at: string | null;
    }>;

    const coverage = db.prepare(
      `SELECT COUNT(*) AS totalStudents,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM followups f WHERE f.user_id = s.user_id AND f.student_id = s.id
            AND f.created_at >= ? AND f.created_at < ?
        ) THEN 1 ELSE 0 END) AS coveredStudents
       FROM students s WHERE s.user_id = ?`
    ).get(monthStart, monthEnd, userId) as { totalStudents: number; coveredStudents: number | null };
    const coveredStudents = coverage.coveredStudents || 0;

    res.json({
      month,
      totalStudents: coverage.totalStudents,
      coveredStudents,
      students: rows.map((row) => ({
        studentId: row.student_id,
        studentName: row.student_name,
        grade: row.grade || '',
        subject: row.subject || '',
        followups: row.cnt,
        lastFollowupAt: row.last_at,
        cold: row.cnt === 0,
      })),
      coldCount: coverage.totalStudents - coveredStudents,
      returnedCount: rows.length,
    });
  } catch (error: any) {
    respondInternalError(res, error, '获取学生覆盖度失败');
  }
});

/**
 * GET /api/teaching-review/trend?months=6
 * 近 N 个月的产出趋势：回访数、月报数、听评课数、AI 成功率。
 * 用来回答「我是在变勤快还是变懒」。
 */
router.get('/trend', (req: AuthenticatedRequest, res) => {
  try {
    const userId = resolveReviewUserId(req, res);
    if (userId === null) return;
    const monthsRaw = Number(req.query.months);
    const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.floor(monthsRaw), 2), 24) : 6;
    const endMonthRaw = req.query.endMonth == null || req.query.endMonth === '' ? undefined : String(req.query.endMonth);
    if (endMonthRaw && !parseMonth(endMonthRaw)) {
      return res.status(400).json({ error: 'endMonth 必须为 YYYY-MM 格式' });
    }
    const labels = recentMonths(months, endMonthRaw);

    const points = labels.map((month) => {
      const [y, mm] = month.split('-').map((s) => parseInt(s, 10));
      const start = month + '-01';
      const end = nextMonth(y, mm) + '-01';

      const followups = (
        db
          .prepare('SELECT COUNT(*) AS n FROM followups WHERE user_id = ? AND created_at >= ? AND created_at < ?')
          .get(userId, start, end) as CountRow
      ).n;
      const reports = (
        db
          .prepare('SELECT COUNT(*) AS n FROM monthly_reports WHERE user_id = ? AND year_month = ?')
          .get(userId, month) as CountRow
      ).n;
      const observations = (
        db
          .prepare("SELECT COUNT(*) AS n FROM observations WHERE user_id = ? AND observed_at >= ? AND observed_at < ?")
          .get(userId, start, end) as CountRow
      ).n;
      const ai = db
        .prepare(
          'SELECT COUNT(*) AS calls,' +
            " SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCalls" +
            ' FROM ai_metrics WHERE user_id = ? AND created_at >= ? AND created_at < ?'
        )
        .get(userId, start, end) as { calls: number; successCalls: number };

      return {
        month,
        followups,
        reports,
        observations,
        aiCalls: ai.calls || 0,
        aiSuccessRate: nullablePct(ai.successCalls || 0, ai.calls || 0),
      };
    });

    res.json({ months, points });
  } catch (error: any) {
    respondInternalError(res, error, '获取产出趋势失败');
  }
});

export default router;