import { Router, type Response } from 'express';
import { db } from '../config/database.js';
import { AuthenticatedRequest } from '../types/index.js';
import { log } from '../utils/logger.js';
import { generateExamScheduleWithCourses, dateSpan } from '../utils/examSchedule.js';
import {
  buildReportXlsx,
  buildReportFilename,
  type ReportExcelItem,
  type ReportExcelInput,
} from '../utils/reportExcel.js';
import { monthLabel, nextYearMonth } from '../utils/reportMonth.js';
import { diffPlannedVsTaught, type ContinuityCourse } from '../utils/planContinuity.js';
import { suggestNextCourses } from '../utils/nextCourse.js';
import { recordChangeEvent } from '../services/content/references.js';
import {
  createExcelTemplate,
  getExcelTemplates,
  getExcelTemplateById,
  updateExcelTemplate,
  deleteExcelTemplate,
  TemplateEngine,
  type ReportData,
} from '../services/excel/templateEngine.js';
import { ExcelTemplateInspectError, inspectTemplate } from '../services/excel/inspectTemplate.js';

/**
 * 月度总结与课程规划。
 *
 * 一块报告 = 一个学生一个月的内容，里面「总结」和「规划」是两个独立开关，
 * 缺哪块就哪块不出现（对齐老师手维护的 Excel 模板）。
 *
 * 明细行 kind 有三种：
 *   - summary  已上的课，出勤 / 笔记整理 / 错题整理 / 作业完成 / 考试情况 都有值
 *   - plan     下月要上的课，只有课程属性 + 计划上课时间
 *   - exam     阶测安排，单独一行插规划中间
 */

/**
 * 数据库行类型定义，替代 as any 类型断言
 */
interface ReportRow {
  id: number;
  user_id: number;
  student_id: number | null;
  student_name?: string;
  year_month: string;
  term: string;
  grade: string | null;
  subject: string | null;
  summary_enabled: number;
  plan_enabled: number;
  summary_intro: string | null;
  plan_intro: string | null;
  farewell: string | null;
  item_count?: number;
  created_at: string;
  updated_at: string;
  track: string;
  seq: number;
  content: string;
  type: string;
  difficulty: string;
}

interface ReportItemRow {
  id: number;
  report_id: number;
  user_id: number;
  kind: string;
  seq: number;
  content: string;
  type: string;
  score: string;
  difficulty: string;
  scheduled_at: string;
  attendance: string;
  notes_done: string;
  mistakes_done: string;
  homework_done: string;
  exam: string;
  course_id: number | null;
  sort: number;
  created_at: string;
  updated_at: string;
}

interface StudentRow {
  id: number;
  user_id: number;
  name: string;
  grade: string | null;
  subject: string | null;
}

const router = Router();

/** 未知异常只写服务端日志；客户端始终收到稳定的公共错误。 */
function respondInternalError(res: Response, error: unknown, publicMessage: string): void {
  log.error({ err: error }, publicMessage);
  res.status(500).json({ error: publicMessage });
}

const KINDS = new Set(['summary', 'plan', 'exam']);

const REPORT_FIELDS = [
  'year_month',
  'term',
  'grade',
  'subject',
  'summary_enabled',
  'plan_enabled',
  'summary_intro',
  'plan_intro',
  'farewell',
] as const;

const ITEM_FIELDS = [
  'kind',
  'seq',
  'content',
  'type',
  'score',
  'difficulty',
  'scheduled_at',
  'attendance',
  'notes_done',
  'mistakes_done',
  'homework_done',
  'exam',
  'course_id',
] as const;

/** 前端发 camelCase，库列是 snake_case，统一在这里对齐 */
const ITEM_ALIASES: Record<string, (typeof ITEM_FIELDS)[number]> = {
  scheduledAt: 'scheduled_at',
  notesDone: 'notes_done',
  mistakesDone: 'mistakes_done',
  homeworkDone: 'homework_done',
  courseId: 'course_id',
};

/** 把请求体归一成 snake_case 列名 */
function itemBody(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body || {})) {
    out[ITEM_ALIASES[k] || k] = v;
  }
  return out;
}

function mapReport(row: any) {
  return {
    id: row.id,
    student_id: row.student_id,
    student_name: row.student_name ?? '',
    year_month: row.year_month,
    term: row.term,
    grade: row.grade,
    subject: row.subject,
    summary_enabled: !!row.summary_enabled,
    plan_enabled: !!row.plan_enabled,
    summary_intro: row.summary_intro,
    plan_intro: row.plan_intro,
    farewell: row.farewell,
    item_count: Number(row.item_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapItem(row: any) {
  return {
    id: row.id,
    report_id: row.report_id,
    kind: row.kind,
    seq: row.seq,
    content: row.content,
    type: row.type,
    score: row.score,
    difficulty: row.difficulty,
    scheduled_at: row.scheduled_at,
    attendance: row.attendance,
    notes_done: row.notes_done,
    mistakes_done: row.mistakes_done,
    homework_done: row.homework_done,
    exam: row.exam,
    course_id: numOrNull(row.course_id),
    sort: row.sort,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 课程目录条目 id：合法正整数才认，其它一律落 null（等于「不是从目录取的」） */
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 报告列表，可带 studentId 过滤 */
router.get('/', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const where = ['r.user_id = ?'];
    const params: unknown[] = [userId];
    const studentId = Number(req.query.studentId);
    if (Number.isInteger(studentId) && studentId > 0) {
      where.push('r.student_id = ?');
      params.push(studentId);
    }
    const rows = db
      .prepare(
        `SELECT r.*, s.name AS student_name, COUNT(i.id) AS item_count
         FROM monthly_reports r
         JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
         LEFT JOIN report_items i ON i.report_id = r.id
         WHERE ${where.join(' AND ')}
         GROUP BY r.id
         ORDER BY s.name, r.year_month DESC`
      )
      .all(...params) as ReportRow[];
    res.json({ reports: rows.map(mapReport) });
  } catch (error: any) {
    respondInternalError(res, error, '获取月度报告失败');
  }
});

/** 新建一块月度报告 */
router.post('/', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const studentId = Number(req.body?.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ error: '请选择学生' });
    }
    const student = db
      .prepare('SELECT * FROM students WHERE id = ? AND user_id = ?')
      .get(studentId, userId) as StudentRow | undefined;
    if (!student) return res.status(404).json({ error: '学生不存在' });

    const yearMonth = String(req.body?.yearMonth || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return res.status(400).json({ error: '请填写正确的月份（YYYY-MM）' });
    }

    const term = String(req.body?.term || '').trim();
    const grade = String(req.body?.grade ?? student.grade ?? '').trim();
    const subject = String(req.body?.subject ?? student.subject ?? '').trim();

    // 同名学生同月已存在就返回那条，不重复建
    const dup = db
      .prepare('SELECT * FROM monthly_reports WHERE user_id = ? AND student_id = ? AND year_month = ?')
      .get(userId, studentId, yearMonth) as ReportRow | undefined;
    if (dup) {
      return res.json({ report: mapReport({ ...dup, student_name: student.name }), duplicated: true });
    }

    const id = db
      .prepare(
        `INSERT INTO monthly_reports (user_id, student_id, year_month, term, grade, subject)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(userId, studentId, yearMonth, term, grade, subject).lastInsertRowid as number;

    const created = db.prepare('SELECT * FROM monthly_reports WHERE id = ?').get(id) as { m: number } | undefined;

    // 记录变更事件
    recordChangeEvent('report', id, ['created'], 1, req.userId!);

    res.json({
      report: mapReport({ ...created, student_name: student.name }),
      duplicated: false,
    });
  } catch (error: any) {
    respondInternalError(res, error, '创建月度报告失败');
  }
});

/** 单块报告 + 明细 */
router.get('/:id', (req: AuthenticatedRequest, res, next) => {
  // 静态模板列表路由注册在后方，不能让这里的报告 id 提前截获。
  if (req.params.id === 'excel-templates') return next();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的报告 id' });

    const row = db
      .prepare(
        `SELECT r.*, s.name AS student_name FROM monthly_reports r
         JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
         WHERE r.id = ? AND r.user_id = ?`
      )
      .get(id, req.userId!) as ReportRow | undefined;
    if (!row) return res.status(404).json({ error: '月度报告不存在' });

    const items = db
      .prepare('SELECT * FROM report_items WHERE report_id = ? AND user_id = ? ORDER BY sort, id')
      .all(id, req.userId!) as ReportItemRow[];
    res.json({ report: mapReport(row), items: items.map(mapItem) });
  } catch (error: any) {
    respondInternalError(res, error, '获取月度报告失败');
  }
});

/**
 * 找出「上月规划了、本月却没上」的课。
 *
 * 老师月底做总结最头疼的就是对着两张表核对哪些课漏了。以前靠脑子记，
 * 现在由代码比对：拿上月同学生的规划课，跟本月的已上课（总结行）做差集。
 * 前端据此一键把漏掉的课顺延到本月总结，不用再人工核对。
 */
router.get('/:id/undelivered', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的报告 id' });

    const cur = db
      .prepare('SELECT id, student_id, year_month FROM monthly_reports WHERE id = ? AND user_id = ?')
      .get(id, userId) as ReportRow | undefined;
    if (!cur) return res.status(404).json({ error: '月度报告不存在' });
    if (!cur.student_id) return res.json({ prevReportId: null, undelivered: [] });

    // 找同一个学生、上一个月份的报告
    const prev = db
      .prepare(
        `SELECT id FROM monthly_reports
         WHERE user_id = ? AND student_id = ? AND year_month < ?
         ORDER BY year_month DESC LIMIT 1`
      )
      .get(userId, cur.student_id, String(cur.year_month || '')) as ReportRow | undefined;
    if (!prev) return res.json({ prevReportId: null, undelivered: [] });

    // 上月规划课 = 上月报告里 kind=plan 的行。
    // 带上 type/difficulty：顺延漏上的课到本月总结时，保留原类型/难度，
    // 老师不用再手动补（以前只取 content+course_id，顺延后类型难度全丢）。
    const prevItems = db
      .prepare('SELECT content, course_id, type, difficulty FROM report_items WHERE report_id = ? AND user_id = ? AND kind = ? ORDER BY seq, id')
      .all(prev.id, userId, "plan") as ReportItemRow[];
    // 本月已上课 = 本报告里 kind=summary 的行（比对用，只需 content+course_id）
    const curItems = db
      .prepare('SELECT content, course_id FROM report_items WHERE report_id = ? AND user_id = ? AND kind = ? ORDER BY seq, id')
      .all(id, userId, "summary") as ReportItemRow[];

    const toContinuity = (rows: any[]): ContinuityCourse[] =>
      rows.map((r) => ({
        courseId: r.course_id != null ? Number(r.course_id) : null,
        content: String(r.content || ''),
        type: String(r.type || ''),
        difficulty: String(r.difficulty || ''),
      }));

    const undelivered = diffPlannedVsTaught(toContinuity(prevItems), toContinuity(curItems));
    res.json({ prevReportId: prev.id, undelivered });
  } catch (error: any) {
    respondInternalError(res, error, '核对上月规划失败');
  }
});

/**
 * 目录智能排课（方向 E）：按轨道推荐「下月该上什么」。
 *
 * 课程体系目录按 (term, track, seq) 有序组织，学生已上的课通过 report_items.course_id
 * 关联到目录。顺着同一 track 的 seq 往后推就是「下一步该上什么」。以前规划全靠老师
 * 手动翻目录挑，现在按 track 给出每条轨道的下一门待上课，老师从「手动挑」变「点选确认」。
 *
 * 口径：只推 (grade, subject, term) 都匹配本报告的目录；已上过的课取这个学生本学期
 * 所有报告里 kind=summary 且有 course_id 的行（跨月累积，不只看当前这块报告）。
 */
router.get('/:id/next-courses', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的报告 id' });

    const report = loadReport(id, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    const grade = String(report.grade || '').trim();
    const subject = String(report.subject || '').trim();
    const term = String(report.term || '').trim();
    if (!grade || !subject || !term) {
      return res.json({ suggestions: [], reason: '报告缺少年级/学科/学期，无法匹配课程目录' });
    }

    // 学生本学期已上过的课（跨月累积：这个学生所有报告里 kind=summary 且连了目录的行）
    const takenRows = db
      .prepare(
        `SELECT DISTINCT ri.course_id FROM report_items ri
         JOIN monthly_reports r ON r.id = ri.report_id AND r.user_id = ri.user_id
         WHERE ri.user_id = ? AND r.student_id = ? AND ri.kind = 'summary'
           AND ri.course_id IS NOT NULL AND r.term = ?`
      )
      .all(userId, report.student_id, term) as { course_id: number }[];
    const takenCourseIds = takenRows.map((r) => Number(r.course_id));

    // 匹配年级/学科/学期的目录，取排课推算需要的字段。
    // 目录是全局共享的（见 catalogList.ts courseFilter 的口径），不能按 user_id 圈范围：
    // 种子目录挂在播种管理员名下，按 user_id 过滤会让其他老师的续课推荐恒为空。
    const catalogRows = db
      .prepare(
        `SELECT id, track, seq, content, type, difficulty FROM course_catalog
         WHERE grade = ? AND subject = ? AND term = ?`
      )
      .all(grade, subject, term) as ReportRow[];

    const catalog = catalogRows.map((r) => ({
      id: Number(r.id),
      track: String(r.track || ''),
      seq: Number(r.seq || 0),
      content: String(r.content || ''),
      type: String(r.type || ''),
      difficulty: String(r.difficulty || ''),
    }));

    const suggestions = suggestNextCourses(catalog, takenCourseIds);
    res.json({ suggestions, takenCount: takenCourseIds.length });
  } catch (error: any) {
    respondInternalError(res, error, '推荐下月课程失败');
  }
});

/**
 * 班级批量复用（方向 F）：列出同班同学（同 grade+subject+term+year_month）的报告。
 *
 * 同一个班的学生，总结的「课堂情况」、规划的「重点内容」高度相似。老师写好一份
 * 班级行后，可以把相同部分批量套用到同班其他学生，再逐个微调，省去重复写。
 * 这里先列出可套用的对象（同班但不是自己），套用走 POST /:id/apply-to-class。
 */
router.get('/:id/classmates', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的报告 id' });

    const report = loadReport(id, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    const rows = db
      .prepare(
        `SELECT r.id, r.student_id, r.year_month, r.term, r.grade, r.subject,
                r.summary_intro, r.plan_intro, s.name AS student_name
         FROM monthly_reports r
         JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
         WHERE r.user_id = ? AND r.id != ?
           AND COALESCE(r.grade, '') = ? AND COALESCE(r.subject, '') = ?
           AND COALESCE(r.term, '') = ? AND r.year_month = ?
         ORDER BY s.name`
      )
      .all(
        userId, id,
        String(report.grade || ''), String(report.subject || ''),
        String(report.term || ''), String(report.year_month || '')
      ) as ReportRow[];

    const classmates = rows.map((r) => ({
      id: Number(r.id),
      studentId: Number(r.student_id),
      studentName: String(r.student_name || ''),
      yearMonth: String(r.year_month || ''),
      hasSummary: !!(r.summary_intro && String(r.summary_intro).trim()),
      hasPlan: !!(r.plan_intro && String(r.plan_intro).trim()),
    }));
    res.json({ classmates });
  } catch (error: any) {
    respondInternalError(res, error, '查询同班同学失败');
  }
});

/**
 * 班级批量复用（方向 F）：把这份报告的班级行套用到同班同学。
 *
 * body: { summary?: boolean, plan?: boolean }
 *   - summary=true  → 把本报告的 summary_intro 覆盖到同班同学的 summary_intro
 *   - plan=true     → 把本报告的 plan_intro 覆盖到同班同学的 plan_intro
 *   - 两个都不传     → 400
 *
 * 只覆盖 intro 文本（班级行的公共描述），不碰课程明细 —— 课程是按学生各自的
 * 出勤/完成度走的，不能一刀切复制。套用后同班同学可以再逐个微调个性部分。
 * 拒绝空文本覆盖：本报告对应 intro 为空时不覆盖，避免把别人的内容清空。
 */
router.post('/:id/apply-to-class', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的报告 id' });

    const copySummary = !!req.body?.summary;
    const copyPlan = !!req.body?.plan;
    if (!copySummary && !copyPlan) {
      return res.status(400).json({ error: '至少选择套用总结或规划之一' });
    }

    const report = loadReport(id, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    const summaryText = String(report.summary_intro || '');
    const planText = String(report.plan_intro || '');
    // 空文本不套用，避免把同班同学已写的内容清空
    if (copySummary && !summaryText.trim()) return res.status(400).json({ error: '本报告的总结为空，无法套用' });
    if (copyPlan && !planText.trim()) return res.status(400).json({ error: '本报告的规划为空，无法套用' });

    // 同班同学：同 grade+subject+term+year_month，排除自己
    const where = [
      'user_id = ?', 'id != ?',
      "COALESCE(grade, '') = ?", "COALESCE(subject, '') = ?",
      "COALESCE(term, '') = ?", 'year_month = ?',
    ];
    const params: unknown[] = [
      userId, id,
      String(report.grade || ''), String(report.subject || ''),
      String(report.term || ''), String(report.year_month || ''),
    ];
    if (copySummary) { where.push("summary_intro != ''"); }
    if (copyPlan) { where.push("plan_intro != ''"); }

    const targets = db
      .prepare(`SELECT id FROM monthly_reports WHERE ${where.join(' AND ')}`)
      .all(...params) as { id: number }[];

    let updated = 0;
    if (targets.length > 0) {
      
      // 使用单条 SQL 批量更新，避免 N+1 查询
      // 使用 CASE WHEN 保持未选字段的原值
      const setClauses = [];
      const values = [];
      
      if (copySummary) {
        setClauses.push('summary_intro = ?');
        values.push(summaryText);
      } else {
        // 保留原值：CASE id WHEN ? THEN (SELECT summary_intro FROM monthly_reports WHERE id = ?) ...
        const caseParts = targets.map(() => 'WHEN ? THEN (SELECT summary_intro FROM monthly_reports WHERE id = ?)').join(' ');
        const caseValues = targets.flatMap(t => [t.id, t.id]);
        setClauses.push('summary_intro = CASE id ' + caseParts + ' ELSE summary_intro END');
        values.push(...caseValues);
      }
      
      if (copyPlan) {
        setClauses.push('plan_intro = ?');
        values.push(planText);
      } else {
        const caseParts = targets.map((t, i) => 'WHEN ? THEN (SELECT plan_intro FROM monthly_reports WHERE id = ?)').join(' ');
        const caseValues = targets.flatMap(t => [t.id, t.id]);
        setClauses.push('plan_intro = CASE id ' + caseParts + ' ELSE plan_intro END');
        values.push(...caseValues);
      }
      
      setClauses.push("updated_at = datetime('now', '+8 hours')");
      
      const whereIn = targets.map(() => '?').join(',');
      values.push(...targets.map(t => t.id)); // for WHERE IN
      values.push(userId);
      
      updated = db.prepare(
        `UPDATE monthly_reports SET ${setClauses.join(', ')} WHERE id IN (${whereIn}) AND user_id = ?`
      ).run(...values).changes;
    }

    // 记录批量更新的变更事件
    if (updated > 0) {
      for (const t of targets) {
        recordChangeEvent('report', t.id, ['updated'], 2, req.userId!);
      }
    }

    res.json({ updated, studentIds: targets.map((t) => t.id) });
  } catch (error: any) {
    respondInternalError(res, error, '套用到同班失败');
  }
});

/** 导出 Excel：一个学生一份文件，版式对齐老师手维护的模板 */
router.get('/:id/xlsx', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '非法的报告 id' });

    const report = loadReport(id, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    const items = db
      .prepare('SELECT * FROM report_items WHERE report_id = ? AND user_id = ? ORDER BY sort, id')
      .all(id, userId) as ReportItemRow[];
    const pick = (kind: string) => items.filter((i) => i.kind === kind).map(toExcelItem);

    const input: ReportExcelInput = {
      studentName: report.student_name,
      term: report.term,
      grade: report.grade,
      subject: report.subject,
      yearMonth: report.year_month,
      // 月份标题以报告自己的 year_month 为准。不要从明细取首条日期：
      // 明细排序可手动上移（PATCH /:id/items/move），把一条跨月的课挪到最前面
      // 就会把「9月总结」变成「10月总结」，导出的 Excel 与报告文字会一起错。
      // 关掉哪个开关就不出哪个区块，月份也得一起省掉 —— 否则文件名会承诺
      // 一个并不存在的规划区块（「6月总结与7月规划.xlsx」里根本没有规划）。
      summaryMonth: report.summary_enabled ? monthLabel(report.year_month) : '',
      planMonth: report.plan_enabled ? monthLabel(nextYearMonth(report.year_month)) : '',
      summaryEnabled: !!report.summary_enabled,
      planEnabled: !!report.plan_enabled,
      summaryIntro: report.summary_intro,
      planIntro: report.plan_intro,
      farewell: report.farewell,
      summaryItems: pick('summary'),
      planItems: pick('plan'),
      examItems: pick('exam'),
    };

    const buf = await buildReportXlsx(input);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(buildReportFilename(input))}`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (error: any) {
    respondInternalError(res, error, '导出 Excel 失败');
  }
});

// ============ Excel 模板管理 ============

/** 列出用户的所有 Excel 模板 */
router.get('/excel-templates', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const templates = getExcelTemplates(userId);
    // 不返回 fileBlob，只返回元数据
    const safeTemplates = templates.map((t) => ({
      id: t.id,
      name: t.name,
      sheetName: t.sheetName,
      fieldMappings: t.fieldMappings,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    res.json({ templates: safeTemplates });
  } catch (error: any) {
    respondInternalError(res, error, '获取模板列表失败');
  }
});

/** 读取工作表与有限单元格，供前端可视化映射。必须放在 /excel-templates/:id 前。 */
router.post('/excel-templates/inspect', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await inspectTemplate(req.body?.fileBase64, req.body?.sheetName);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ExcelTemplateInspectError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    respondInternalError(res, error, '读取 Excel 模板失败，请稍后重试');
  }
});

function validatedTemplateName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new ExcelTemplateInspectError('模板名称不能为空，且不能超过 120 个字符');
  }
  return value.trim();
}

/** 新建 Excel 模板：保存前即验证工作簿与映射，避免把不可用的配置留到导出时才发现。 */
router.post('/excel-templates', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { name, fileBase64, fieldMappings, sheetName } = req.body;
    if (!name || !fileBase64 || !fieldMappings) {
      return res.status(400).json({ error: '缺少必填字段：name, fileBase64, fieldMappings' });
    }
    const validName = validatedTemplateName(name);
    validateExcelTemplateMappings(fieldMappings);
    const inspection = await inspectTemplate(fileBase64, sheetName);
    const fileBlob = Buffer.from(fileBase64.replace(/\s/g, ''), 'base64');
    const id = createExcelTemplate(userId, validName, fileBlob, fieldMappings, inspection.sheetName);
    const template = getExcelTemplateById(id, userId)!;
    res.json({ template: { ...template, fileBlob: undefined } });
  } catch (error: any) {
    if (error instanceof ExcelTemplateInspectError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    respondInternalError(res, error, '创建模板失败');
  }
});

/** 获取单个模板（含文件内容） */
router.get('/excel-templates/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的模板 id' });
    const template = getExcelTemplateById(id, userId);
    if (!template) return res.status(404).json({ error: '模板不存在' });
    const { fileBlob, ...metadata } = template;
    res.json({ template: { ...metadata, fileBase64: fileBlob.toString('base64') } });
  } catch (error: any) {
    respondInternalError(res, error, '获取模板失败');
  }
});

/** 更新模板：文件或工作表变化时重新检查；仅改名称不必重复解析工作簿。 */
router.put('/excel-templates/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的模板 id' });
    const { name, fileBase64, fieldMappings, sheetName } = req.body;
    const existing = getExcelTemplateById(id, userId);
    if (!existing) return res.status(404).json({ error: '模板不存在' });
    const updates: any = {};
    if (name !== undefined) updates.name = validatedTemplateName(name);
    if (fieldMappings !== undefined) {
      validateExcelTemplateMappings(fieldMappings);
      updates.fieldMappings = fieldMappings;
    }
    if (fileBase64 !== undefined || sheetName !== undefined) {
      const effectiveBase64 = fileBase64 !== undefined ? fileBase64 : existing.fileBlob.toString('base64');
      const inspection = await inspectTemplate(effectiveBase64, sheetName ?? existing.sheetName);
      if (fileBase64 !== undefined) updates.fileBlob = Buffer.from(effectiveBase64.replace(/\s/g, ''), 'base64');
      updates.sheetName = inspection.sheetName;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }
    updateExcelTemplate(id, userId, updates);
    const template = getExcelTemplateById(id, userId)!;
    res.json({ template: { ...template, fileBlob: undefined } });
  } catch (error: any) {
    if (error instanceof ExcelTemplateInspectError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    respondInternalError(res, error, '更新模板失败');
  }
});

/** 删除模板 */
router.delete('/excel-templates/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的模板 id' });
    const ok = deleteExcelTemplate(id, userId);
    if (!ok) return res.status(404).json({ error: '模板不存在' });
    res.json({ deleted: true });
  } catch (error: any) {
    respondInternalError(res, error, '删除模板失败');
  }
});

const EXCEL_REPORT_FIELDS = new Set([
  'id', 'student_name', 'year_month', 'term', 'grade', 'subject',
  'summary_enabled', 'plan_enabled', 'summary_intro', 'plan_intro',
  'farewell', 'created_at', 'updated_at',
]);
const EXCEL_STUDENT_FIELDS = new Set(['id', 'name', 'grade', 'subject', 'phone', 'notes']);
const EXCEL_ITEM_FIELDS = new Set([
  'id', 'kind', 'seq', 'content', 'type', 'score', 'difficulty', 'scheduled_at',
  'attendance', 'notes_done', 'mistakes_done', 'homework_done', 'exam', 'sort', 'course_id',
]);
const EXCEL_LOOP_SOURCES = new Set(['report_items', 'summary_items', 'plan_items', 'exam_items']);

function isKnownExcelItemPath(source: string, field: string): boolean {
  if (!/^\w+$/.test(field)) return false;
  return EXCEL_ITEM_FIELDS.has(field) || (source !== 'report_items' && field === 'row_index');
}

function isKnownExcelPath(path: string): boolean {
  const reportMatch = path.match(/^report\.(\w+)$/);
  if (reportMatch) return EXCEL_REPORT_FIELDS.has(reportMatch[1]);
  const studentMatch = path.match(/^student\.(\w+)$/);
  if (studentMatch) return EXCEL_STUDENT_FIELDS.has(studentMatch[1]);
  const itemMatch = path.match(/^(report_items|summary_items|plan_items|exam_items)\[\d+\]\.(\w+)$/);
  return itemMatch ? isKnownExcelItemPath(itemMatch[1], itemMatch[2]) : false;
}

/** 与 TemplateEngine 的解析规则保持一致，避免未知路径静默导出空白。 */
function isValidExcelMapping(mapping: string): boolean {
  const loopMatch = mapping.match(/^loop:(right:)?(\w+)(?:\[(\w+)=([^\]]+)\])?->(.+)$/);
  if (loopMatch) {
    const [, , source, filterKey, , itemPath] = loopMatch;
    return EXCEL_LOOP_SOURCES.has(source)
      && (!filterKey || isKnownExcelItemPath(source, filterKey))
      && isKnownExcelItemPath(source, itemPath);
  }
  const conditionalMatch = mapping.match(/^if:([\w.]+)=(.*?)->([^:]+)(?::(.*))?$/);
  if (conditionalMatch) {
    const [, conditionPath, , truePath, falsePath] = conditionalMatch;
    return isKnownExcelPath(conditionPath)
      && isKnownExcelPath(truePath)
      && (!falsePath || isKnownExcelPath(falsePath));
  }
  return !mapping.startsWith('loop:') && !mapping.startsWith('if:') && isKnownExcelPath(mapping);
}

function validateExcelTemplateMappings(value: unknown): asserts value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExcelTemplateInspectError('字段映射必须是以单元格地址为键的对象');
  }
  const entries = Object.entries(value);
  if (entries.length > 1000) throw new ExcelTemplateInspectError('单个模板最多支持 1000 个单元格映射');
  for (const [cellAddr, mapping] of entries) {
    const match = cellAddr.match(/^([A-Z]{1,3})([1-9]\d*)$/);
    const column = match?.[1].split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) ?? 0;
    const row = Number(match?.[2] ?? 0);
    if (!match || column > 16384 || row > 1048576) {
      throw new ExcelTemplateInspectError(`无效的单元格地址：${cellAddr}`);
    }
    if (typeof mapping !== 'string' || !mapping.trim() || mapping.length > 2000 || !isValidExcelMapping(mapping)) {
      throw new ExcelTemplateInspectError(`单元格 ${cellAddr} 的映射包含未知字段或不支持的语法`);
    }
  }
}

/** 使用模板生成报告 Excel（核心：按映射填充） */
router.post('/:reportId/excel-templates/:templateId/generate', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const reportId = Number(req.params.reportId);
    const templateId = Number(req.params.templateId);
    if (!Number.isInteger(reportId) || !Number.isInteger(templateId)) {
      return res.status(400).json({ error: '非法的 id' });
    }

    const report = loadReport(reportId, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    const template = getExcelTemplateById(templateId, userId);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    for (const [cellAddr, mapping] of Object.entries(template.fieldMappings)) {
      if (!isValidExcelMapping(mapping)) {
        return res.status(400).json({ error: `单元格 ${cellAddr} 的映射包含未知字段或不支持的语法：${mapping}` });
      }
    }

    const student = db.prepare('SELECT phone, notes FROM students WHERE id = ? AND user_id = ?')
      .get(report.student_id, userId) as { phone: string | null; notes: string | null } | undefined;
    if (!student) return res.status(404).json({ error: '学生不存在' });

    const items = db
      .prepare('SELECT * FROM report_items WHERE report_id = ? AND user_id = ? ORDER BY sort, id')
      .all(reportId, userId) as ReportItemRow[];

    const reportData: ReportData = {
      report: {
        id: report.id,
        student_id: report.student_id,
        student_name: report.student_name,
        year_month: report.year_month,
        term: report.term,
        grade: report.grade,
        subject: report.subject,
        summary_enabled: report.summary_enabled,
        plan_enabled: report.plan_enabled,
        summary_intro: report.summary_intro || '',
        plan_intro: report.plan_intro || '',
        farewell: report.farewell || '',
        created_at: report.created_at,
        updated_at: report.updated_at,
      },
      items: items.map((item) => ({
        id: item.id,
        report_id: item.report_id,
        kind: item.kind as 'summary' | 'plan' | 'exam',
        seq: item.seq,
        content: item.content,
        type: item.type,
        score: item.score,
        difficulty: item.difficulty,
        scheduled_at: item.scheduled_at,
        attendance: item.attendance,
        notes_done: item.notes_done,
        mistakes_done: item.mistakes_done,
        homework_done: item.homework_done,
        exam: item.exam,
        sort: item.sort,
        course_id: item.course_id,
      })),
      student: {
        id: report.student_id,
        name: report.student_name,
        grade: report.grade || '',
        subject: report.subject || '',
        phone: student.phone,
        notes: student.notes,
      },
    };

    const engine = new TemplateEngine(template);
    const buf = await engine.generate(reportData);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${report.student_name}_${report.year_month}_${template.name}.xlsx`)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (error: any) {
    respondInternalError(res, error, '生成 Excel 失败');
  }
});

/** 预览模板映射结构（不生成文件，只返回解析后的映射树） */
router.post('/excel-templates/:id/preview', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的模板 id' });
    const template = getExcelTemplateById(id, userId);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    // 返回解析后的映射结构，前端可用于可视化映射配置
    const mappings = template.fieldMappings;
    const parsed: Record<string, { type: string; path: string; details?: any }> = {};
    for (const [cellAddr, mappingStr] of Object.entries(mappings)) {
      // 简单解析用于预览
      let type = 'static';
      let path = mappingStr;
      let details: any = {};
      if (mappingStr.startsWith('loop:')) {
        type = 'loop';
        const match = mappingStr.match(/^loop:(right:)?(\w+)(?:\[(\w+)=([^\]]+)\])?->(.+)$/);
        if (match) {
          details = { direction: match[1] ? 'right' : 'down', source: match[2], filter: match[3] ? { key: match[3], value: match[4] } : null, itemPath: match[5] };
        }
      } else if (mappingStr.startsWith('if:')) {
        type = 'conditional';
      }
      parsed[cellAddr] = { type, path, details };
    }
    res.json({ template: { id: template.id, name: template.name, sheetName: template.sheetName }, mappings: parsed });
  } catch (error: any) {
    respondInternalError(res, error, '预览映射失败');
  }
});

/** 修改报告头（标题字段 + 两个开关 + 两段摘要 + 祝福语） */
router.patch('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的报告 id' });

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of REPORT_FIELDS) {
      const key = field
        .split('_')
        .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
        .join('');
      if (req.body?.[key] !== undefined) {
        let value = req.body[key];
        if (field === 'year_month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))) {
          return res.status(400).json({ error: '请填写正确的月份（YYYY-MM）' });
        }
        if (field === 'summary_enabled' || field === 'plan_enabled') {
          value = value ? 1 : 0;
        } else if (typeof value === 'string') {
          value = value.trim();
        }
        sets.push(`${field} = ?`);
        params.push(value);
      }
    }
    if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });

    sets.push("updated_at = datetime('now', '+8 hours')");
    params.push(id, userId);
    const r = db.prepare(`UPDATE monthly_reports SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    if (!r.changes) return res.status(404).json({ error: '月度报告不存在' });

    // 记录变更事件
    recordChangeEvent('report', id, ['updated'], 2, req.userId!);

    res.json({ report: mapReport(loadReport(id, userId)!) });
  } catch (error: any) {
    respondInternalError(res, error, '更新失败');
  }
});

/** 阶测安排自动生成：按学期跨度算出日期，可选直接落库 */
router.post('/:id/exams', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的报告 id' });
    const report = loadReport(id, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    // 规划块里的课。总结/阶测本来就没有计划上课时间，不参与推算。
    // 按 sort 排，这样覆盖列表的顺序和页面上的行顺序一致。
    const planRows = db
      .prepare(
        `SELECT content, scheduled_at FROM report_items
         WHERE report_id = ? AND user_id = ? AND kind = 'plan'
         ORDER BY sort, id`
      )
      .all(id, userId) as ReportItemRow[];

    const start = String(req.body?.startDate || '').trim();
    const end = String(req.body?.endDate || '').trim();
    let span = { startDate: start, endDate: end };
    if (!start && !end) {
      const found = dateSpan(planRows.map((r) => String(r.scheduled_at || '')));
      if (!found) {
        return res.status(422).json({ error: '规划里还没有计划上课时间，无法推算阶测' });
      }
      span = found;
    }

    const suggestions = generateExamScheduleWithCourses(
      String(report.term || ''),
      span.startDate,
      span.endDate,
      planRows.map((r) => ({ date: String(r.scheduled_at || ''), content: String(r.content || '') }))
    );
    if (!suggestions.length) {
      return res.status(422).json({
        error: '这个月的排课跨度不够一次阶测',
        message: `间隔 ${(Number(intervalPreview(String(report.term || ''))) / 7)} 周，本跨度内安排不下`,
      });
    }

    let inserted = 0;
    if (req.body?.insert) {
      const maxSort = db
        .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM report_items WHERE report_id = ?')
        .get(id) as { m: number } | undefined;
      let base = Number(maxSort?.m || 0);
      // prepare 必须在循环外：better-sqlite3 的 prepare 每次都要解析 SQL 并生成
      // 语句对象，放在循环里等于「一行一次编译」，几百行就是几百次无谓开销。
      const insertStmt = db.prepare(
        `INSERT INTO report_items (user_id, report_id, kind, content, scheduled_at, sort)
         VALUES (?, ?, 'exam', ?, ?, ?)`
      );
      db.transaction(() => {
        for (const s of suggestions) {
          base += 1;
          insertStmt.run(userId, id, s.content, s.date, base);
          inserted++;
        }
      })();
      db.prepare("UPDATE monthly_reports SET updated_at = datetime('now', '+8 hours') WHERE id = ?").run(id);
    }

    res.json({ term: report.term, startDate: span.startDate, endDate: span.endDate, suggestions, inserted });
  } catch (error: any) {
    respondInternalError(res, error, '生成阶测安排失败');
  }
});

/** 上移 / 下移一行 */
router.post('/:id/items/move', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const reportId = Number(req.params.id);
    const itemId = Number(req.body?.itemId);
    const dir = req.body?.dir === 'up' || req.body?.dir === 'down' ? req.body.dir : '';
    if (!Number.isInteger(reportId) || !Number.isInteger(itemId) || !dir) {
      return res.status(400).json({ error: '参数不合法' });
    }

    const result = db.transaction(() => {
      const items = db
        .prepare('SELECT id, sort FROM report_items WHERE report_id = ? AND user_id = ? ORDER BY sort, id')
        .all(reportId, userId) as { id: number; sort: number }[];
      if (!items.length) return { items: [] };
      const idx = items.findIndex((x) => x.id === itemId);
      if (idx < 0) return { items, moved: false };
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= items.length) return { items, moved: false };

      const a = items[idx];
      const b = items[swap];
      const updateStmt = db.prepare(
        "UPDATE report_items SET sort = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?"
      );
      updateStmt.run(b.sort, a.id);
      updateStmt.run(a.sort, b.id);
      return { items: null, moved: true };
    })();

    const list = db
      .prepare('SELECT * FROM report_items WHERE report_id = ? AND user_id = ? ORDER BY sort, id')
      .all(reportId, userId) as ReportItemRow[];
    res.json({ moved: result.moved, items: list.map(mapItem) });
  } catch (error: any) {
    respondInternalError(res, error, '排序失败');
  }
});

/** 新增一行明细 */
router.post('/:id/items', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId)) return res.status(400).json({ error: '非法的报告 id' });
    const report = loadReport(reportId, userId);
    if (!report) return res.status(404).json({ error: '月度报告不存在' });

    const body = itemBody(req.body);
    const kind = String(body.kind || '');
    if (!KINDS.has(kind)) return res.status(400).json({ error: '行类型不合法' });

    const maxSort = db
      .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM report_items WHERE report_id = ?')
      .get(reportId) as { m: number } | undefined;

    const id = db
      .prepare(
        `INSERT INTO report_items (user_id, report_id, kind, seq, content, type, score, difficulty,
          scheduled_at, attendance, notes_done, mistakes_done, homework_done, exam, course_id, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        reportId,
        kind,
        num(body.seq, 0),
        str(body.content),
        str(body.type),
        str(body.score),
        str(body.difficulty),
        str(body.scheduled_at),
        str(body.attendance),
        str(body.notes_done),
        str(body.mistakes_done),
        str(body.homework_done),
        str(body.exam),
        numOrNull(body.course_id),
        Number(maxSort?.m || 0) + 1
      ).lastInsertRowid as number;

    db.prepare("UPDATE monthly_reports SET updated_at = datetime('now', '+8 hours') WHERE id = ?").run(reportId);

    // 记录变更事件
    recordChangeEvent('report', reportId, ['updated'], 2, req.userId!);

    res.json({ item: mapItem(db.prepare('SELECT * FROM report_items WHERE id = ?').get(id) as ReportItemRow | undefined) });
  } catch (error: any) {
    respondInternalError(res, error, '新增明细失败');
  }
});

/** 改一行明细 */
router.patch('/:id/items/:itemId', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const reportId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(reportId) || !Number.isInteger(itemId)) {
      return res.status(400).json({ error: '非法的 id' });
    }

    const existing = db
      .prepare('SELECT * FROM report_items WHERE id = ? AND report_id = ? AND user_id = ?')
      .get(itemId, reportId, userId) as ReportItemRow | undefined;
    if (!existing) return res.status(404).json({ error: '明细不存在' });

    const body = itemBody(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ITEM_FIELDS) {
      if (body[field] === undefined) continue;
      if (field === 'kind' && !KINDS.has(String(body[field]))) {
        return res.status(400).json({ error: '行类型不合法' });
      }
      if (field === 'seq') {
        sets.push('seq = ?');
        params.push(num(body[field], 0));
      } else if (field === 'course_id') {
        // 手输替换掉目录课时，允许把来源清成 null
        sets.push('course_id = ?');
        params.push(numOrNull(body[field]));
      } else {
        sets.push(`${field} = ?`);
        params.push(str(body[field]));
      }
    }
    if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });

    sets.push("updated_at = datetime('now', '+8 hours')");
    params.push(itemId, userId);
    // WHERE 带 user_id 双保险：归属虽有前置 SELECT 校验，写路径本身再圈一次（与 observations.ts PUT 一致）
    db.prepare(`UPDATE report_items SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    db.prepare("UPDATE monthly_reports SET updated_at = datetime('now', '+8 hours') WHERE id = ?").run(reportId);

    // 记录变更事件
    recordChangeEvent('report', reportId, ['updated'], 2, req.userId!);

    res.json({ item: mapItem(db.prepare('SELECT * FROM report_items WHERE id = ?').get(itemId) as ReportItemRow | undefined) });
  } catch (error: any) {
    respondInternalError(res, error, '更新明细失败');
  }
});

/** 删一行明细 */
router.delete('/:id/items/:itemId', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const reportId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(reportId) || !Number.isInteger(itemId)) {
      return res.status(400).json({ error: '非法的 id' });
    }
    const changes = db
      .prepare('DELETE FROM report_items WHERE id = ? AND report_id = ? AND user_id = ?')
      .run(itemId, reportId, userId).changes;
    if (!changes) return res.status(404).json({ error: '明细不存在' });
    db.prepare("UPDATE monthly_reports SET updated_at = datetime('now', '+8 hours') WHERE id = ?").run(reportId);

    // 记录变更事件
    recordChangeEvent('report', reportId, ['updated'], 2, req.userId!);

    res.json({ deleted: changes });
  } catch (error: any) {
    respondInternalError(res, error, '删除明细失败');
  }
});

/** 删整块报告 */
router.delete('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: '非法的报告 id' });

    // 同上：语句在事务里只用到一次，但先 prepare 出来语义更清楚，
    // 也避免在事务回调里重新编译（事务内做任何额外工作都会拉长持锁时间）。
    const deleteItems = db.prepare('DELETE FROM report_items WHERE report_id = ? AND user_id = ?');
    const deleteReport = db.prepare('DELETE FROM monthly_reports WHERE id = ? AND user_id = ?');
    const removed = db.transaction(() => {
      const items = deleteItems.run(id, userId).changes;
      const reports = deleteReport.run(id, userId).changes;
      return { reports, items };
    })();

    // 记录变更事件
    if (removed.reports > 0) {
      recordChangeEvent('report', id, ['deleted'], 2, req.userId!);
    }

    res.json({ deleted: removed.reports, itemsDeleted: removed.items });
  } catch (error: any) {
    respondInternalError(res, error, '删除失败');
  }
});

// ============ 小工具 ============

function loadReport(id: number, userId: number): any | null {
  return (
    db
      .prepare(
        `SELECT r.*, s.name AS student_name FROM monthly_reports r
         JOIN students s ON s.id = r.student_id AND s.user_id = r.user_id
         WHERE r.id = ? AND r.user_id = ?`
      )
      .get(id, userId) ?? null
  );
}

/** 明细行 → Excel 输入（列名转 camelCase） */
function toExcelItem(row: any): ReportExcelItem {
  return {
    content: str(row.content),
    type: str(row.type),
    score: str(row.score),
    difficulty: str(row.difficulty),
    scheduledAt: str(row.scheduled_at),
    attendance: str(row.attendance),
    notesDone: str(row.notes_done),
    mistakesDone: str(row.mistakes_done),
    homeworkDone: str(row.homework_done),
    exam: str(row.exam),
  };
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** 给错误提示用：间隔多少周 */
function intervalPreview(term: string): number {
  return /暑假|寒假/.test(term) ? 14 : 21;
}

export default router;
